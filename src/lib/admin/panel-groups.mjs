/** Admin-only group management; member inputs are live slot IDs, never credentials. */
import { listVms } from '../vm/vm-registry.mjs'
import { panelIdentity } from './panel-acl.mjs'

export async function handleGroups(req, res, { path, projectRoot, groups, json, readBody }) {
  if (path !== '/api/panel/groups' && !/^\/api\/panel\/groups\/\d+$/.test(path)) return false
  const admin = panelIdentity(req).role === 'admin'
  try {
    if (req.method === 'GET' && path === '/api/panel/groups') {
      const items = groups
        .list()
        .map((g) => (admin ? { ...g, vm_ids: groups.memberVmIds(g.id) } : { id: g.id, name: g.name, status: g.status }))
      const slots = admin ? listVms(projectRoot).map((v) => ({ id: v.id, name: v.name || v.id, status: v.status })) : []
      json(res, 200, { ok: true, items, slots })
      return true
    }
    if (!admin) {
      json(res, 403, { ok: false, error: { code: 'forbidden', message: '仅管理员可以管理分组' } })
      return true
    }
    const create = req.method === 'POST' && path === '/api/panel/groups'
    const update = req.method === 'PATCH' && /^\/api\/panel\/groups\/\d+$/.test(path)
    if (!create && !update) {
      json(res, 405, { ok: false, error: { code: 'method_not_allowed', message: '不支持的操作' } })
      return true
    }
    const body = await readBody(req, 32 * 1024)
    if (body.vm_ids !== undefined) {
      const live = new Set(listVms(projectRoot).map((v) => v.id))
      if (!Array.isArray(body.vm_ids) || body.vm_ids.some((id) => !live.has(id))) {
        throw Object.assign(new Error('成员必须是现有槽位'), { code: 'invalid_group_members' })
      }
    }
    const item = create ? groups.create(body) : groups.update(Number(path.split('/').pop()), body)
    json(res, create ? 201 : 200, { ok: true, item })
  } catch (e) {
    json(res, e.status || 400, { ok: false, error: { code: e.code || 'invalid_group', message: e.message } })
  }
  return true
}
