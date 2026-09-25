import { createHash } from 'node:crypto'

function bodyHash(body) {
  return createHash('sha256')
    .update(JSON.stringify(body ?? null))
    .digest('hex')
}

/** An empty reply is evidence about this request, not every caller sharing its account. */
export class EmptyResponseBackoff {
  constructor({ maxEntries = 1024, now = Date.now } = {}) {
    this.entries = new Map()
    this.maxEntries = Math.max(1, Math.trunc(Number(maxEntries) || 1024))
    this.now = now
  }

  remaining(sessionKey, body) {
    const entry = this.entries.get(sessionKey)
    if (!entry) return 0
    const remaining = entry.until - this.now()
    if (remaining <= 0) {
      this.entries.delete(sessionKey)
      return 0
    }
    // Hash only sessions with a recent failure; healthy large requests pay no extra serialization cost.
    return entry.hash === bodyHash(body) ? remaining : 0
  }

  record(sessionKey, body, ttlMs) {
    if (!sessionKey || !(ttlMs > 0)) return
    const now = this.now()
    for (const [key, entry] of this.entries) {
      if (entry.until <= now) this.entries.delete(key)
    }
    this.entries.delete(sessionKey)
    while (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value)
    this.entries.set(sessionKey, { hash: bodyHash(body), until: now + ttlMs })
  }
}
