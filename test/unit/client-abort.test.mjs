import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { EventEmitter } from 'node:events'
import { createClientAbort } from '../../src/lib/http/client-abort.mjs'
import { FailoverRunner } from '../../src/lib/pool/failover-runner.mjs'

function success() {
  return {
    ok: true,
    status: 200,
    terminalState: 'verified',
    body: { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' },
  }
}

test('disconnect after receiving SSE cancels the active hop and releases a waiting session', {
  timeout: 5000,
}, async (t) => {
  let inflight = 0
  let legacyAborts = 0
  let firstDone, followupDone
  const stopped = new Promise((resolve) => {
    firstDone = resolve
  })
  const advanced = new Promise((resolve) => {
    followupDone = resolve
  })
  const runner = new FailoverRunner({
    scheduler: {
      async selectAndReserve() {
        inflight++
        return { ok: true, vmId: 'vm-01', accountId: 'a1', release: () => inflight-- }
      },
      markSuccess() {},
    },
  })
  const server = http.createServer(async (req, res) => {
    req.on('aborted', () => legacyAborts++)
    for await (const chunk of req) {
    }
    const { abortController, detachClientAbort } = createClientAbort(req, res)
    const result = await runner.run({
      stickyKey: 'same-session',
      canonicalBody: {},
      model: 'claude-sonnet-5',
      signal: abortController.signal,
      callAttempt: async ({ signal }) => {
        const aborted = new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('data: started\n\n')
        // A second turn is already waiting behind this request.
        void runner.run({ stickyKey: 'same-session', canonicalBody: {}, callAttempt: success }).then(followupDone)
        await aborted
        return { ok: false, status: 0, terminalState: 'cancelled', body: { error: { code: 'request_cancelled' } } }
      },
    })
    detachClientAbort()
    firstDone(result)
  })
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const client = http.request({ hostname: '127.0.0.1', port: server.address().port, method: 'POST' }, (res) => {
    res.once('data', () => res.destroy())
  })
  client.end('{}')
  const [cancelled, next] = await Promise.all([stopped, advanced])
  assert.equal(legacyAborts, 0, 'req.aborted alone misses response-side disconnects')
  assert.equal(cancelled.clientCancelled, true)
  assert.equal(cancelled.body.error.code, 'client_cancelled')
  assert.equal(next.ok, true)
  assert.equal(inflight, 0)
})

test('normal response completion does not cancel and observers are detached', () => {
  const req = new EventEmitter()
  const res = new EventEmitter()
  const { abortController, detachClientAbort } = createClientAbort(req, res)
  res.writableEnded = true
  res.emit('close')
  assert.equal(abortController.signal.aborted, false)
  detachClientAbort()
  assert.equal(req.listenerCount('aborted'), 0)
  assert.equal(res.listenerCount('close'), 0)
})

test('already disconnected responses are cancelled immediately', () => {
  const req = new EventEmitter()
  const res = new EventEmitter()
  res.destroyed = true
  const { abortController, detachClientAbort } = createClientAbort(req, res)
  assert.equal(abortController.signal.aborted, true)
  detachClientAbort()
})
