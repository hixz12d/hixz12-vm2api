import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dispatchStreamInference } from '../../src/lib/transport/kernel-router.mjs'
import { resetWrapRecycleState } from '../../src/lib/transport/rust-kernel-supervisor.mjs'
import { isCompleteAssistantMessage } from '../../src/lib/core/errors.mjs'

const unixTest = process.platform === 'win32' ? test.skip : test

async function runStream(events, headers = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-integrity-'))
  const socket = path.join(root, 'kernel.sock')
  const token = path.join(root, 'internal.token')
  fs.writeFileSync(token, 'test-token')
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'x-kin-terminal-state': 'verified', ...headers })
    for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`)
    res.end()
  })
  await new Promise((resolve) => server.listen(socket, resolve))
  const previous = process.env.KIN_KERNEL_BIN
  process.env.KIN_KERNEL_BIN = '/bin/true'
  resetWrapRecycleState()
  let recycled = 0
  let commits = 0
  const lines = []
  try {
    const result = await dispatchStreamInference({
      exec: { vmId: 'vm-integrity', vm: { runtime: { kernel_socket: socket, worker_token_file: token } } },
      body: { model: 'claude-opus-5', messages: [{ role: 'user', content: 'hi' }] },
      ensureRust: async () => ({ ok: true }),
      recycleWrap: () => {
        recycled += 1
      },
      onCommit: () => {
        commits += 1
      },
      onEvent: (line) => lines.push(line),
      timeoutMs: 2000,
    })
    return { result, recycled, commits, lines }
  } finally {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(root, { recursive: true, force: true })
    resetWrapRecycleState()
    if (previous == null) delete process.env.KIN_KERNEL_BIN
    else process.env.KIN_KERNEL_BIN = previous
  }
}

const start = {
  type: 'message_start',
  message: {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [],
    usage: { input_tokens: 7, output_tokens: 0 },
  },
}
const text = [
  start,
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } },
  { type: 'content_block_stop', index: 0 },
]
const end = [
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
  { type: 'message_stop' },
]

unixTest('real streaming text retains its body and passes pool completeness checks', async () => {
  const { result, recycled, commits } = await runStream([...text, ...end])
  assert.equal(result.ok, true)
  assert.equal(result.terminalState, 'verified')
  assert.equal(result.body.content[0].text, 'OK')
  assert.equal(result.body.usage.input_tokens, 7)
  assert.equal(result.body.usage.output_tokens, 2)
  assert.equal(isCompleteAssistantMessage(result), true)
  assert.equal(commits, 1)
  assert.equal(recycled, 0)
})

unixTest('tool-only streams preserve complete tool input and do not recycle', async () => {
  const { result, recycled } = await runStream([
    start,
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tool_1', name: 'lookup', input: {} },
    },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"value":42}' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
    { type: 'message_stop' },
  ])
  assert.equal(result.ok, true)
  assert.deepEqual(result.body.content[0].input, { value: 42 })
  assert.equal(isCompleteAssistantMessage(result), true)
  assert.equal(recycled, 0)
})

unixTest('an empty stream labelled verified is incomplete and recycles before returning', async () => {
  const { result, recycled, commits } = await runStream([start])
  assert.equal(result.ok, false)
  assert.equal(result.terminalState, 'incomplete')
  assert.equal(result.committed, false)
  assert.equal(commits, 0)
  assert.equal(recycled, 1)
})

unixTest('a partial committed response keeps its commit flag and recycles', async () => {
  const { result, recycled } = await runStream(text)
  assert.equal(result.ok, false)
  assert.equal(result.terminalState, 'incomplete')
  assert.equal(result.committed, true)
  assert.equal(recycled, 1)
})

unixTest('visible output with a stop reason follows upstream completion without message_stop', async () => {
  const { result, recycled } = await runStream([...text, end[0]])
  assert.equal(result.ok, true)
  assert.equal(result.terminalState, 'verified')
  assert.equal(result.committed, true)
  assert.equal(result.body.content[0].text, 'OK')
  assert.equal(recycled, 0)
})

unixTest('thinking-only output is incomplete even with a terminal marker', async () => {
  const { result, recycled } = await runStream([
    start,
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: 'thinking' } },
    ...end,
  ])
  assert.equal(result.ok, false)
  assert.equal(result.terminalState, 'incomplete')
  assert.equal(result.committed, true)
  assert.equal(recycled, 1)
})

unixTest('an upstream error survives message assembly without exposing a partial stream', async () => {
  const { result, recycled, lines } = await runStream([
    start,
    { type: 'error', error: { type: 'api_error', message: 'Connection error' } },
  ])
  assert.equal(result.ok, false)
  assert.equal(result.body.error.message, 'Connection error')
  assert.equal(result.committed, false)
  assert.deepEqual(lines, [])
  assert.equal(recycled, 1)
})
