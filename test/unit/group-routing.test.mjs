import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ApiKeyStore } from '../../src/lib/admin/api-keys.mjs'
import { PoolScheduler } from '../../src/lib/pool/pool-scheduler.mjs'
import { FailoverRunner } from '../../src/lib/pool/failover-runner.mjs'
import { handleGroups } from '../../src/lib/admin/panel-groups.mjs'
import { authorizePanelRoute } from '../../src/lib/admin/panel-acl.mjs'
import { pickCodexCandidates } from '../../src/lib/protocol/handle-codex.mjs'
import { healthDecisionForGroup } from '../../src/lib/protocol/handle-protocol.mjs'

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-group-routing-'))
  const store = new ApiKeyStore({ dataDir: path.join(root, 'data') })
  t.after(() => {
    store.db.close()
    fs.rmSync(root, { recursive: true, force: true })
  })
  fs.mkdirSync(path.join(root, 'vms'), { recursive: true })
  for (let i = 1; i <= 3; i++) {
    const id = `vm-0${i}`
    const vm = {
      id,
      name: id,
      status: 'running',
      schedulable: true,
      proxy_cli_enabled: true,
      proxy: { id: `p${i}`, url: `socks5h://127.0.0.1:${10000 + i}` },
      policy: { maxConcurrency: 4, concurrencyOverride: true },
      claude: {
        account_uuid: `a${i}`,
        account_tier: i === 3 ? 'max' : 'pro',
        access_token: 'test',
        refresh_token: 'test',
        expires_at: Date.now() / 1000 + 3600,
      },
    }
    fs.writeFileSync(path.join(root, 'vms', id + '.json'), JSON.stringify(vm))
    store.db.prepare('INSERT INTO accounts (id,vm_id) VALUES (?,?)').run(`a${i}`, id)
    store.db.prepare('INSERT INTO account_groups (account_id,group_id) VALUES (?,1)').run(`a${i}`)
  }
  const groups = store.groups
  const pro = groups.create({ name: 'Claude Pro', vm_ids: ['vm-01', 'vm-02'] })
  const max = groups.create({ name: 'Claude Max', vm_ids: ['vm-03'] })
  const key = store.create({ name: 'pro', group_id: pro.id })
  const scope = groups.routingScope(key)
  const pool = new PoolScheduler({
    projectRoot: root,
    accountQuota: { canAccept: () => ({ ok: true }) },
    workerHealth: async () => ({ ok: true, credential: { has_access: true } }),
    config: { fallback_wait_timeout_ms: 5, sticky_wait_timeout_ms: 5 },
  })
  return { root, store, groups, pro, max, key, scope, pool }
}

test('shared health cache and failure snapshots never cross group boundaries', (t) => {
  const { scope, groups, pro } = fixture(t)
  for (const action of ['cache', 'fail']) {
    const own = { action, snapshot: { vm_id: 'vm-01' } }
    assert.equal(healthDecisionForGroup(own, scope), own)
    assert.equal(healthDecisionForGroup({ action, snapshot: { vm_id: 'vm-03' } }, scope), null)
    assert.equal(healthDecisionForGroup({ action, snapshot: {} }, scope), null)
    assert.equal(healthDecisionForGroup(own, null), own)
  }
  groups.update(pro.id, { vm_ids: [] })
  assert.equal(healthDecisionForGroup({ action: 'cache', snapshot: { vm_id: 'vm-01' } }, scope), null)
})

test('group writes validate members atomically and reject conflicting edits', (t) => {
  const { groups, pro } = fixture(t)
  assert.deepEqual(groups.memberVmIds(pro.id), ['vm-01', 'vm-02'])
  assert.throws(() => groups.create({ name: 'Claude Pro' }), /已存在/)
  assert.throws(() => groups.update(pro.id, { name: 'changed', vm_ids: ['missing'] }), /尚未绑定/)
  assert.equal(groups.getById(pro.id).name, 'Claude Pro')
  assert.throws(() => groups.update(pro.id, { name: 'changed', expected_updated_at: 'stale' }), /刷新/)
  groups.update(pro.id, { name: 'Pro pool', vm_ids: [] })
  assert.deepEqual(groups.memberVmIds(pro.id), [])
})

test('keys reject invalid/disabled groups and API category cannot escape slot groups', (t) => {
  const { store, groups, pro, key } = fixture(t)
  for (const group_id of [0, -1, 1.5, 'junk', 999]) assert.throws(() => store.create({ group_id }))
  assert.throws(() => store.create({ group_id: pro.id, category: 'api' }))
  assert.throws(() => store.update(key.id, { category: 'api' }))
  assert.equal(store.getById(key.id).category, 'oauth')
  groups.update(pro.id, { status: 'disabled' })
  assert.equal(store.canAccept(key).code, 'group_unavailable')
  assert.throws(() => store.create({ group_id: pro.id }))
  assert.equal(store.canAccept(store.create({ name: 'legacy' })).ok, true)
})

