import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDatabase } from '../../src/lib/db/database.mjs'
import { UsageLogsRepo } from '../../src/lib/db/repos/usage-logs-repo.mjs'

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-byte-budget-'))
  const db = createDatabase({ dataDir: dir })
  t.after(() => {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return new UsageLogsRepo(db)
}

test('debug budget counts UTF-8 storage bytes including Chinese and emoji', (t) => {
  const repo = fixture(t)
  const record = { text: '中文😀'.repeat(1000) }
  repo.insertDebug('unicode', new Date().toISOString(), record)
  assert.equal(repo.debugBytes(), Buffer.byteLength(JSON.stringify(record), 'utf8'))
  repo.insertDebug('unicode', new Date().toISOString(), { text: 'short' })
  assert.equal(repo.debugBytes(), Buffer.byteLength(JSON.stringify({ text: 'short' })))
})

test('retention removes oldest multi-byte debug record when bytes exceed the cap', (t) => {
  const repo = fixture(t)
  const record = { text: '中😀'.repeat(80_000) }
  const size = Buffer.byteLength(JSON.stringify(record))
  repo.insertDebug('older', new Date(Date.now() - 2000).toISOString(), record)
  repo.insertDebug('newer', new Date(Date.now() - 1000).toISOString(), record)
  const removed = repo.trimDebugToMaxBytes(size + 100)
  assert.ok(removed > 0)
  assert.ok(repo.debugBytes() <= size + 100)
  assert.equal(repo.getDebug('older'), null)
})
