import test from 'node:test'
import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { syncBuiltinESMExports } from 'node:module'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import {
  sessionKeyToOAuth,
  exchangeTokenViaCookieAuth,
  classifyImportHelperOutput,
  publicImportError,
  panelImportErrorPayload,
  buildSetupTokenAuthorizeURL,
  extractOAuthCodeFromRedirect,
} from '../../src/lib/oauth/cookie-auth.mjs'
import { FULL_OAUTH_SCOPE, REDIRECT_URI } from '../../src/lib/oauth/oauth-contract.mjs'

// auth.js is private upstream source and is not distributed. Exercise the production
// JSON subprocess boundary instead of a separate, unavailable JavaScript implementation.
function mockService(t, respond) {
  const previous = process.env.KIN_OAUTH_AUTH_BIN
  const binary = fileURLToPath(import.meta.url)
  process.env.KIN_OAUTH_AUTH_BIN = binary
  const mocked = t.mock.method(childProcess, 'spawn', (command, args, options) => {
    assert.equal(command, binary)
    assert.deepEqual(args, [])
    assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe'])
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    let input = ''
    child.stdin.on('data', (chunk) => {
      input += chunk
    })
    child.stdin.on('finish', () => {
      queueMicrotask(() => {
        const result = respond(JSON.parse(input))
        if (result.spawnError) {
          child.emit('error', new Error(result.spawnError))
          return
        }
        child.stdout.end(result.raw ?? `${JSON.stringify(result)}\n`)
        child.stderr.end()
        child.emit('close', result.ok ? 0 : 1)
      })
    })
    return child
  })
  syncBuiltinESMExports()
  t.after(() => {
    mocked.mock.restore()
    syncBuiltinESMExports()
    if (previous === undefined) delete process.env.KIN_OAUTH_AUTH_BIN
    else process.env.KIN_OAUTH_AUTH_BIN = previous
  })
}

const credential = {
  access_token: 'sk-ant-oat01-fixture',
  refresh_token: 'sk-ant-ort01-fixture',
  email: 'fixture@example.com',
  scope: FULL_OAUTH_SCOPE,
}

test('fake credentials preserve full scopes and setup-token runtime mode', async () => {
  const previous = process.env.KIN_FAKE_SESSION_OAUTH
  process.env.KIN_FAKE_SESSION_OAUTH = '1'
  try {
    const full = await sessionKeyToOAuth('sk-ant-sid-fixture')
    assert.equal(full.source, 'KIN_FAKE_SESSION_OAUTH')
    assert.equal(full.type, 'oauth')
    assert.ok(full.expires_at > Date.now() / 1000)
    const setup = await sessionKeyToOAuth('sk-ant-sid-fixture', { scope: 'inference' })
    assert.equal(setup.type, 'setup-token')
    assert.equal(setup.mode, 'setup-token')
    assert.equal(setup.scope, FULL_OAUTH_SCOPE)
    await assert.rejects(() => sessionKeyToOAuth('invalid'), /sk-ant-sid/)
  } finally {
    if (previous === undefined) delete process.env.KIN_FAKE_SESSION_OAUTH
    else process.env.KIN_FAKE_SESSION_OAUTH = previous
  }
})

test('session import sends full scopes and the selected VM proxy to the binary', async (t) => {
  mockService(t, (payload) => {
    assert.deepEqual(payload, {
      operation: 'session_key',
      session_key: 'sk-ant-sid-fixture',
      scope: FULL_OAUTH_SCOPE,
      runtime_mode: 'setup-token',
      proxy_url: 'socks5://127.0.0.1:1080',
      timeout_ms: 12000,
    })
    return { ok: true, credential }
  })
  const result = await sessionKeyToOAuth(' "sk-ant-sid-fixture" ', {
    scope: 'inference',
    proxyUrl: 'socks5://127.0.0.1:1080',
    timeoutMs: 12000,
  })
  assert.equal(result.type, 'setup-token')
  assert.equal(result.scope, FULL_OAUTH_SCOPE)
  assert.equal(result.email, credential.email)
})

test('code exchange preserves callback state, verifier, redirect and proxy', async (t) => {
  mockService(t, (payload) => {
    assert.deepEqual(payload, {
      operation: 'exchange_code',
      code: 'abc',
      state: 'state-1',
      code_verifier: 'verifier',
      redirect_uri: REDIRECT_URI,
      proxy_url: 'socks5h://127.0.0.1:1080',
      timeout_ms: 15000,
    })
    return { ok: true, credential }
  })
  assert.deepEqual(
    await exchangeTokenViaCookieAuth({
      code: 'abc#state-1',
      codeVerifier: 'verifier',
      proxyUrl: 'socks5h://127.0.0.1:1080',
    }),
    credential,
  )
})

