import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { startGateway, api } from '../harness.mjs'

// Exercise the real save response as well as the persisted configuration: a
// response failure after persistence otherwise looks like a failed save in UI.
for (const [method, endpoint] of [
  ['PUT', '/api/panel/routing'],
  ['PUT', '/admin/routing'],
  ['POST', '/admin/routing'],
]) {
  test(`${method} ${endpoint} saves cache TTL and redacts notification secrets`, async () => {
    const gw = await startGateway()
    try {
      for (const ttl of ['5m', '1h']) {
        const saved = await api(gw, method, endpoint, {
          body: {
            compatibility: { cache_ttl: ttl },
            notify: {
              enabled: false,
              email: { pass: 'test-smtp-secret' },
              telegram: { bot_token: 'test-telegram-secret' },
            },
          },
        })
        assert.equal(saved.status, 200, saved.text)
        assert.equal(saved.json.ok, true)
        const data = saved.json.data || saved.json.routing
        assert.equal(data.compatibility.cache_ttl, ttl)
        assert.equal(data.notify.email.pass, '')
        assert.equal(data.notify.email.pass_set, true)
        assert.equal(data.notify.telegram.bot_token, '')
        assert.equal(data.notify.telegram.bot_token_set, true)
        assert.doesNotMatch(saved.text, /test-smtp-secret|test-telegram-secret/)

        const read = await api(gw, 'GET', endpoint)
        assert.equal(read.status, 200, read.text)
        assert.equal((read.json.data || read.json.routing).compatibility.cache_ttl, ttl)
        assert.doesNotMatch(read.text, /test-smtp-secret|test-telegram-secret/)

        const persisted = JSON.parse(fs.readFileSync(path.join(gw.project, 'config', 'routing.json'), 'utf8'))
        assert.equal(persisted.compatibility.cache_ttl, ttl)
        assert.equal(persisted.notify.email.pass, 'test-smtp-secret')
        assert.equal(persisted.notify.telegram.bot_token, 'test-telegram-secret')
      }
    } finally {
      await gw.stop()
    }
  })
}
