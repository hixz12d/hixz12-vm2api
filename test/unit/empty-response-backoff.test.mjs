import test from 'node:test'
import assert from 'node:assert/strict'
import { FailoverRunner } from '../../src/lib/pool/failover-runner.mjs'
import { EmptyResponseBackoff } from '../../src/lib/pool/empty-response-backoff.mjs'

const body = { model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'same request' }] }
const empty = () => ({
  ok: false,
  status: 502,
  committed: false,
  terminalState: 'incomplete',
  body: { type: 'error', error: { type: 'api_error', code: 'empty_response', message: 'No visible output' } },
})
const success = () => ({
  ok: true,
  status: 200,
  terminalState: 'verified',
  body: { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' },
})

function fixture() {
  const state = { calls: 0, inflight: 0, parked: false, cooldowns: [] }
  const scheduler = {
    async selectAndReserve({ excluded }) {
      state.calls++
      if (state.parked || excluded.has('account-1')) return { ok: false, reason: 'no_eligible_accounts' }
      state.inflight++
      return {
        ok: true,
        vmId: 'vm-01',
        accountId: 'account-1',
        release: () => state.inflight--,
      }
    },
    markSuccess() {},
    markCooldown(_candidate, update) {
      state.cooldowns.push(update)
      state.parked = true
    },
  }
  const runner = new FailoverRunner({
    scheduler,
    config: { same_account_retry_delay_ms: 0 },
    rateLimitService: {
      tempUnschedule: () => {
        state.parked = true
      },
    },
  })
  const request = (stickyKey, callAttempt, canonicalBody = body) =>
    runner.run({ stickyKey, model: body.model, canonicalBody, callAttempt })
  return { state, runner, request }
}

test('one failing conversation cannot park an account serving another conversation', async () => {
  const { state, request } = fixture()
  let entered, finish
  const started = new Promise((resolve) => {
    entered = resolve
  })
  const running = new Promise((resolve) => {
    finish = resolve
  })
  const healthy = request('key:healthy-session', async () => {
    entered()
    await running
    return success()
  })
  await started
  try {
    const failed = await request('key:bad-session', empty)
    assert.equal(failed.status, 503)
    assert.equal(failed.body.error.details.last_reason, 'empty_response')
    assert.equal(state.parked, false)
    assert.deepEqual(state.cooldowns, [])
    assert.equal(state.inflight, 1, 'the unrelated live request keeps its reservation')
    assert.equal((await request('key:another-session', success)).ok, true)
  } finally {
    finish()
    await healthy
  }
  assert.equal(state.inflight, 0)
})

test('only an identical request in the same session backs off; new sessions and changed requests work', async () => {
  const { state, request } = fixture()
  await request('key:bad-session', empty)
  const before = state.calls
  const blocked = await request('key:bad-session', empty)
  assert.equal(blocked.body.error.code, 'request_empty_response_backoff')
  assert.ok(blocked.body.error.details.retry_after_ms > 0)
  assert.equal(state.calls, before, 'backoff must not reserve or contact an account')
  assert.equal((await request('key:new-session', success)).ok, true)
  assert.equal((await request('another-key:bad-session', success)).ok, true)
  assert.equal((await request('key:bad-session', success, { ...body, max_tokens: 100 })).ok, true)
})

test('changing the key group does not inherit the previous group request backoff', async () => {
  const { runner } = fixture()
  const args = { stickyKey: 'key:same-session', canonicalBody: body, model: body.model }
  await runner.run({ ...args, groupScope: { id: 2, allowsVm: () => true }, callAttempt: empty })
  const blocked = await runner.run({ ...args, groupScope: { id: 2, allowsVm: () => true }, callAttempt: empty })
  assert.equal(blocked.body.error.code, 'request_empty_response_backoff')
  const changed = await runner.run({ ...args, groupScope: { id: 3, allowsVm: () => true }, callAttempt: success })
  assert.equal(changed.ok, true)
})

test('already queued duplicate requests recheck backoff after the failed predecessor finishes', async () => {
  const { request } = fixture()
  let finish
  const gate = new Promise((resolve) => {
    finish = resolve
  })
  let attempts = 0
  const call = async () => {
    attempts++
    await gate
    return empty()
  }
  const first = request('key:queued-session', call)
  const second = request('key:queued-session', call)
  finish()
  const [a, b] = await Promise.all([first, second])
  assert.equal(a.status, 503)
  assert.equal(b.body.error.code, 'request_empty_response_backoff')
  assert.equal(attempts, 2, 'only the original request and its one same-account retry run')
})

test('anonymous empty responses also cannot cool down a shared account', async () => {
  const { state, request } = fixture()
  await request(null, empty)
  assert.equal(state.parked, false)
  assert.equal((await request(null, success)).ok, true)
})

test('request backoff expires, bounds retained state, and stores hashes instead of request bodies', () => {
  let now = 1000
  const guard = new EmptyResponseBackoff({ maxEntries: 2, now: () => now })
  guard.record('session-1', body, 60_000)
  assert.equal(guard.remaining('session-1', body), 60_000)
  assert.equal(guard.remaining('session-1', { ...body, model: 'claude-sonnet-5' }), 0)
  assert.equal(guard.remaining('session-2', body), 0)
  assert.equal(JSON.stringify([...guard.entries.values()]).includes('same request'), false)
  now += 60_000
  assert.equal(guard.remaining('session-1', body), 0)
  assert.equal(guard.entries.size, 0)
  for (const key of ['a', 'b', 'c']) guard.record(key, body, 1000)
  assert.equal(guard.entries.size, 2)
  assert.equal(guard.remaining('a', body), 0)
  now += 1001
  guard.record('d', body, 1000)
  assert.equal(guard.entries.size, 1)
})