test('session import propagates binary proxy validation errors', async (t) => {
  mockService(t, () => ({ ok: false, error: { code: 'proxy_required', message: 'VM SOCKS5 required' } }))
  await assert.rejects(
    () => sessionKeyToOAuth('sk-ant-sid-fixture', { proxyUrl: '' }),
    (e) => e.code === 'proxy_required',
  )
})

test('session import redacts token bodies and retains helper error codes', async (t) => {
  mockService(t, () => ({ ok: false, error: { code: 'token_rejected', message: 'bad sk-ant-oat01-SECRET' } }))
  await assert.rejects(
    () => sessionKeyToOAuth('sk-ant-sid-fixture'),
    (e) => {
      assert.equal(e.code, 'token_rejected')
      assert.match(e.message, /\[redacted-token\]/)
      assert.doesNotMatch(e.message, /SECRET/)
      return true
    },
  )
})

test('code exchange rejects malformed binary output', async (t) => {
  mockService(t, () => ({ raw: 'not JSON\n' }))
  await assert.rejects(
    () => exchangeTokenViaCookieAuth({ code: 'fixture' }),
    (e) => e.code === 'oauth_auth_output_invalid',
  )
})

test('code exchange reports a binary startup failure', async (t) => {
  mockService(t, () => ({ spawnError: 'exec format error' }))
  await assert.rejects(
    () => exchangeTokenViaCookieAuth({ code: 'fixture' }),
    (e) => e.code === 'oauth_auth_spawn_failed',
  )
})

test('authorize freshness and proxy failures retain actionable public errors', () => {
  assert.equal(classifyImportHelperOutput('403 Session is not fresh enough'), 'session_stale_relogin')
  assert.match(publicImportError('Session is not fresh enough'), /不够新/)
  assert.doesNotMatch(publicImportError('Session is not fresh enough'), /Cloudflare/)
  const proxy = panelImportErrorPayload({ message: 'User was rejected by the SOCKS5 server' })
  assert.equal(proxy.status, 400)
  assert.equal(proxy.error.code, 'proxy_auth_rejected')
  assert.match(proxy.error.message, /SOCKS5 拒绝了用户名或密码/)
  const missing = panelImportErrorPayload({ code: 'authorize_no_code', message: 'authorize_no_code' })
  assert.equal(missing.status, 400)
  assert.match(missing.error.message, /CAI 授权页/)
})

test('setup-token authorize URL requests full OAuth scopes', () => {
  const url = new URL(buildSetupTokenAuthorizeURL('state', 'challenge'))
  assert.equal(url.origin, 'https://claude.com')
  assert.equal(url.searchParams.get('scope'), FULL_OAUTH_SCOPE)
  assert.equal(url.searchParams.get('state'), 'state')
  assert.equal(url.searchParams.get('code_challenge'), 'challenge')
})

test('callback parsing accepts query and fragment forms', () => {
  assert.deepEqual(extractOAuthCodeFromRedirect(`${REDIRECT_URI}?code=abc&state=xyz`), { code: 'abc', state: 'xyz' })
  assert.equal(extractOAuthCodeFromRedirect({ redirect_uri: 'https://example.test/#code=tok&state=s' }).code, 'tok')
  assert.equal(extractOAuthCodeFromRedirect('https://example.test/nope'), null)
})

test('extractOAuthCodeFromRedirect reads callback query', () => {
  const got = extractOAuthCodeFromRedirect('https://platform.claude.com/oauth/code/callback?code=abc123&state=xyz')
  assert.equal(got.code, 'abc123')
  assert.equal(got.state, 'xyz')
  assert.equal(extractOAuthCodeFromRedirect({ redirect_uri: 'https://x.test/?code=tok#state=s' }).code, 'tok')
  assert.equal(extractOAuthCodeFromRedirect('https://x.test/nope'), null)
})

test('authorize_no_code is a 400 not Cloudflare', () => {
  assert.equal(classifyImportHelperOutput('authorize_no_code login_redirect'), 'authorize_no_code')
  assert.match(publicImportError('authorize_no_code login_redirect'), /CAI 授权页/)
  const payload = panelImportErrorPayload({ code: 'authorize_no_code', message: 'authorize_no_code' })
  assert.equal(payload.status, 400)
  assert.equal(payload.error.code, 'authorize_no_code')
})

function response(status, body, stream = false) {
  const text = JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    ...(stream
      ? {
          body: (async function* () {
            yield Buffer.from(text)
          })(),
        }
      : { text: async () => text }),
  }
}

