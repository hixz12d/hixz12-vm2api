/**
 * Single outbound assembly used by /v1 applyAttempt and probe-class helpers.
 * Tests compare envelopes from this module so admin paths cannot drift.
 */
import { officialMessagesBody } from './anthropic-messages.mjs'
import {
  prepareAnthropicRequest,
  rewriteToolNames,
  sanitizeAnthropicBodyForBetaTokens,
  ensureFastModeBeta,
  ensureClearThinkingContextManagement,
  stripInvalidThinkingBlocks,
  alignSamplingWithThinking,
  modelSupportsMidConversationSystem,
} from './anthropic-policy.mjs'
import { liftMidConversationSystemMessages } from './sanitize.mjs'
import { ensureUnofficialAdaptiveThinking, ensureUnofficialEffortHigh, normalizeThinkingForModel } from './thinking.mjs'
import { ensureOutputConfigSchema } from './request-rectifier.mjs'
import {
  applyCrsIdentityReplace,
  extractCallerSession,
  resolveOutboundSessionId,
  sessionIdFromOutboundBody,
} from '../identity/identity-rewrite.mjs'
import { resolveCrsHeaders } from '../identity/crs-headers.mjs'
import { hasClaudeCode1mSuffix } from './context-1m.mjs'
import {
  refreshOfficialSystemEnvironment,
  stampBillingPromptId,
  CRS_OFFICIAL_SYSTEM,
  CRS_OFFICIAL_CLI_SYSTEM,
  CRS_COMPACT_IDENTITY,
} from '../identity/crs-persona.mjs'
import { sealClaudeCodeCch } from '../identity/cch.mjs'
import {
  CRS_OFFICIAL_AGENT_PROMPT,
  CRS_AGENT_EXPANSION,
  CRS_OFFICIAL_AGENT_IDENTITY,
} from '../identity/official-cc-system-2.1.241.mjs'
import {
  applyCacheTtlToBody,
  applyMessageBreakpoints,
  DEFAULT_CACHE_TTL,
  enforceCacheTtlOrder,
  normalizeCacheTtl,
  removeCacheControlFields,
  stripIllegalCacheControlFields,
} from './cache-ttl.mjs'
import { apiKeyBetaHeader, setupTokenBetaHeader } from './claude-code-betas.mjs'
import { applyModelRequestRules } from './model-policy.mjs'
import { isApiKeyMode, isAnySetupTokenMode } from '../oauth/credential-mode.mjs'
import { prepareClassifierBody } from './request-purpose.mjs'

export const INFERENCE_UA = 'kin-inference/1.0'

const CLI_IDENTITY = "You are a Claude agent, built on Anthropic's Claude Agent SDK."

function systemBlockText(block) {
  if (typeof block === 'string') return block
  return String(block?.text || '')
}

