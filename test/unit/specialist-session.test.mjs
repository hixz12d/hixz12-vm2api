import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { extractCallerSession, resolveOutboundSessionId } from '../../src/lib/identity/identity-rewrite.mjs'
import { StickyRouter } from '../../src/lib/pool/sticky-router.mjs'
import { FailoverRunner } from '../../src/lib/pool/failover-runner.mjs'

const parent = '11111111-2222-4333-8444-555555555555'
const headers = { 'x-claude-code-session-id': parent }
function body(task, specialist = true) {
  return {
    model: 'claude-opus-5-5',
    system: [
      { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.281; cc_entrypoint=claude-desktop' },
      { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." },
      {
        type: 'text',
        text: specialist
          ? 'You are a file search specialist for Claude Code.'
          : 'You are an interactive agent that helps users with software engineering tasks.',
      },
    ],
    metadata: { user_id: JSON.stringify({ device_id: 'shared-device', session_id: parent }) },
    messages: [{ role: 'user', content: task }],
  }
}
const session = (inbound) => extractCallerSession({ inbound, headers })
const success = () => ({
  ok: true,
  status: 200,
  terminalState: 'verified',
  body: { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' },
})

test('parent keeps its original session; distinct specialist histories get stable native session ids', () => {
  const main = body('Main task', false)
  const a = body('Inspect materials')
  const b = body('Inspect navigation')
  assert.equal(session(main), parent)
  assert.notEqual(session(a), parent)
  assert.notEqual(session(a), session(b))
  assert.match(session(a), /^[0-9a-f-]{36}$/)
  assert.equal(resolveOutboundSessionId(session(a), { officialClient: true }), session(a))
  const next = structuredClone(a)
  next.messages.push(
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'result' }] },
  )
  next.system[0].text = 'x-anthropic-billing-header: cc_version=2.1.282; cc_entrypoint=claude-desktop'
  next.tools = [{ name: 'AnotherTool' }]
  assert.equal(session(next), session(a), 'history, billing changes, and tool loading must not rotate the session')
})

test('header and body session fallbacks use the same branch mapping; separate parents remain isolated', () => {
  const a = body('Inspect materials')
  const expected = session(a)
  delete a.metadata
  assert.equal(session(a), expected)
  a.session_id = parent
  assert.equal(extractCallerSession({ inbound: a }), expected)
  assert.notEqual(
    extractCallerSession({ inbound: a, headers: { 'x-claude-code-session-id': 'different-parent' } }),
    expected,
  )
  assert.equal(extractCallerSession({ inbound: body('ordinary API prompt', false) }), parent)
})

test('task suffix beyond a common long preamble separates branches without using growing history', () => {
  assert.notEqual(session(body('x'.repeat(5000) + 'task A')), session(body('x'.repeat(5000) + 'task B')))
  const a = body('Inspect materials')
  a.messages[0].content = [
    { type: 'text', text: 'Inspect materials' },
    { type: 'text', text: 'transient notice' },
  ]
  assert.equal(session(a), session(body('Inspect materials')))
})

test('real sticky keys allow parent and independent specialists concurrently but serialize the same specialist', {
  timeout: 5000,
}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-specialist-'))
  const sticky = new StickyRouter({ dataDir: dir })
  const req = { headers, apiKeyRecord: { id: 'key-a' } }
  let releaseParent, releaseChild, parentStarted, childStarted
  const parentGate = new Promise((resolve) => {
    releaseParent = resolve
  })
  const childGate = new Promise((resolve) => {
    releaseChild = resolve
  })
  const startedParent = new Promise((resolve) => {
    parentStarted = resolve
  })
  const startedChild = new Promise((resolve) => {
    childStarted = resolve
  })
  let duplicateStarted = false
  let active = 0
  const runner = new FailoverRunner({
    scheduler: {
      async selectAndReserve() {
        active++
        return { ok: true, vmId: 'vm-03', accountId: 'account-a', release: () => active-- }
      },
      markSuccess() {},
    },
  })
  const run = (payload, callAttempt) =>
    runner.run({
      stickyKey: sticky.extractPoolKey(req, payload, { platform: 'anthropic' }),
      canonicalBody: payload,
      model: payload.model,
      callAttempt,
    })
  const pending = []
  try {
    const main = run(body('Main task', false), async () => {
      parentStarted()
      await parentGate
      return success()
    })
    pending.push(main)
    await startedParent
    const child = run(body('Inspect materials'), async () => {
      childStarted()
      await childGate
      return success()
    })
    pending.push(child)
    await startedChild
    assert.equal(active, 2, 'child must start while parent is still active')
    const duplicate = run(body('Inspect materials'), async () => {
      duplicateStarted = true
      return success()
    })
    pending.push(duplicate)
    const sibling = await run(body('Inspect navigation'), async () => success())
    assert.equal(sibling.ok, true)
    assert.equal(duplicateStarted, false, 'same task must still serialize')
    releaseChild()
    await child
    await duplicate
    assert.equal(duplicateStarted, true)
    assert.equal(active, 1, 'parent remains active while the children finish')
    releaseParent()
    await main
    assert.equal(active, 0)
    assert.notEqual(
      sticky.extractPoolKey(req, body('Inspect materials'), { platform: 'anthropic' }),
      sticky.extractPoolKey({ ...req, apiKeyRecord: { id: 'key-b' } }, body('Inspect materials'), {
        platform: 'anthropic',
      }),
    )
  } finally {
    releaseParent()
    releaseChild()
    await Promise.allSettled(pending)
    sticky.db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