function makeStrictOAuthFetch(seen, opts = {}) {
  return async (url, init = {}) => {
    const headers = init.headers || {}
    if (url === 'https://claude.ai/api/organizations') {
      seen.push({ stage: 'orgs' })
      assert.equal(init.method, 'GET')
      assert.match(headers.cookie || headers.Cookie || '', /sessionKey=sk-ant-sid01-testaaaaaaaa/)
      assert.match(headers['user-agent'] || headers['User-Agent'] || '', /Chrome\/146\.0\.0\.0/)
      return response(200, [{ uuid: 'org-sk', name: 'Team', raven_type: 'team' }])
    }
    if (url === 'https://platform.claude.com/v1/oauth/org-sk/authorize') {
      seen.push({ stage: 'authorize' })
      const body = JSON.parse(init.body)
      assert.equal(init.method, 'POST')
      assert.equal(headers['content-type'], 'application/json')
      assert.match(headers.cookie || headers.Cookie || '', /sessionKey=sk-ant-sid01-testaaaaaaaa/)
      assert.match(headers['user-agent'] || headers['User-Agent'] || '', /Chrome\/146\.0\.0\.0/)
      assert.equal(body.response_type, 'code')
      assert.equal(body.client_id, '9d1c250a-e61b-44d9-88ed-5944d1962f5e')
      assert.equal(body.redirect_uri, REDIRECT_URI)
      assert.equal(body.scope, FULL_OAUTH_SCOPE)
      assert.equal(body.code_challenge_method, 'S256')
      assert.ok(body.code_challenge)
      assert.ok(body.state)
      assert.equal(Object.prototype.hasOwnProperty.call(body, 'organization_uuid'), false)
      const status = opts.authorizeStatus || 200
      if (status >= 400) return response(status, opts.authorizeBody || { error: 'authorize failed' })
      return response(200, { redirect_uri: `${REDIRECT_URI}?code=auth-code&state=${body.state}` })
    }
    if (url === TOKEN_URL) {
      seen.push({ stage: 'token' })
      const body = JSON.parse(init.body)
      assert.equal(init.method, 'POST')
      assert.equal(headers['user-agent'] || headers['User-Agent'], 'claude-cli/2.1.284 (external, sdk-cli)')
      assert.equal(headers['x-app'], 'cli')
      assert.equal(body.grant_type, 'authorization_code')
      assert.equal(body.redirect_uri, REDIRECT_URI)
      assert.equal(body.client_id, '9d1c250a-e61b-44d9-88ed-5944d1962f5e')
      assert.ok(body.code_verifier)
      assert.equal(Object.prototype.hasOwnProperty.call(body, 'expires_in'), false)
      const status = opts.tokenStatus || 200
      if (status >= 400) return response(status, opts.tokenBody || { error: 'bad token' })
      return response(
        200,
        {
          access_token: 'sk-ant-oat01-token',
          refresh_token: 'sk-ant-ort01-token',
          expires_in: 3600,
          scope: FULL_OAUTH_SCOPE,
        },
        opts.tokenStream === true,
      )
    }
    if (url === 'https://api.anthropic.com/api/claude_cli/bootstrap?entrypoint=claude-vscode&model=claude-opus-5') {
      seen.push({ stage: 'bootstrap' })
      assert.equal(init.method, 'GET')
      assert.equal(headers['user-agent'], 'claude-cli/2.1.284 (external, sdk-cli)')
      assert.equal(headers['x-app'], 'cli')
      assert.equal(headers['anthropic-beta'], 'oauth-2025-04-20')
      assert.equal(headers.authorization, 'Bearer sk-ant-oat01-token')
      return response(200, {
        oauth_account: {
          account_uuid: 'acct-sk',
          account_email: 'sk@example.com',
          organization_uuid: 'org-sk',
        },
      })
    }
    if (url === 'https://platform.claude.com/api/oauth/account/settings') {
      seen.push({ stage: 'grove' })
      assert.equal(init.method, 'PATCH')
      assert.equal(headers['user-agent'], 'claude-cli/2.1.284 (external, sdk-cli)')
      assert.deepEqual(JSON.parse(init.body), { grove_enabled: true })
      if (opts.groveStatus) return response(opts.groveStatus, { error: 'unsupported path' })
      return response(200, { ok: true })
    }
    if (url === 'https://api.anthropic.com/api/oauth/account/settings') {
      seen.push({ stage: 'grove_fallback' })
      assert.equal(init.method, 'PATCH')
      assert.deepEqual(JSON.parse(init.body), { grove_enabled: true })
      return response(200, { ok: true })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
}
