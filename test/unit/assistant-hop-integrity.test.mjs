import test from 'node:test'
import assert from 'node:assert/strict'
import { finalizeAssembledAssistantHop, mergeAssembledAssistantHop } from '../../src/lib/core/errors.mjs'

const message = () => ({
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'complete-looking body' }],
  stop_reason: 'end_turn',
})

for (const committed of [false, true]) {
  test(`real upstream error survives assembly and finalization (committed=${committed})`, () => {
    const result = {
      ok: false,
      status: 200,
      terminalState: 'incomplete',
      committed,
      body: {
        type: 'error',
        error: { type: 'api_error', code: 'provider_failure', message: 'original provider error' },
      },
      usage: { input_tokens: 7 },
    }
    const finalized = finalizeAssembledAssistantHop(mergeAssembledAssistantHop(result, message()))
    assert.equal(finalized, result)
    assert.equal(finalized.body.error.message, 'original provider error')
    assert.equal(finalized.committed, committed)
  })
}

for (const terminalState of ['incomplete', 'transport_error', 'rejected']) {
  test(`complete-looking body does not override ${terminalState}`, () => {
    const result = { ok: false, committed: true, terminalState, body: message() }
    const finalized = finalizeAssembledAssistantHop(mergeAssembledAssistantHop(result, message()))
    assert.equal(finalized.ok, false)
    assert.equal(finalized.terminalState, terminalState)
    assert.equal(finalized.committed, true)
  })
}

test('transport error cannot become successful through assembled text', () => {
  const finalized = finalizeAssembledAssistantHop({ ok: false, transportError: true, body: message() })
  assert.equal(finalized.ok, false)
})

test('incomplete committed output stays committed, so it cannot be replayed', () => {
  const body = message()
  body.stop_reason = null
  const finalized = finalizeAssembledAssistantHop({ ok: true, committed: true, terminalState: 'verified', body })
  assert.equal(finalized.ok, false)
  assert.equal(finalized.committed, true)
  assert.equal(finalized.terminalState, 'incomplete')
})

test('empty local assembly cannot replace a complete worker response', () => {
  const result = { ok: true, terminalState: 'verified', body: message() }
  const empty = { type: 'message', role: 'assistant', content: [] }
  assert.equal(mergeAssembledAssistantHop(result, empty), result)
  assert.equal(finalizeAssembledAssistantHop(result), result)
})
