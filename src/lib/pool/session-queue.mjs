/** Serialize requests by sticky session without reserving account/native capacity while queued. */
function cancelled() {
  return Object.assign(new Error('Request was cancelled'), { code: 'request_cancelled' })
}

function waitForTurn(previous, signal) {
  if (!signal) return previous
  if (signal.aborted) return Promise.reject(cancelled())
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(cancelled())
    signal.addEventListener('abort', onAbort, { once: true })
    previous.then(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    })
  })
}

export class SessionQueue {
  #tails = new Map()

  get size() {
    return this.#tails.size
  }

  async run(key, task, { signal } = {}) {
    if (signal?.aborted) throw cancelled()
    const sessionKey = String(key || '')
    if (!sessionKey) return task()
    const previous = this.#tails.get(sessionKey) || Promise.resolve()
    let release
    const turn = new Promise((resolve) => {
      release = resolve
    })
    // This promise tracks all predecessors, even when this particular waiter is cancelled.
    // It never adopts task errors, so one failed request cannot poison the queue.
    const tail = previous.then(() => turn)
    this.#tails.set(sessionKey, tail)
    void tail.then(() => {
      if (this.#tails.get(sessionKey) === tail) this.#tails.delete(sessionKey)
    })
    try {
      await waitForTurn(previous, signal)
      if (signal?.aborted) throw cancelled()
      return await task()
    } finally {
      release()
    }
  }
}
