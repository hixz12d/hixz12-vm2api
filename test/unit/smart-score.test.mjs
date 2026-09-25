import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chooseByScore, normalizeScores, normalizeSmartConfig, scoreFactors } from '../../src/lib/pool/smart-score.mjs'
import { PoolScheduler } from '../../src/lib/pool/pool-scheduler.mjs'
import { SessionLimitRegistry } from '../../src/lib/pool/session-limit.mjs'

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-09-25T07:00:00.000Z')

function account(u5, h5, u7, h7, now = NOW) {
  return {
    unified: {
      headers: {
        '5h': { utilization: u5, reset: now + h5 * HOUR, status: 'allowed' },
        '7d': { utilization: u7, reset: now + h7 * HOUR, status: 'allowed' },
      },
    },
  }
}

function values(accounts, tier = 'max', now = NOW) {
  return normalizeScores(accounts.map((a) => scoreFactors({ account: a, tier, now }))).map((f) => f.value)
}

function distribute(vals, n, config = {}) {
  const sessions = vals.map(() => 0)
  for (let i = 0; i < n; i++) {
    const pick = chooseByScore(
      vals.map((value, k) => ({ key: `a${k}`, value, sessions: sessions[k] })),
      config,
    )
    sessions[Number(pick.key.slice(1))]++
  }
  return sessions
}

test('default soft lines are Max 65% and Pro 50%', () => {
  const cfg = normalizeSmartConfig({})
  assert.equal(cfg.soft_5h.max, 0.65)
  assert.equal(cfg.soft_5h.pro, 0.5)
  assert.equal(cfg.active_window_min, 5)
  assert.equal(cfg.max_share, 0.8)
})

test('weekly quota that expires sooner with more left scores higher', () => {
  const [soon, later] = values([account(0.2, 3, 0.6, 4), account(0.2, 3, 0.05, 38)])
  assert.ok(soon > later, `${soon} > ${later}`)
})

test('5h headroom is full below the soft line and falls toward the hard line', () => {
  const at = (u5, tier) => scoreFactors({ account: account(u5, 3, 0.1, 100), tier, now: NOW }).headroom
  assert.equal(at(0.6, 'max'), 1)
  assert.ok(at(0.8, 'max') < 1 && at(0.8, 'max') > at(0.9, 'max'))
  assert.equal(at(0.45, 'pro'), 1)
  assert.ok(at(0.7, 'pro') < 1)
  assert.ok(at(0.84, 'pro') <= 0.1)
})

test('5h usage fades out in the last hour before its reset', () => {
  const late = scoreFactors({ account: account(0.9, 0.1, 0.1, 100), tier: 'max', now: NOW }).headroom
  const early = scoreFactors({ account: account(0.9, 3, 0.1, 100), tier: 'max', now: NOW }).headroom
  assert.ok(late > early)
})

test('unknown weekly data is neutral instead of starving or flooding', () => {
  const [known, fresh] = normalizeScores([
    scoreFactors({ account: account(0.1, 3, 0.1, 100), tier: 'max', now: NOW }),
    scoreFactors({ account: {}, tier: 'max', now: NOW }),
  ])
  assert.equal(known.weeklyNorm, 1)
  assert.equal(fresh.weeklyNorm, 0.5)
})

test('equal accounts split new sessions evenly', () => {
  assert.deepEqual(distribute([1, 1], 4), [2, 2])
})

test('four sessions never all land on one account while another can take them', () => {
  // Production shape on 2026-09-25: one Max account resets weekly in 4h with 34% left.
  const vals = values([account(0.84, 4, 0.05, 38), account(0.33, 1, 0.66, 4)])
  assert.ok(vals[1] > vals[0] * 5)
  assert.deepEqual(distribute(vals, 4), [1, 3])
})

test('share cap waits for a minimum active session count', () => {
  assert.deepEqual(distribute([1, 0.01], 2), [2, 0])
  assert.deepEqual(distribute([1, 0.01], 3), [2, 1])
})

test('share cap does not spill onto an account near its 5h hard line', () => {
  const items = (s0, s1) => [
    { key: 'a0', value: 1, sessions: s0, factors: { headroom: 1 } },
    { key: 'a1', value: 0.04, sessions: s1, factors: { headroom: 0.05 } },
  ]
  assert.equal(chooseByScore(items(4, 0)).key, 'a0')
  const roomy = items(4, 0)
  roomy[1].factors.headroom = 0.8
  assert.equal(chooseByScore(roomy).key, 'a1')
})

test('higher value takes proportionally more sessions', () => {
  const [a, b] = distribute([3, 1], 8, { max_share: 1 })
  assert.equal(a, 6)
  assert.equal(b, 2)
})