test('Pro selection ignores Max sticky binding and never falls back outside group', async (t) => {
  const { pool, scope } = fixture(t)
  pool.stickyRouter = { resolve: () => ({ vmId: 'vm-03', accountId: 'a3' }), unbind() {} }
  const selected = await pool.selectAndReserve({
    model: 'claude-sonnet-5',
    stickyKey: 'old-parent',
    groupScope: scope,
    allowWait: false,
  })
  assert.equal(selected.ok, true)
  assert.ok(['vm-01', 'vm-02'].includes(selected.vmId))
  selected.release()
  const exhausted = await pool.selectAndReserve({
    model: 'claude-sonnet-5',
    groupScope: scope,
    excluded: new Set(['a1', 'a2']),
    allowWait: false,
  })
  assert.equal(exhausted.ok, false)
  const pinned = await pool.selectAndReserve({
    model: 'claude-sonnet-5',
    groupScope: scope,
    pinVmId: 'vm-03',
    allowWait: false,
  })
  assert.equal(pinned.ok, false)
  const peek = await pool.peekAccount({ model: 'claude-sonnet-5', groupScope: scope })
  assert.notEqual(peek.vmId, 'vm-03')
})

test('live scopes revoke removed members, disabled groups, reassigned and deleted keys', (t) => {
  const { store, groups, pro, max, key, scope } = fixture(t)
  assert.equal(scope.allowsVm('vm-01'), true)
  groups.update(pro.id, { vm_ids: ['vm-02'] })
  assert.equal(scope.allowsVm('vm-01'), false)
  assert.equal(scope.allowsVm('vm-02'), true)
  groups.update(pro.id, { status: 'disabled' })
  assert.equal(scope.allowsVm('vm-02'), false)
  store.update(key.id, { group_id: max.id })
  assert.equal(scope.allowsVm('vm-02'), false)
  const next = groups.routingScope(store.getById(key.id))
  assert.equal(next.allowsVm('vm-03'), true)
  assert.equal(next.allowsVm('vm-01'), false)
  store.remove(key.id)
  assert.equal(next.allowsVm('vm-03'), false)
})

test('membership change during awaited health check is rechecked before reservation', async (t) => {
  const { pool, scope, groups, pro } = fixture(t)
  pool.workerHealth = async () => {
    groups.update(pro.id, { vm_ids: [] })
    return { ok: true, credential: { has_access: true } }
  }
  const result = await pool.selectAndReserve({ model: 'claude-sonnet-5', groupScope: scope, allowWait: false })
  assert.equal(result.ok, false)
  assert.equal(Object.keys(pool.snapshot().inflight).length, 0)
})

test('real failover scheduler tries both Pro accounts and never reaches Max', async (t) => {
  const { pool, scope } = fixture(t)
  const runner = new FailoverRunner({ scheduler: pool })
  const seen = []
  const result = await runner.run({
    model: 'claude-sonnet-5',
    canonicalBody: { model: 'claude-sonnet-5' },
    groupScope: scope,
    callAttempt: async ({ candidate }) => {
      seen.push(candidate.vmId)
      return {
        ok: false,
        status: 429,
        terminalState: 'rejected',
        body: { error: { type: 'rate_limit_error', message: '5h exhausted' } },
        headers: { 'anthropic-ratelimit-unified-5h-status': 'rejected' },
      }
    },
  })
  assert.equal(result.ok, false)
  assert.deepEqual([...new Set(seen)].sort(), ['vm-01', 'vm-02'])
})

test('group management denies ordinary users and sanitizes read responses', async (t) => {
  const { groups, root } = fixture(t)
  assert.equal(authorizePanelRoute('PATCH', '/api/panel/groups/3', 'user').ok, false)
  let response
  const ctx = {
    path: '/api/panel/groups',
    projectRoot: root,
    groups,
    json: (_, status, body) => {
      response = { status, body }
    },
    readBody: async () => ({ name: 'forbidden' }),
  }
  await handleGroups({ method: 'POST', panelRole: 'user' }, {}, ctx)
  assert.equal(response.status, 403)
  await handleGroups({ method: 'GET', panelRole: 'user' }, {}, ctx)
  assert.equal(response.status, 200)
  assert.deepEqual(response.body.slots, [])
  assert.equal(response.body.items[0].vm_ids, undefined)
  ctx.readBody = async () => ({ name: 'admin group', vm_ids: ['vm-01'] })
  await handleGroups({ method: 'POST', apiKeyKind: 'master' }, {}, ctx)
  assert.equal(response.status, 201)
  assert.deepEqual(response.body.item.vm_ids, ['vm-01'])
})

test('Codex candidates and stale sticky bindings obey the same key group', (t) => {
  const { root, scope } = fixture(t)
  for (let i = 1; i <= 3; i++) {
    const id = `vm-0${i}`
    const file = path.join(root, 'vms', id + '.json')
    const vm = JSON.parse(fs.readFileSync(file))
    Object.assign(vm, { platform: 'openai', family: 'codex', has_token: true })
    fs.writeFileSync(file, JSON.stringify(vm))
    fs.mkdirSync(path.join(root, 'vms', id), { recursive: true })
    fs.writeFileSync(
      path.join(root, 'vms', id, 'codex-credentials.json'),
      JSON.stringify({ accounts: [{ id, access_token: 'at', refresh_token: 'rt', chatgpt_account_id: id }] }),
    )
  }
  const req = { apiKeyKind: 'managed', headers: { 'x-kin-vm': 'vm-03' }, groupScope: scope }
  const result = pickCodexCandidates(root, req, {
    stickyRouter: {
      collectPoolKeys: () => ['old'],
      extractPoolKey: () => 'old',
      resolve: () => ({ vmId: 'vm-03' }),
      unbind() {},
    },
  })
  assert.ok(result.ids.length > 0)
  assert.equal(result.ids.includes('vm-03'), false)
})
