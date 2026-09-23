import test from 'node:test'
import assert from 'node:assert/strict'
import { isSessionTitleRequest } from '../../src/lib/protocol/session-title.mjs'
import {
  extractCallerSession,
  resolveOutboundSessionId,
  applyCrsIdentityReplace,
  parseUserId,
} from '../../src/lib/identity/identity-rewrite.mjs'
import { StickyRouter } from '../../src/lib/pool/sticky-router.mjs'
import { SessionQueue } from '../../src/lib/pool/session-queue.mjs'

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

function main() {
  return { ...title(), tools: [{ name: 'read' }], system: 'You are a coding assistant.' }
}

test('SDK title task is recognized despite its 32000-token budget', () => {
  assert.equal(isSessionTitleRequest(title()), true)
  assert.equal(isSessionTitleRequest({ ...title(), system: title().system[0].text }), true)
  for (const patch of [
    { model: 'gpt-5.4' },
    { tools: [{ name: 'read' }] },
    { thinking: { type: 'adaptive' } },
    { system: 'Summarize this.' },
    { messages: [...title().messages, { role: 'assistant', content: 'Hello' }] },
    { messages: [{ role: 'user', content: [{ type: 'tool_result', content: '<session>x</session> title' }] }] },
    { messages: [{ role: 'user', content: 'An ordinary short prompt' }] },
  ])
    assert.equal(isSessionTitleRequest({ ...title(), ...patch }), false, JSON.stringify(patch))
})

test('title session is stable, distinct from parent and uses all supported caller identifiers', () => {
  const expected = extractCallerSession({ inbound: title() })
  assert.notEqual(expected, 'parent')
  assert.equal(extractCallerSession({ inbound: main() }), 'parent')
  const withoutMeta = { ...title(), metadata: undefined }
  assert.equal(extractCallerSession({ inbound: withoutMeta, headers: { 'x-session-id': 'parent' } }), expected)
  assert.equal(extractCallerSession({ inbound: { ...withoutMeta, session_id: 'parent' } }), expected)
  assert.equal(extractCallerSession({ body: title() }), expected)
  assert.equal(extractCallerSession({ inbound: withoutMeta }), '')
  assert.notEqual(extractCallerSession({ inbound: { ...withoutMeta, session_id: 'another-parent' } }), expected)
  for (const officialClient of [true, false]) {
    const parentId = resolveOutboundSessionId('parent', { officialClient })
    const childId = resolveOutboundSessionId(expected, { officialClient })
    assert.notEqual(childId, parentId)
    const out = applyCrsIdentityReplace(
      title(),
      { deviceId: 'slot', accountUuid: 'account' },
      title(),
      {},
      { officialClient },
    )
    assert.equal(parseUserId(out.metadata.user_id).session_id, childId)
  }
})

test('title finishes while parent is blocked, but a second parent turn stays FIFO', async () => {
  // Use the production key extraction path without opening an unrelated database.
  const router = Object.create(StickyRouter.prototype)
  router.config = { enabled: true, mode: 'conversation' }
  router.resolve = () => null
  const req = { apiKeyRecord: { id: 'key-a' }, headers: {} }
  const key = (body) => router.extractPoolKey(req, body, { platform: 'anthropic' })
  const parentKey = key(main())
  const titleKey = key(title())
  assert.notEqual(titleKey, parentKey)
  assert.equal(titleKey, key(title()))
  assert.notEqual(
    titleKey,
    router.extractPoolKey({ ...req, apiKeyRecord: { id: 'key-b' } }, title(), { platform: 'anthropic' }),
  )
  const queue = new SessionQueue()
  let release
  const blocked = new Promise((resolve) => {
    release = resolve
  })
  const events = []
  const parent = queue.run(parentKey, async () => {
    events.push('parent-start')
    await blocked
    events.push('parent-end')
  })
  const next = queue.run(parentKey, async () => {
    events.push('next-turn')
  })
  try {
    const child = queue.run(titleKey, async () => {
      events.push('title-end')
    })
    // Two microtask turns suffice to enter the independent queue; no wall-clock race.
    await Promise.resolve()
    await Promise.resolve()
    assert.deepEqual(events, ['parent-start', 'title-end'])
    await child
  } finally {
    release()
    await Promise.all([parent, next])
  }
  assert.deepEqual(events, ['parent-start', 'title-end', 'parent-end', 'next-turn'])
})