function project(tiers = { 'vm-01': 'max', 'vm-02': 'max' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-smart-'))
  const vms = path.join(root, 'vms')
  fs.mkdirSync(vms, { recursive: true })
  for (const [id, tier] of Object.entries(tiers)) {
    fs.writeFileSync(
      path.join(vms, `${id}.json`),
      JSON.stringify({
        id,
        name: id,
        status: 'running',
        schedulable: true,
        proxy_cli_enabled: true,
        proxy: { id: `proxy-${id}`, url: 'socks5h://127.0.0.1:10001' },
        runtime: { worker_socket: path.join(vms, id, 'run', 'worker.sock') },
        policy: { maxConcurrency: 8, concurrencyOverride: true, weight: 1 },
        claude: {
          account_uuid: `acct-${id}`,
          account_tier: tier,
          access_token: 'a',
          refresh_token: 'r',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      }),
    )
  }
  return root
}

function smartScheduler(root, accounts, sessions = new SessionLimitRegistry(), stickyRouter = null) {
  return new PoolScheduler({
    projectRoot: root,
    stickyRouter,
    runtimeRepo: { get: () => null, clearExpired() {}, upsert: (s) => s },
    accountQuota: {
      repo: { get: (id) => accounts[id] || null },
      canAccept: () => ({ ok: true }),
      sessions,
    },
    workerHealth: async () => ({ ok: true, credential: { generation: 1, has_access: true } }),
    config: { strategy: 'smart', fallback_wait_timeout_ms: 5, sticky_wait_timeout_ms: 5 },
  })
}

test('scheduler smart strategy spreads live sessions and logs the score', async (t) => {
  const root = project()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const now = Date.now()
  const accounts = {
    'acct-vm-01': account(0.84, 4, 0.05, 38, now),
    'acct-vm-02': account(0.33, 1, 0.66, 4, now),
  }
  const pool = smartScheduler(root, accounts)
  const counts = {}
  const held = []
  for (let i = 0; i < 4; i++) {
    const selected = await pool.selectAndReserve({ model: 'claude-test', stickyKey: `s${i}`, allowWait: false })
    assert.notEqual(selected.ok, false)
    assert.match(selected.selectionReason, /^smart v=/)
    counts[selected.vmId] = (counts[selected.vmId] || 0) + 1
    held.push(selected)
  }
  for (const s of held) s.release()
  assert.deepEqual(counts, { 'vm-01': 1, 'vm-02': 3 })
})

test('smart strategy leaves an existing sticky binding alone', async (t) => {
  const root = project()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const now = Date.now()
  const accounts = {
    'acct-vm-01': account(0.7, 4, 0.05, 150, now),
    'acct-vm-02': account(0.1, 1, 0.5, 4, now),
  }
  const bound = { vmId: 'vm-01', accountId: 'acct-vm-01' }
  const sticky = { resolve: (key) => (key === 'bound' ? bound : null), unbind() {} }
  const pool = smartScheduler(root, accounts, new SessionLimitRegistry(), sticky)
  const selected = await pool.selectAndReserve({ model: 'claude-test', stickyKey: 'bound', allowWait: false })
  assert.equal(selected.vmId, 'vm-01')
  assert.equal(selected.selectionReason, 'sticky')
  selected.release()
  const fresh = await pool.selectAndReserve({ model: 'claude-test', stickyKey: 'new', allowWait: false })
  assert.equal(fresh.vmId, 'vm-02')
  fresh.release()
})

test('manual schedule level still outranks the smart score', async (t) => {
  const root = project()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const file = path.join(root, 'vms', 'vm-01.json')
  const vm = JSON.parse(fs.readFileSync(file, 'utf8'))
  vm.policy.priority = 5
  fs.writeFileSync(file, JSON.stringify(vm))
  const now = Date.now()
  const accounts = {
    'acct-vm-01': account(0.7, 4, 0.05, 150, now),
    'acct-vm-02': account(0.1, 1, 0.5, 4, now),
  }
  const pool = smartScheduler(root, accounts)
  const selected = await pool.selectAndReserve({ model: 'claude-test', stickyKey: 'x', allowWait: false })
  assert.equal(selected.vmId, 'vm-01')
  selected.release()
})

test('session activity window is read-only and ignores stale sessions', () => {
  const reg = new SessionLimitRegistry()
  reg.touch('a', 'old', NOW - 10 * 60_000)
  reg.touch('a', 'new', NOW - 60_000)
  assert.equal(reg.activeCount('a', 5 * 60_000, NOW), 1)
  assert.equal(reg.activeCount('a', 60 * 60_000, NOW), 2)
  reg.touch('a', 'ancient', NOW - 25 * 60 * 60_000)
  assert.equal(reg.activeCount('a', 5 * 60_000, NOW), 1)
  assert.equal(reg.byAccount.get('a').has('ancient'), false)
  assert.equal(reg.byAccount.get('a').has('old'), true)
})
