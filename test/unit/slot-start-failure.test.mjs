import test from 'node:test'
import assert from 'node:assert/strict'
import { startSlotReady } from '../../src/lib/vm/slot-runtime.mjs'

test('Codex slot startup failure is returned before configuring or starting its kernel', async () => {
  const result = await startSlotReady(
    { id: 'vm-codex-failed', platform: 'openai', family: 'codex', runtime: { type: 'kvm' } },
    '/unused-project',
    {
      ops: {
        writeCodexKernelConfig() {
          assert.fail('Do not rewrite kernel config after slot startup failed')
        },
        ensureCodexKernel() {
          assert.fail('Do not start a kernel after slot startup failed')
        },
      },
    },
  )
  assert.equal(result.ok, false)
  assert.equal(result.code, 'kvm_not_configured')
})
