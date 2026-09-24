import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractCallerSession,
  resolveOutboundSessionId,
  applyCrsIdentityReplace,
  parseUserId,
} from '../../src/lib/identity/identity-rewrite.mjs'
import { StickyRouter } from '../../src/lib/pool/sticky-router.mjs'

function title() {
  return {
    model: 'claude-opus-5-5',
    max_tokens: 32000,
    tools: [],
    system: [
      { type: 'text', text: 'You are naming a coding session so the user can pick it out of a long list of sessions.' },
    ],
    metadata: { user_id: JSON.stringify({ device_id: 'device', session_id: 'parent' }) },
    messages: [{ role: 'user', content: [{ type: 'text', text: '<session>Fix a bug</session>\nWrite the title.' }] }],
  }
}

test('title requests preserve the caller session for metadata, headers and body identifiers', () => {
  const inbound = title()
  const withoutMeta = { ...inbound, metadata: undefined }
  assert.equal(extractCallerSession({ inbound }), 'parent')
  assert.equal(extractCallerSession({ body: inbound }), 'parent')
  assert.equal(extractCallerSession({ inbound: withoutMeta, headers: { 'x-session-id': 'parent' } }), 'parent')
  assert.equal(extractCallerSession({ inbound: { ...withoutMeta, session_id: 'parent' } }), 'parent')
  assert.equal(extractCallerSession({ inbound: withoutMeta }), '')
  for (const officialClient of [true, false]) {
    const out = applyCrsIdentityReplace(
      inbound,
      { deviceId: 'slot', accountUuid: 'account' },
      inbound,
      {},
      { officialClient },
    )
    assert.equal(parseUserId(out.metadata.user_id).session_id, resolveOutboundSessionId('parent', { officialClient }))
  }
})

test('title and main requests use the same pool key while different API keys stay isolated', () => {
  const router = Object.create(StickyRouter.prototype)
  router.config = { enabled: true, mode: 'conversation' }
  router.resolve = () => null
  const req = { apiKeyRecord: { id: 'key-a' }, headers: {} }
  const main = { ...title(), tools: [{ name: 'read' }], system: 'You are a coding assistant.' }
  const key = (body) => router.extractPoolKey(req, body, { platform: 'anthropic' })
  assert.equal(key(title()), key(main))
  assert.notEqual(
    key(title()),
    router.extractPoolKey({ ...req, apiKeyRecord: { id: 'key-b' } }, title(), { platform: 'anthropic' }),
  )
})
