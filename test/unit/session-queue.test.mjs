import test from 'node:test'
import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import { SessionQueue } from '../../src/lib/pool/session-queue.mjs'

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('same session is FIFO, different sessions and unkeyed requests are independent', async () => {
  const queue = new SessionQueue()
  const finish = Promise.withResolvers()
  const entered = Promise.withResolvers()
  const seen = []
  const first = queue.run('a', async () => {
    seen.push('a1')
    entered.resolve()
    await finish.promise
  })
  await entered.promise
  const second = queue.run('a', () => seen.push('a2'))
  const third = queue.run('a', () => seen.push('a3'))
  try {
    await queue.run('b', () => seen.push('b'))
    await queue.run(null, () => seen.push('unkeyed'))
    assert.deepEqual(seen, ['a1', 'b', 'unkeyed'])
  } finally {
    finish.resolve()
    await Promise.all([first, second, third])
  }
  assert.deepEqual(seen, ['a1', 'b', 'unkeyed', 'a2', 'a3'])
  await tick()
  assert.equal(queue.size, 0)
})

test('cancelling a middle waiter preserves FIFO and cleans abort listeners', async () => {
  const queue = new SessionQueue()
  const finish = Promise.withResolvers()
  const entered = Promise.withResolvers()
  const controller = new AbortController()
  const seen = []
  const first = queue.run('a', async () => {
    entered.resolve()
    await finish.promise
    seen.push('first')
  })
  await entered.promise
  const cancelled = queue.run('a', () => assert.fail('cancelled waiter must not execute'), {
    signal: controller.signal,
  })
  const rejected = assert.rejects(cancelled, { code: 'request_cancelled' })
  const next = queue.run('a', () => seen.push('next'))
  controller.abort()
  try {
    await rejected
    await tick()
    assert.deepEqual(seen, [])
    assert.equal(queue.size, 1)
  } finally {
    finish.resolve()
    await Promise.all([first, next])
  }
  assert.deepEqual(seen, ['first', 'next'])
  await tick()
  assert.equal(queue.size, 0)
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
})

test('task failure releases its turn without poisoning subsequent requests', async () => {
  const queue = new SessionQueue()
  const failed = queue.run('a', () => {
    throw new Error('synthetic failure')
  })
  const rejected = assert.rejects(failed, /synthetic failure/)
  const next = queue.run('a', () => 'recovered')
  await rejected
  assert.equal(await next, 'recovered')
  await tick()
  assert.equal(queue.size, 0)
})

test('already aborted requests do not enter or allocate a session', async () => {
  const queue = new SessionQueue()
  const controller = new AbortController()
  controller.abort()
  for (const key of ['a', null]) {
    await assert.rejects(
      queue.run(key, () => assert.fail('must not execute'), { signal: controller.signal }),
      { code: 'request_cancelled' },
    )
  }
  assert.equal(queue.size, 0)
})

test('aborting an active task does not release its slot until the task finishes', async () => {
  const queue = new SessionQueue()
  const finish = Promise.withResolvers()
  const entered = Promise.withResolvers()
  const controller = new AbortController()
  const seen = []
  const first = queue.run(
    'a',
    async () => {
      entered.resolve()
      await finish.promise
      seen.push('finished')
    },
    { signal: controller.signal },
  )
  await entered.promise
  controller.abort()
  const next = queue.run('a', () => seen.push('next'))
  try {
    await tick()
    assert.deepEqual(seen, [])
  } finally {
    finish.resolve()
    await Promise.all([first, next])
  }
  assert.deepEqual(seen, ['finished', 'next'])
  await tick()
  assert.equal(queue.size, 0)
})
