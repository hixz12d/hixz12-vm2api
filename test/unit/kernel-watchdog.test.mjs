import assert from 'node:assert/strict'
import test from 'node:test'
import { createKernelWatchdog, isKernelWatchdogTarget } from '../../src/lib/transport/kernel-watchdog.mjs'

test('watchdog skips stopped slots; stored go is treated as rust', () => {
  assert.equal(isKernelWatchdogTarget({ id: 'vm-01' }), true)
  assert.equal(isKernelWatchdogTarget({ id: 'vm-01', status: 'running', inference_engine: '' }), true)
  assert.equal(isKernelWatchdogTarget({ id: 'vm-01', platform: 'openai' }), false)
  assert.equal(isKernelWatchdogTarget({ id: 'vm-01', codex_kernel: true }), false)
  assert.equal(isKernelWatchdogTarget({ id: 'vm-01', runtime_kind: 'kvm' }), false)
  assert.equal(isKernelWatchdogTarget({ id: 'vm-01', inference_engine: 'rust' }), true)
  assert.equal(isKernelWatchdogTarget({ id: 'vm-01', runtime: { engine: 'rust' } }), true)
  assert.equal(isKernelWatchdogTarget({ id: 'vm-01', inference_engine: 'go' }), true)
  assert.equal(isKernelWatchdogTarget({ id: 'vm-01', status: 'stopped' }), false)
})

test('watchdog ensure is called only when rust is unreachable', async () => {
  const ensured = []
  const wd = createKernelWatchdog({
    listTargets: () => [
      { id: 'vm-up', inference_engine: 'rust' },
      { id: 'vm-busy', inference_engine: 'rust' },
      { id: 'vm-down', inference_engine: 'rust' },
      { id: 'vm-go', inference_engine: 'go' },
    ],
    homeDirFor: (vm) => `/tmp/${vm.id}`,
    health: async (exec) => {
      if (exec.vmId === 'vm-up') return { ok: true, ready_slots: 1, cli_pid: 1 }
      if (exec.vmId === 'vm-busy') return { ok: true, ready_slots: 0, cli_pid: 9 }
      return { ok: false, ready_slots: 0 }
    },
    ensure: async (exec) => {
      ensured.push(exec.vmId)
      return { ok: true }
    },
  })
  await wd.tick()
  assert.deepEqual(ensured, ['vm-down', 'vm-go'])
})

test('watchdog recovers leaked slots only after an idle grace period', async () => {
  let clock = 100_000
  let live = 0
  let slots = 0
  let recent = false
  const recycled = []
  const wd = createKernelWatchdog({
    listTargets: () => [{ id: 'vm-stuck', status: 'running' }],
    health: async () => ({ ok: true, ready_slots: slots, cli_pid: 17 }),
    inflight: () => live,
    idleMs: () => (recent ? 1000 : Number.POSITIVE_INFINITY),
    now: () => clock,
    recycle: (exec) => {
      recycled.push(exec.vmId)
    },
    ensure: async () => {
      throw new Error('busy kernel must use controlled recycle')
    },
  })
  await wd.tick()
  clock += 9_999
  await wd.tick()
  assert.deepEqual(recycled, [])
  clock += 1
  await wd.tick()
  assert.deepEqual(recycled, ['vm-stuck'])
  live = 1
  clock += 600_000
  await wd.tick()
  assert.equal(recycled.length, 1)
  live = 0
  await wd.tick()
  clock += 10_000
  recent = true
  await wd.tick()
  assert.equal(recycled.length, 1)
  recent = false
  await wd.tick()
  clock += 10_000
  slots = 2
  await wd.tick()
  slots = 0
  await wd.tick()
  assert.equal(recycled.length, 1)
  clock += 10_000
  await wd.tick()
  assert.equal(recycled.length, 2)
})

test('inherited running VM recovers before the 45s queue budget after a completed hop', async () => {
  const { beginWrapHop, endWrapHop, resetWrapRecycleState } = await import(
    '../../src/lib/transport/rust-kernel-supervisor.mjs'
  )
  resetWrapRecycleState()
  let clock = 100_000
  const exec = { vmId: 'vm-inherited', vm: { id: 'vm-inherited', status: 'running' } }
  const recovered = []
  const wd = createKernelWatchdog({
    listTargets: () => [exec.vm],
    health: async () => ({ ok: true, ready_slots: 0, cli_pid: 17 }),
    now: () => clock,
    recycle: () => recovered.push(clock),
  })
  try {
    beginWrapHop(exec, clock)
    clock += 120_000
    await wd.tick()
    assert.equal(recovered.length, 0, 'never restart an active long request')
    endWrapHop(exec, clock)
    const completedAt = clock
    for (let i = 0; i < 6; i++) {
      await wd.tick()
      clock += 5000
      if (recovered.length) break
    }
    assert.equal(recovered.length, 1)
    assert.ok(recovered[0] - completedAt >= 10_000)
    assert.ok(recovered[0] - completedAt < 30_000, 'leave queue budget for restart and health refresh')
  } finally {
    resetWrapRecycleState()
  }
})

test('an inherited healthy idle VM is not restarted', async () => {
  let clock = 0
  const wd = createKernelWatchdog({
    listTargets: () => [{ id: 'vm-idle', status: 'running' }],
    health: async () => ({ ok: true, ready_slots: 2, cli_pid: 17 }),
    now: () => clock,
    recycle: () => assert.fail('healthy kernel must not restart'),
    ensure: () => assert.fail('healthy kernel must not restart'),
  })
  await wd.tick()
  clock += 3_600_000
  await wd.tick()
})
