import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStreamProgress } from '../../src/lib/protocol/stream-progress.mjs'
import { RequestLogStore } from '../../src/lib/admin/request-log.mjs'
import { restoreUncommittedHop } from '../../src/lib/transport/go-worker-client.mjs'

test('stream diagnostics distinguish reasoning, visible text and tool input without retaining content', () => {
  let now = 1000
  const progress = createStreamProgress(now, () => now)
  progress.observe({ type: 'message_start' })
  now += 2000
  progress.observe({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'private reasoning' } })
  now += 60_000
  progress.observe({ type: 'ping' })
  assert.equal(progress.snapshot().last_content_ms, 2000, 'keepalive is not content progress')
  now += 1000
  progress.observe({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } })
  now += 100
  progress.observe({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"x":1}' } })
  const stats = progress.snapshot()
  assert.equal(stats.first_thinking_ms, 2000)
  assert.equal(stats.first_text_ms, 63_000)
  assert.equal(stats.max_content_gap_ms, 61_000)
  assert.equal(stats.thinking_chars, 17)
  assert.equal(stats.text_chars, 5)
  assert.equal(stats.tool_input_chars, 7)
  assert.doesNotMatch(JSON.stringify(stats), /private reasoning|hello/)
})

test('empty-hop normalization retains the original error for diagnostics', () => {
  const result = restoreUncommittedHop({
    ok: false,
    status: 200,
    committed: false,
    body: { type: 'error', error: { type: 'api_error', code: 'original_code', message: 'original failure' } },
  })
  assert.equal(result.body.error.code, 'empty_response')
  assert.equal(result.upstreamError.code, 'original_code')
  assert.equal(result.upstreamError.message, 'original failure')
})

test('debug logs persist separate queue/stream timing and redact original upstream errors', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-stream-diagnostics-'))
  const store = new RequestLogStore({ dataDir, mode: 'debug' })
  try {
    const ctx = store.start({ method: 'POST', headers: {}, socket: {} }, { pathName: '/v1/messages' })
    store.finish(ctx, {
      status: 502,
      model: 'claude-opus-5-5',
      session_queue_ms: 49_000,
      stream_progress: { first_text_ms: 2500, thinking_chars: 1000, max_content_gap_ms: 30 },
      upstream_error: { code: 'original_code', message: 'upstream rejected Bearer private-secret-value' },
    })
    const debug = store.getDebug(ctx.request_id)
    assert.equal(debug.session_queue_ms, 49_000)
    assert.equal(debug.stream_progress.first_text_ms, 2500)
    assert.equal(debug.upstream_error.code, 'original_code')
    assert.match(debug.upstream_error.message, /REDACTED/)
    assert.doesNotMatch(debug.upstream_error.message, /private-secret-value/)
  } finally {
    store.db.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
