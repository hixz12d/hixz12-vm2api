import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mergeGuestFingerprint, collectSlotIdentity } from '../../src/lib/vm/guest-identity.mjs'

test('merge keeps device/session and maps arch', () => {
  const out = mergeGuestFingerprint(
    { device_id: 'dev-keep', session_id: 'sess-keep', stainless_package_version: '0.94.0' },
    {
      hostname: '01',
      os_id: 'ubuntu',
      os_pretty: 'Ubuntu 24.04',
      kernel_release: '6.8.0-host',
      arch: 'amd64',
      goos: 'linux',
      runtime_kind: 'docker',
      worker_version: '2026.08.23-identity',
      collected_at: '2026-08-23T00:00:00Z',
    },
  )
  assert.equal(out.device_id, 'dev-keep')
  assert.equal(out.session_id, 'sess-keep')
  assert.equal(out.source, 'guest')
  assert.equal(out.stainless_os, 'Linux')
  assert.equal(out.stainless_arch, 'x64')
  assert.equal(out.hostname, '01')
  assert.equal(out.stainless_package_version, '0.112.1')
  assert.equal(out.stainless_runtime_version, 'v26.3.0')
})

test('merge keeps official machine as device_id and parks guest machine', () => {
  const out = mergeGuestFingerprint(
    {
      official_machine_id: 'official-m',
      device_id: 'old-dev',
      machine_id: 'guest-m',
      session_id: 'sess-keep',
    },
    { hostname: '01', machine_id: 'guest-new', arch: 'amd64', goos: 'linux' },
  )
  assert.equal(out.device_id, 'official-m')
  assert.equal(out.official_machine_id, 'official-m')
  assert.equal(out.guest_machine_id, 'guest-new')
  assert.equal(out.identity_source, 'official-cc-init')
  assert.equal('machine_id' in out, false)
})

test('collectSlotIdentity writes guest facts while preserving identity and concurrent settings', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-guest-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const id = 'vm-01'
  fs.mkdirSync(path.join(root, 'vms', id), { recursive: true })
  const vmPath = path.join(root, 'vms', `${id}.json`)
  const vm = {
    id,
    fingerprint: { device_id: 'dev-1', session_id: 'sess-1', hostname: 'ubuntu-a3f1', source: 'generated' },
    runtime: { type: 'docker', kernel_socket: '/run/kin/kernel.sock' },
    claude: { mode: 'oauth', has_access: true },
  }
  fs.writeFileSync(vmPath, JSON.stringify(vm))
  const out = await collectSlotIdentity(root, vm, {
    collectGuest: async (target, opts) => {
      assert.equal(target.id, id)
      assert.equal(opts.timeoutMs, 2500)
      fs.writeFileSync(vmPath, JSON.stringify({ ...vm, timezone: 'America/New_York' }))
      return {
        ok: true,
        identity: {
          hostname: 'actual-guest',
          os_pretty: 'Ubuntu 24.04',
          arch: 'x86_64',
          goos: 'linux',
          runtime_kind: 'docker',
          collected_at: '2026-08-23T01:00:00Z',
        },
      }
    },
    timeoutMs: 2500,
  })
  assert.equal(out.ok, true)
  const saved = JSON.parse(fs.readFileSync(vmPath, 'utf8'))
  assert.equal(saved.fingerprint.device_id, 'dev-1')
  assert.equal(saved.fingerprint.session_id, 'sess-1')
  assert.equal(saved.fingerprint.hostname, 'ubuntu-a3f1')
  assert.equal(saved.fingerprint.source, 'generated')
  assert.equal(saved.runtime.guest_hostname, 'actual-guest')
  assert.equal(saved.runtime.guest_os, 'Ubuntu 24.04')
  assert.equal(saved.runtime.identity_collected_at, '2026-08-23T01:00:00Z')
  assert.equal(saved.runtime.kernel_socket, vm.runtime.kernel_socket)
  assert.equal(saved.timezone, 'America/New_York')
  assert.deepEqual(saved.claude, vm.claude)
})

test('failed collection leaves prior facts and collection timestamp untouched', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-guest-failed-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'vms'))
  const vm = { id: 'vm-01', fingerprint: { hostname: 'old', collected_at: '2026-08-23T01:00:00Z' } }
  const vmPath = path.join(root, 'vms', 'vm-01.json')
  const before = JSON.stringify(vm)
  fs.writeFileSync(vmPath, before)
  const out = await collectSlotIdentity(root, vm, {
    collectGuest: async () => ({ ok: false, code: 'guest_identity_failed', error: 'container is not running' }),
  })
  assert.equal(out.ok, false)
  assert.equal(out.code, 'guest_identity_failed')
  assert.equal(out.error, 'container is not running')
  assert.equal(fs.readFileSync(vmPath, 'utf8'), before)
})

test('merge keeps generated hostname and catalog kernel', () => {
  const out = mergeGuestFingerprint(
    {
      device_id: 'ab'.repeat(32),
      session_id: 'sess-keep',
      hostname: 'ubuntu-a3f1',
      linux_kernel: '6.8.0-51-generic',
      guest_machine_id: 'cd'.repeat(16),
      source: 'generated',
      timezone: 'America/Denver',
      locale: 'en_US.UTF-8',
    },
    {
      hostname: '05',
      kernel_release: '7.0.0-14-generic',
      machine_id: 'guest-new',
      timezone: 'UTC',
      locale: 'C',
      arch: 'amd64',
      goos: 'linux',
    },
  )
  assert.equal(out.hostname, 'ubuntu-a3f1')
  assert.equal(out.guest_hostname, '05')
  assert.equal(out.kernel_release, '6.8.0-51-generic')
  assert.equal(out.guest_kernel_release, '7.0.0-14-generic')
  assert.equal(out.guest_machine_id, 'cd'.repeat(16))
  assert.equal(out.timezone, 'America/Denver')
  assert.equal(out.locale, 'en_US.UTF-8')
  assert.equal(out.source, 'generated')
  assert.equal(out.device_id, 'ab'.repeat(32))
})
