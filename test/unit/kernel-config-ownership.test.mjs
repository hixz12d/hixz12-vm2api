import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { writeKernelConfig } from '../../src/lib/transport/rust-kernel-supervisor.mjs'

const rootLinux = process.platform === 'linux' && process.getuid?.() === 0
const options = { skip: !rootLinux && 'requires Linux root to exercise a distinct slot uid/gid' }
const uid = 10002
const gid = 987

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-config-owner-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.chmodSync(root, 0o755)
  const vm = { id: 'vm-02', timezone: 'America/New_York' }
  const made = writeKernelConfig(root, vm, { token: 'test-token', routing: { compatibility: { cache_ttl: '5m' } } })
  for (const dir of [path.join(root, 'vms'), path.join(root, 'vms', vm.id)]) fs.chmodSync(dir, 0o755)
  for (const file of [made.runDir, made.configPath, made.tokenPath]) fs.chownSync(file, uid, gid)
  return { root, vm, ...made }
}

test('hot projection preserves the slot owner and the non-root kernel can read its new config', options, (t) => {
  const f = fixture(t)
  const before = fs.statSync(f.configPath)
  const written = writeKernelConfig(
    f.root,
    { ...f.vm, timezone: 'America/Chicago' },
    {
      routing: { compatibility: { cache_ttl: '5m' } },
    },
  )
  assert.equal(written.changed, true)
  const after = fs.statSync(f.configPath)
  assert.notEqual(after.ino, before.ino)
  assert.equal(after.uid, uid)
  assert.equal(after.gid, gid)
  assert.equal(after.mode & 0o777, 0o600)
  const read = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import fs from 'node:fs';const c=JSON.parse(fs.readFileSync(process.argv[1]));if(c.timezone!=='America/Chicago'||c.default_cache_ttl!=='5m')process.exit(2)",
      f.configPath,
    ],
    { uid, gid, encoding: 'utf8', timeout: 5000 },
  )
  assert.equal(read.status, 0, read.stderr || read.error?.message)
  assert.equal(
    writeKernelConfig(
      f.root,
      { ...f.vm, timezone: 'America/Chicago' },
      {
        routing: { compatibility: { cache_ttl: '5m' } },
      },
    ).changed,
    false,
  )
  assert.equal(fs.statSync(f.configPath).ino, after.ino)
})

test('failed ownership preservation keeps the old config intact and cleans the temporary file', options, (t) => {
  const f = fixture(t)
  const before = fs.readFileSync(f.configPath, 'utf8')
  const inode = fs.statSync(f.configPath).ino
  t.mock.method(fs, 'chownSync', () => {
    throw Object.assign(new Error('denied'), { code: 'EPERM' })
  })
  assert.throws(() => writeKernelConfig(f.root, { ...f.vm, timezone: 'UTC' }), { code: 'EPERM' })
  assert.equal(fs.readFileSync(f.configPath, 'utf8'), before)
  assert.equal(fs.statSync(f.configPath).ino, inode)
  assert.equal(fs.statSync(f.configPath).uid, uid)
  assert.equal(
    fs.readdirSync(f.runDir).some((name) => name.endsWith('.tmp')),
    false,
  )
})
