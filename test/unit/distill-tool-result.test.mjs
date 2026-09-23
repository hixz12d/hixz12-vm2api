import test from 'node:test'
import assert from 'node:assert/strict'
import { detectDistill, extractPrompt } from '../../src/lib/core/distill-detect.mjs'

const needle = 'MUST extract durable memory'
const base = { model: 'claude-opus-5-5', max_tokens: 128000, tools: [{ name: 'read' }] }

test('reading the changelog does not poison the tool-result turn or a later Continue', () => {
  for (const content of [needle, [{ type: 'text', text: needle }]]) {
    const messages = [
      { role: 'user', content: 'Read CHANGELOG.md and fix concurrency.' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'read-1', name: 'read', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read-1', content }] },
    ]
    for (const tail of [
      [],
      [
        { role: 'assistant', content: 'Found the changelog.' },
        { role: 'user', content: '继续' },
      ],
    ]) {
      const inbound = { ...base, messages: [...messages, ...tail] }
      assert.equal(detectDistill({ inbound, body: structuredClone(inbound) }).action, 'pass')
      assert.equal(extractPrompt(inbound, inbound).joined.includes(needle), false)
    }
  }
})

test('a direct instruction beside tool output remains checked, including system and developer', () => {
  for (const role of ['user', 'system', 'developer']) {
    const inbound = {
      ...base,
      messages: [
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'benign' }] },
        { role, content: [{ type: 'text', text: needle }] },
      ],
    }
    assert.equal(detectDistill({ inbound }).action, 'block', role)
  }
  const inbound = {
    ...base,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'read-1', content: needle },
          { type: 'text', text: needle },
        ],
      },
    ],
  }
  assert.equal(detectDistill({ inbound }).action, 'block')
})

test('OpenAI tool outputs are excluded before and after Anthropic conversion', () => {
  const body = {
    ...base,
    messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read-1', content: needle }] }],
  }
  for (const inbound of [
    { ...base, messages: [{ role: 'tool', content: needle }] },
    { ...base, input: [{ type: 'function_call_output', call_id: 'read-1', output: needle }] },
  ])
    assert.equal(detectDistill({ inbound, body }).action, 'pass')
  const inbound = {
    ...base,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: needle }] }],
  }
  assert.equal(detectDistill({ inbound }).action, 'block')
})
