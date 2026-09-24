/** Account groups shared by key billing and slot routing. */
import { getDb } from '../database.mjs'

export const DEFAULT_GROUP_ID = 1
const EDITABLE = ['name', 'description', 'rate_multiplier', 'is_exclusive', 'rpm_limit', 'sort_order', 'status']
const fail = (message, code = 'invalid_group', status = 400) => {
  throw Object.assign(new Error(message), { code, status })
}

export function normalizeGroupId(value = DEFAULT_GROUP_ID) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) fail('请选择有效分组')
  return id
}

function rowToRec(row) {
  if (!row) return null
  return { ...row, rate_multiplier: Number(row.rate_multiplier), is_exclusive: !!row.is_exclusive }
}

export class GroupsRepo {
  constructor(db = getDb()) {
    this.db = db
    this._list = db.prepare('SELECT * FROM groups WHERE deleted_at IS NULL ORDER BY sort_order, id')
    this._get = db.prepare('SELECT * FROM groups WHERE id = ? AND deleted_at IS NULL')
    this._getByName = db.prepare('SELECT * FROM groups WHERE name = ? AND deleted_at IS NULL')
    this._members = db.prepare(`SELECT DISTINCT a.vm_id FROM accounts a JOIN account_groups ag ON ag.account_id=a.id
      WHERE ag.group_id=? AND a.deleted_at IS NULL AND a.vm_id IS NOT NULL ORDER BY a.vm_id`)
    this._allows = db.prepare(`SELECT 1 FROM account_groups ag JOIN accounts a ON a.id=ag.account_id
      JOIN groups g ON g.id=ag.group_id WHERE g.id=? AND g.status='active' AND g.deleted_at IS NULL
      AND a.vm_id=? AND a.deleted_at IS NULL LIMIT 1`)
    this._key = db.prepare('SELECT group_id,status,category,expires_at FROM api_keys WHERE id=?')
  }

  list() {
    return this._list.all().map(rowToRec)
  }
  getById(id) {
    return rowToRec(this._get.get(id))
  }
  getByName(name) {
    return rowToRec(this._getByName.get(String(name || '').trim()))
  }
  getDefault() {
    return this.getById(DEFAULT_GROUP_ID)
  }
  memberVmIds(id) {
    return this._members.all(id).map((r) => r.vm_id)
  }

  requireActive(id, category = 'oauth') {
    id = normalizeGroupId(id)
    const group = this.getById(id)
    if (!group || group.status !== 'active') fail('分组不存在或已停用', 'group_unavailable', 403)
    if (String(category).toLowerCase() === 'api' && id !== DEFAULT_GROUP_ID)
      fail('API 直连密钥只能使用默认分组', 'group_category_mismatch')
    return group
  }

  validate(patch) {
    const out = {}
    for (const k of EDITABLE) if (patch[k] !== undefined) out[k] = patch[k]
    if ('name' in out) {
      out.name = String(out.name || '').trim()
      if (!out.name || out.name.length > 80) fail('分组名称须为 1–80 个字符')
    }
    if ('description' in out) out.description = String(out.description || '').slice(0, 500)
    if ('status' in out && !['active', 'disabled'].includes(out.status)) fail('无效分组状态')
    for (const k of ['rate_multiplier', 'rpm_limit', 'sort_order']) {
      if (!(k in out)) continue
      out[k] = Number(out[k])
      if (!Number.isFinite(out[k]) || out[k] < 0) fail('分组数值必须为非负数')
    }
    if ('is_exclusive' in out) out.is_exclusive = out.is_exclusive ? 1 : 0
    if (out.name) {
      const existing = this.getByName(out.name)
      if (existing && existing.id !== patch.id) fail('分组名称已存在', 'group_exists', 409)
    }
    return out
  }

  /** One transaction covers group edits and complete member replacement. */
  save(id, input = {}) {
    const existing = id == null ? null : this.getById(normalizeGroupId(id))
    if (id != null && !existing) fail('分组不存在', 'group_not_found', 404)
    if (existing && input.expected_updated_at !== undefined && input.expected_updated_at !== existing.updated_at)
      fail('分组已被其他操作修改，请刷新后重试', 'group_conflict', 409)
    if (!existing && input.name == null) fail('请输入分组名称')
    const patch = this.validate({ ...input, id: existing?.id })
    let accountIds = null
    if (input.vm_ids !== undefined) {
      if (!Array.isArray(input.vm_ids) || input.vm_ids.length > 500) fail('无效账号成员列表')
      const lookup = this.db.prepare('SELECT id FROM accounts WHERE vm_id=? AND deleted_at IS NULL')
      accountIds = []
      for (const vmId of new Set(input.vm_ids)) {
        if (typeof vmId !== 'string' || !vmId) fail('无效槽位')
        const rows = lookup.all(vmId)
        if (!rows.length) fail('槽位尚未绑定账号：' + vmId)
        accountIds.push(...rows.map((r) => r.id))
      }
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const now = new Date(Math.max(Date.now(), (Date.parse(existing?.updated_at) || 0) + 1)).toISOString()
      if (!existing) {
        id = Number(
          this.db.prepare('INSERT INTO groups (name,created_at,updated_at) VALUES (?,?,?)').run(patch.name, now, now)
            .lastInsertRowid,
        )
      }
      const cols = Object.keys(patch)
      if (cols.length)
        this.db
          .prepare(`UPDATE groups SET ${cols.map((k) => `${k}=?`).join(',')},updated_at=? WHERE id=?`)
          .run(...cols.map((k) => patch[k]), now, id)
      if (accountIds) {
        this.db.prepare('DELETE FROM account_groups WHERE group_id=?').run(id)
        const insert = this.db.prepare(
          'INSERT OR IGNORE INTO account_groups (account_id,group_id,priority,created_at) VALUES (?,?,50,?)',
        )
        for (const accountId of accountIds) insert.run(accountId, id, now)
      }
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    return { ...this.getById(id), vm_ids: this.memberVmIds(id) }
  }

  create(input) {
    return this.save(null, input)
  }
  update(id, patch = {}) {
    return this.save(id, patch)
  }

  /** Recheck live membership at selection/reservation/hop; never fall back to all slots. */
  routingScope(record) {
    const id = normalizeGroupId(record.group_id ?? DEFAULT_GROUP_ID)
    return {
      id,
      allowsVm: (vmId) => {
        const key = this._key.get(record.id)
        if (!key || key.status !== 'active' || Number(key.group_id ?? DEFAULT_GROUP_ID) !== id) return false
        if (key.expires_at && Date.parse(key.expires_at) <= Date.now()) return false
        if (key.category === 'api') return false
        return !!this._allows.get(id, vmId)
      },
    }
  }

  rateMultiplier(id) {
    const g = this.getById(id ?? DEFAULT_GROUP_ID)
    return g ? g.rate_multiplier : 1
  }
}
