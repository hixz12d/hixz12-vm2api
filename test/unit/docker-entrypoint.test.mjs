import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const entrypoint = fs.readFileSync(new URL('../../scripts/docker-entrypoint.sh', import.meta.url), 'utf8')

test('image entrypoint installs and atomically updates crag while preserving persisted configuration', {
  skip: process.platform === 'win32' ? 'requires POSIX shell and file modes' : false,
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-entrypoint-crag-'))
  try {
    const image = path.join(root, 'image')
    const runtime = path.join(root, 'runtime')
    const stubs = path.join(root, 'stubs')
    for (const dir of ['image-bin', 'image-crag', 'image-config']) {
      fs.mkdirSync(path.join(image, dir), { recursive: true })
    }
    fs.mkdirSync(path.join(runtime, 'src/config'), { recursive: true })
    fs.mkdirSync(path.join(runtime, 'vms'), { recursive: true })
    fs.mkdirSync(stubs)
    fs.writeFileSync(path.join(image, 'image-bin/kin-kernel'), 'wrap-kernel')
    const source = path.join(image, 'image-crag/kin-kernel')
    fs.writeFileSync(source, 'crag-v1')
    fs.writeFileSync(path.join(image, 'image-config/routing.json'), '{"inference":{"dataplane":"wrap"}}')
    const routing = '{"inference":{"dataplane":"crag","cache_ttl":"1h"}}'
    const slot = '{"id":"vm-01","status":"running","policy":{"maxConcurrency":4}}'
    fs.writeFileSync(path.join(runtime, 'src/config/routing.json'), routing)
    fs.writeFileSync(path.join(runtime, 'vms/vm-01.json'), slot)
    fs.writeFileSync(path.join(stubs, 'node'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$NODE_CALLS"\n', { mode: 0o755 })
    const script = path.join(root, 'entrypoint.sh')
    fs.writeFileSync(script, entrypoint.replaceAll('/opt/vm2api', image))
    const calls = path.join(root, 'node-calls')
    const run = () => {
      const result = spawnSync('sh', [script], {
        encoding: 'utf8',
        timeout: 10000,
        env: {
          ...process.env,
          PATH: `${stubs}:${process.env.PATH}`,
          KIN_PROJECT_ROOT: runtime,
          KIN_KERNEL_BIN: path.join(runtime, 'bin/kin-kernel'),
          KIN_AUTO_SYNC_WRAP: '0',
          VM2API_ADMIN_USER: 'test',
          VM2API_ADMIN_PASSWORD: 'fixture',
          VM2API_API_KEY: 'fixture',
          VM2API_DB_SECRET: 'fixture',
          NODE_CALLS: calls,
        },
      })
      assert.equal(result.status, 0, `${result.error || ''}\n${result.stderr}`)
    }
    const installed = path.join(runtime, 'share/crag/kin-kernel')
    run()
    assert.equal(fs.readFileSync(installed, 'utf8'), 'crag-v1')
    assert.equal(fs.statSync(installed).mode & 0o777, 0o755)
    const old = fs.openSync(installed, 'r')
    try {
      fs.writeFileSync(source, 'crag-v2')
      run()
      assert.equal(fs.readFileSync(installed, 'utf8'), 'crag-v2')
      assert.equal(fs.readFileSync(old, 'utf8'), 'crag-v1')
    } finally {
      fs.closeSync(old)
    }
    const inode = fs.statSync(installed).ino
    run()
    assert.equal(fs.statSync(installed).ino, inode)
    assert.equal(fs.existsSync(`${installed}.new`), false)
    assert.equal(fs.readFileSync(path.join(runtime, 'src/config/routing.json'), 'utf8'), routing)
    assert.equal(fs.readFileSync(path.join(runtime, 'vms/vm-01.json'), 'utf8'), slot)
    assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n'), Array(3).fill('src/server.mjs'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
