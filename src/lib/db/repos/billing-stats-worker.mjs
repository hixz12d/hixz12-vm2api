/**
 * Worker entry for the panel billing snapshot.
 *
 * `UsageLogsRepo._computeBillingStats` is synchronous and reads every
 * usage_logs row of the 7-day window into JS; on the gateway's main thread it
 * froze all HTTP traffic for seconds on every panel refresh. This worker keeps
 * its own read-only SQLite connection (WAL lets the gateway keep writing) and
 * answers one snapshot per message. Failures are reported as a message, never
 * thrown across the thread boundary.
 */

import { parentPort, workerData } from 'node:worker_threads'
import { DatabaseSync } from 'node:sqlite'
import { UsageLogsRepo } from './usage-logs-repo.mjs'

const db = new DatabaseSync(workerData.dbPath, { readOnly: true })
db.exec('PRAGMA busy_timeout = 5000')
const repo = new UsageLogsRepo(db)

parentPort.on('message', ({ key, accountWindows, now }) => {
  try {
    parentPort.postMessage({ key, ok: true, value: repo._computeBillingStats({ accountWindows, now }) })
  } catch (e) {
    parentPort.postMessage({ key, ok: false, error: String((e && e.message) || e) })
  }
})