export function isCliOwnedSystemText(text) {
  const t = String(text || '').trim()
  if (!t) return true
  if (/^x-anthropic-billing-header:[^\r\n]*$/i.test(t)) return true
  // Only the gateway's timezone-only block is owned; client Environment
  // blocks can contain the real cwd/platform and must survive the hop.
  if (/^# Environment\r?\n[ \t]*(?:-[ \t]*)?Time ?zone:[^\r\n]+$/i.test(t)) return true
  if (t === CLI_IDENTITY || t === CRS_OFFICIAL_SYSTEM || t === CRS_OFFICIAL_AGENT_IDENTITY) return true
  if (t === CRS_COMPACT_IDENTITY || t === CRS_OFFICIAL_CLI_SYSTEM) return true
  // Agent / expansion stay as leftover so wrap CLI identity/zero can still carry 官方完整提示词.
  return false
}

export function stripCliOwnedSystem(system) {
  if (system == null) return undefined
  if (typeof system === 'string') return isCliOwnedSystemText(system) ? undefined : system
  if (!Array.isArray(system)) return system
  const kept = system.filter((block) => !isCliOwnedSystemText(systemBlockText(block)))
  return kept.length ? kept : undefined
}

/** Official Claude Code 2.1.278 context block. A live counter here changes the cached prefix. */
const OFFICIAL_CONTEXT_BUDGET = '<total_tokens>15000000 tokens left</total_tokens>'
const VOLATILE_CONTEXT_BUDGET = /<total_tokens>\d+ tokens left<\/total_tokens>/g

function stabilizeOfficialContextBudget(text) {
  const raw = String(text ?? '')
  if (!raw.includes('<total_tokens>')) return raw
  return raw.replace(VOLATILE_CONTEXT_BUDGET, OFFICIAL_CONTEXT_BUDGET)
}

/** system[] is before every message breakpoint. A per-turn token counter there
 * makes the next turn rewrite the whole prefix instead of reading it. */
function stabilizeSystemBudget(body) {
  if (!body || body.system == null) return body
  if (typeof body.system === 'string') {
    const text = stabilizeOfficialContextBudget(body.system)
    return text === body.system ? body : { ...body, system: text }
  }
  if (!Array.isArray(body.system)) return body
  let changed = false
  const system = body.system.map((block) => {
    if (typeof block === 'string') {
      const text = stabilizeOfficialContextBudget(block)
      if (text === block) return block
      changed = true
      return text
    }
    if (!block || typeof block !== 'object' || typeof block.text !== 'string') return block
    const text = stabilizeOfficialContextBudget(block.text)
    if (text === block.text) return block
    changed = true
    return { ...block, text }
  })
  return changed ? { ...body, system } : body
}

function stabilizeBlockBudget(block) {
  if (typeof block === 'string') return stabilizeOfficialContextBudget(block)
  if (!block || typeof block !== 'object') return block
  let next = block
  if (typeof block.text === 'string') {
    const text = stabilizeOfficialContextBudget(block.text)
    if (text !== block.text) next = { ...next, text }
  }
  if (typeof block.content === 'string') {
    const content = stabilizeOfficialContextBudget(block.content)
    if (content !== block.content) next = { ...next, content }
  }
  return next
}

/** Historical role=system reminders sit inside the next lookup prefix. */
function stabilizeMessageBudgets(body) {
  if (!Array.isArray(body?.messages)) return body
  let changed = false
  const messages = body.messages.map((message) => {
    const content = message?.content
    if (typeof content === 'string') {
      const text = stabilizeOfficialContextBudget(content)
      if (text === content) return message
      changed = true
      return { ...message, content: text }
    }
    if (!Array.isArray(content)) return message
    let touched = false
    const next = content.map((block) => {
      const stabilized = stabilizeBlockBudget(block)
      if (stabilized !== block) touched = true
      return stabilized
    })
    if (!touched) return message
    changed = true
    return { ...message, content: next }
  })
  return changed ? { ...body, messages } : body
}

/** The one caller beta that rides with `safeguards` (Claude Code auto mode). */
export const SAFEGUARDS_BETA_RE = /^dangerous-tool-use-\d{4}-\d{2}-\d{2}$/

/** First `dangerous-tool-use-YYYY-MM-DD` in the caller's anthropic-beta header(s), or ''. */
export function pickSafeguardsBeta(betaHeader) {
  const values = Array.isArray(betaHeader) ? betaHeader : [betaHeader]
  for (const value of values) {
    for (const token of String(value ?? '').split(',')) {
      const beta = token.trim()
      if (SAFEGUARDS_BETA_RE.test(beta)) return beta
    }
  }
  return ''
}

/** routing.compatibility.auto_mode_server: missing or anything but `false` means on. */
export function autoModeServerEnabled(routing) {
  return routing?.compatibility?.auto_mode_server !== false
}

/**
 * Auto mode server checks: keep the caller's `safeguards` and hand the slot CLI
 * its beta in-body (`kin_safeguards_beta`; the kernel drops envelope headers).
 * Both or neither. A caller-sent `kin_safeguards_beta` is never trusted.
 */
function applyCliHopSafeguards(body, safeguards, { safeguardsBeta, autoModeServer }) {
  delete body.safeguards
  delete body.kin_safeguards_beta
  const beta = typeof safeguardsBeta === 'string' ? safeguardsBeta.trim() : ''
  if (autoModeServer === false || !Array.isArray(safeguards) || !SAFEGUARDS_BETA_RE.test(beta)) return body
  body.safeguards = safeguards
  body.kin_safeguards_beta = beta
  return body
}

/**
 * Caller fields plus Node-owned message breakpoints.
 * CLI owns persona layout and system/tools markers; kernel only forwards.
 *
 * role=system turns stay where the caller put them, including a trailing one:
 * Claude Code ends most turns with a reminder (SessionStart context, then
 * `<total_tokens>`). Moving it into system[] puts a different text in the
 * cached system block whenever the reminder changes, so the whole prefix
 * misses. In place, it is history on the next turn and the prefix only grows.
 * This must not depend on client classification: relays strip the billing
 * block and rewrite the UA, so relayed Claude Code looks third-party.
 */
export function prepareCliHopBody(
  canonicalBody,
  {
    stream = true,
    repaired = false,
    dataplane,
    cacheTtl = DEFAULT_CACHE_TTL,
    safeguardsBeta = '',
    autoModeServer = true,
    requestContext = null,
  } = {},
) {
  if (requestContext?.purpose === 'auto_mode_classifier') {
    // Upstream keeps the classifier contract; the fork's safeguards gate still applies.
    const classifier = prepareClassifierBody(canonicalBody, { stream })
    return applyCliHopSafeguards(classifier, classifier.safeguards, { safeguardsBeta, autoModeServer })
  }
  let body = officialMessagesBody(canonicalBody, { stream })
  const safeguards = body.safeguards
  delete body.safeguards
  delete body.kin_safeguards_beta
  delete body.metadata
  const leftover = stripCliOwnedSystem(body.system)
  if (leftover == null) delete body.system
  else body.system = leftover
  if (dataplane === 'crag') {
    // Crag joins blocks with one newline before wrapping them in <system>.
    // Pack the native CLI separator ourselves, and always supply a gateway
    // block so a caller's first user <system> block cannot be promoted instead.
    body.system = (Array.isArray(leftover) ? leftover.map(systemBlockText).join('\n\n') : leftover) || '\u200b'
  }
  body = stabilizeSystemBudget(body)
  body = stabilizeMessageBudgets(body)
  // cli-node sends mid-conversation-system. Only models that reject the role need the lift.
  if (!modelSupportsMidConversationSystem(body.model)) body = liftMidConversationSystemMessages(body)

  if (!repaired) {
    body = ensureUnofficialAdaptiveThinking(body)
    normalizeThinkingForModel(body)
    body = pinHaikuCliThinking(body)
    body = ensureUnofficialEffortHigh(body)
    body = ensureClearThinkingContextManagement(body)
  }
  body = stripInvalidThinkingBlocks(body)
  body = applyModelRequestRules(body)
  body = ensureOutputConfigSchema(body)
  body = alignSamplingWithThinking(body)
  body = stripIllegalCacheControlFields(body)
  body = removeCacheControlFields(body)
  body = applyMessageBreakpoints(body, normalizeCacheTtl(cacheTtl), 'rewrite')
  return applyCliHopSafeguards(body, safeguards, { safeguardsBeta, autoModeServer })
}
/** Wrap CLI process is spawned as sonnet-5/adaptive. Haiku rejects thinking. */
export function pinHaikuCliThinking(body = {}) {
  if (!body || typeof body !== 'object') return body
  if (!/haiku/i.test(String(body.model || ''))) return body
  return { ...body, thinking: { type: 'disabled' } }
}

export function prepareOutboundAttempt({
  requestContext = null,
  canonicalBody,
  inbound = {},
  identity,
  unofficial,
  stream = true,
  cacheControlLimit = 4,
  toolNameRewrite = true,
  cacheTtl = null,
  cacheBreakpoints = null,
  reqHeaders = {},
  officialClient,
  sessionId: sessionIdOverride,
  accountId = '',
  boundSessionId = '',
  boundAccountId = '',
  boundVmId = '',
  vmId = '',
  epoch,
  mode,
  routing,
  clientDiscriminator = undefined,
  clientIp = '',
  userAgent = '',
  apiKeyId = '',
  firstUserText = '',
  firstUserIdentity = '',
  authScheme,
  credentialMode,
} = {}) {
  const inferenceOnly = isAnySetupTokenMode(credentialMode) || isApiKeyMode(credentialMode)
  const keepCallerSession = officialClient === true || (officialClient == null && !unofficial)
  const sessionContext = {
    officialClient: keepCallerSession,
    accountId,
    boundSessionId,
    boundAccountId,
    boundVmId,
    vmId,
    epoch,
    mode,
    routing,
    clientDiscriminator,
    clientIp,
    userAgent: userAgent || reqHeaders?.['user-agent'] || '',
    apiKeyId,
    firstUserIdentity,
  }
  const sessionId =
    String(sessionIdOverride || '').trim() ||
    resolveOutboundSessionId(
      extractCallerSession({ inbound, body: canonicalBody, headers: reqHeaders }),
      sessionContext,
    )
  let identified = applyCrsIdentityReplace(
    officialMessagesBody(canonicalBody, { stream }),
    identity,
    inbound,
    reqHeaders,
    { officialClient: keepCallerSession, sessionId, ...sessionContext },
  )
  const callerSessionId = sessionIdFromOutboundBody(identified)
  if (identity && callerSessionId) identity.callerSessionId = callerSessionId
  if (identity && !requestContext) {
    identified = refreshOfficialSystemEnvironment(identified, identity, identified.model)
  }
  const stampOwnedBilling = String(sessionIdOverride || '').trim() && (mode !== 'passthrough' || !keepCallerSession)
  if (stampOwnedBilling) {
    identified = stampBillingPromptId(identified, sessionId, firstUserText)
  }
  if (requestContext?.purpose === 'auto_mode_classifier')
    return { body: prepareClassifierBody(identified, { stream }), toolNames: {} }
  // Official Claude Code places its own breakpoints; adding ours would shift the
  // prefix it already caches.
  let cleaned = prepareAnthropicRequest(identified, {
    cacheControlLimit,
    unofficial: !!unofficial && !inferenceOnly,
    cacheBreakpoints: keepCallerSession ? null : cacheBreakpoints,
    cacheTtl: cacheTtl || undefined,
    inbound,
  })
  cleaned = stripIllegalCacheControlFields(cleaned)
  if (cacheTtl) cleaned = applyCacheTtlToBody(cleaned, cacheTtl)
  cleaned = enforceCacheTtlOrder(cleaned)
  const tools = rewriteToolNames(cleaned, { enabled: toolNameRewrite !== false })
  return { body: tools.body, toolNames: tools.reverse }
}

export function prepareOutboundHeaders(reqHeaders, homeDir, identity, model, { credentialMode, want1m } = {}) {
  if (isAnySetupTokenMode(credentialMode) || isApiKeyMode(credentialMode)) {
    return {
      'user-agent': INFERENCE_UA,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': isApiKeyMode(credentialMode) ? apiKeyBetaHeader('') : setupTokenBetaHeader(model),
    }
  }
  return resolveCrsHeaders(reqHeaders, homeDir, identity, model, { want1m: want1m === true })
}

/** Body + headers after the context_management ↔ context-management beta gate. */
export function prepareOutboundEnvelope({
  canonicalBody,
  inbound = {},
  identity,
  unofficial,
  stream = true,
  cacheControlLimit = 4,
  toolNameRewrite = true,
  cacheTtl = null,
  cacheBreakpoints = null,
  reqHeaders = {},
  homeDir = '',
  officialClient,
  sessionId,
  accountId = '',
  boundSessionId = '',
  boundAccountId = '',
  boundVmId = '',
  vmId = '',
  epoch,
  mode,
  routing,
  clientDiscriminator,
  clientIp = '',
  userAgent = '',
  apiKeyId = '',
  firstUserText = '',
  firstUserIdentity = '',
  authScheme,
  credentialMode,
  want1m,
} = {}) {
  const prepared = prepareOutboundAttempt({
    canonicalBody,
    inbound,
    identity,
    unofficial,
    stream,
    cacheControlLimit,
    toolNameRewrite,
    cacheTtl,
    cacheBreakpoints,
    reqHeaders,
    officialClient,
    sessionId,
    accountId,
    boundSessionId,
    boundAccountId,
    boundVmId,
    vmId,
    epoch,
    mode,
    routing,
    clientDiscriminator,
    clientIp,
    userAgent,
    apiKeyId,
    firstUserText,
    firstUserIdentity,
    authScheme,
    credentialMode,
  })
  const headers = {
    ...prepareOutboundHeaders(
      reqHeaders,
      homeDir,
      identity,
      prepared.body?.model || inbound?.model || canonicalBody?.model,
      {
        credentialMode,
        want1m: want1m === true || hasClaudeCode1mSuffix(inbound?.model) || hasClaudeCode1mSuffix(canonicalBody?.model),
      },
    ),
  }
  if (String(authScheme || '').toLowerCase() === 'apikey' || isApiKeyMode(credentialMode)) {
    headers['anthropic-beta'] = apiKeyBetaHeader(headers['anthropic-beta'] || '')
    delete headers.authorization
    delete headers.Authorization
  }
  if (stream) headers.accept = 'text/event-stream'
  if (!isAnySetupTokenMode(credentialMode)) {
    const beta = ensureFastModeBeta(headers['anthropic-beta'] || '', prepared.body)
    if (beta) headers['anthropic-beta'] = beta
  }
  const body = sealClaudeCodeCch(sanitizeAnthropicBodyForBetaTokens(prepared.body, headers?.['anthropic-beta'] || ''))
  return { body, headers, toolNames: prepared.toolNames }
}
