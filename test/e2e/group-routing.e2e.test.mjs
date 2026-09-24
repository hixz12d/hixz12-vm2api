import test from 'node:test'
import assert from 'node:assert/strict'
import { startGateway, api } from '../harness.mjs'

const body = { model: 'claude-haiku-4-5-20251001', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] }

test('HTTP group management rejects out-of-group calls across compatible routes without a native kernel', async () => {
  const gw = await startGateway({ mockText: 'group-ok' })
  try {
    const listing = await api(gw, 'GET', '/api/panel/groups')
    assert.equal(listing.status, 200, listing.text)
    const vm = listing.json.slots[0].id
    const makeGroup = async (name, vm_ids) => {
      const r = await api(gw, 'POST', '/api/panel/groups', { body: { name, vm_ids } })
      assert.equal(r.status, 201, r.text)
      return r.json.item
    }
    const pro = await makeGroup('Claude Pro', [vm])
    const max = await makeGroup('Claude Max', [])
    const created = await api(gw, 'POST', '/api/panel/api-keys', { body: { name: 'pro', group_id: pro.id } })
    assert.equal(created.status, 201, created.text)
    const key = created.json.item
    const headers = { authorization: `Bearer ${key.key}`, 'x-kin-vm': vm, 'x-session-id': 'same-session' }
    const move = await api(gw, 'PATCH', `/api/panel/api-keys/${key.id}`, { body: { group_id: max.id } })
    assert.equal(move.status, 200, move.text)
    for (const route of ['/v1/messages', '/v1/chat/completions', '/v1/responses', '/v1/messages/count_tokens']) {
      const blocked = await api(gw, 'POST', route, {
        headers,
        body: route === '/v1/responses' ? { model: 'gpt-5.5', input: 'hi', max_output_tokens: 16 } : body,
      })
      assert.equal(blocked.status, 503, route + ': ' + blocked.text)
    }
    const disabled = await api(gw, 'PATCH', `/api/panel/groups/${max.id}`, { body: { status: 'disabled' } })
    assert.equal(disabled.status, 200, disabled.text)
    assert.equal((await api(gw, 'POST', '/v1/messages', { headers, body })).status, 403)
    assert.equal(
      (await api(gw, 'POST', '/api/panel/api-keys', { body: { name: 'invalid', group_id: 99999 } })).status,
      400,
    )
    assert.equal((await api(gw, 'POST', '/api/panel/groups', { headers, body: { name: 'escalate' } })).status, 403)
    const back = await api(gw, 'PATCH', `/api/panel/api-keys/${key.id}`, { body: { group_id: pro.id } })
    assert.equal(back.status, 200, back.text)
    const empty = await api(gw, 'PATCH', `/api/panel/groups/${pro.id}`, { body: { vm_ids: [] } })
    assert.equal(empty.status, 200, empty.text)
    assert.equal((await api(gw, 'POST', '/v1/messages', { headers, body })).status, 503)
  } finally {
    await gw.stop()
  }
})
