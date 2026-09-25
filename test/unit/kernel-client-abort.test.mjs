import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dispatchStreamInference } from '../../src/lib/transport/kernel-router.mjs'
import { resetWrapRecycleState } from '../../src/lib/transport/rust-kernel-supervisor.mjs'

for (const committed of [false, true]) {
  test(`client cancellation ${committed ? 'after' : 'before'} content closes the hop without retry or shared-kernel recycle`, {
    skip: process.platform === 'win32' ? 'requires Unix domain sockets' : false,
    timeout: 5000,
  }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-client-abort-'))
    const socket = path.join(root, 'kernel.sock')
    const token = path.join(root, 'internal.token')
    fs.writeFileSync(token, 'fixture')
    const controller = new AbortController()
    let requests = 0
    let recycled = 0
    let responseClosed
    const closed = new Promise((resolve) => {
      responseClosed = resolve
    })
    const server = http.createServer(async (req, res) => {
      requests++
      for await (const chunk of req) {
      }
      res.on('close', responseClosed)
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.flushHeaders()
      if (!committed) {
        controller.abort()
        return
      }
      res.write('data: {"type":"message_start","message":{"type":"message","role":"assistant","content":[]}}\n\n')
      res.write('data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n')
      res.write('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n')
    })
    await new Promise((resolve) => server.listen(socket, resolve))
    const previous = process.env.KIN_KERNEL_BIN
    process.env.KIN_KERNEL_BIN = '/bin/true'
    resetWrapRecycleState()
    try {
      const result = await dispatchStreamInference({
        exec: { vmId: 'vm-abort', vm: { runtime: { kernel_socket: socket, worker_token_file: token } } },
        body: { model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'hello' }] },
        ensureRust: async () => ({ ok: true }),
        recycleWrap: () => {
          recycled++
        },
        onEvent: (line) => {
          if (line.includes('text_delta')) controller.abort()
        },
        signal: controller.signal,
        timeoutMs: 2000,
      })
      await closed
      assert.equal(result.body.error.code, 'request_cancelled')
      assert.equal(result.terminalState, 'cancelled')
      assert.equal(result.committed, committed)
      assert.equal(result.transportError, false)
      assert.equal(requests, 1)
      assert.equal(recycled, 0)
    } finally {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
      resetWrapRecycleState()
      if (previous == null) delete process.env.KIN_KERNEL_BIN
      else process.env.KIN_KERNEL_BIN = previous
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
}
