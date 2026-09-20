import test from 'node:test'
import assert from 'node:assert/strict'
import { collectDockerGuestIdentity } from '../../src/lib/vm/docker-guest-identity.mjs'

const identity = {
  runtime_kind: 'docker',
  hostname: 'debian-guest',
  os_id: 'debian',
  os_pretty: 'Debian GNU/Linux 12',
  kernel_release: '6.1.0',
  arch: 'x86_64',
  collected_at: '2026-09-20T00:00:00Z',
}

test('collects from the selected container without a worker socket or host shell', async () => {
  const result = await collectDockerGuestIdentity(
    { id: 'vm-02' },
    {
      timeoutMs: 1234,
      run: async (file, args, opts) => {
        assert.equal(file, 'docker')
        assert.deepEqual(args.slice(0, 4), ['exec', 'kin-02', 'python3', '-c'])
        assert.match(args[4], /socket.gethostname\(\)/)
        assert.match(args[4], /platform.freedesktop_os_release\(\)/)
        assert.equal(opts.timeout, 1234)
        assert.equal(opts.maxBuffer, 65536)
        assert.equal(opts.shell, undefined)
        return { stdout: JSON.stringify(identity) }
      },
    },
  )
  assert.equal(result.ok, true)
  assert.deepEqual(result.identity, identity)
})

test('unsupported runtime and missing slot do not execute Docker', async () => {
  const run = async () => assert.fail('must not execute Docker')
  assert.equal((await collectDockerGuestIdentity({}, { run })).code, 'vm_required')
  assert.equal(
    (await collectDockerGuestIdentity({ id: 'vm-01', runtime: { type: 'kvm' } }, { run })).code,
    'guest_identity_unsupported',
  )
})

test('container errors and timeouts fail without returning identity', async () => {
  for (const [error, code] of [
    [Object.assign(new Error('docker exited'), { stderr: 'container is not running' }), 'guest_identity_failed'],
    [Object.assign(new Error('timed out'), { killed: true }), 'guest_identity_timeout'],
  ]) {
    const result = await collectDockerGuestIdentity(
      { id: 'vm-01' },
      {
        run: async () => {
          throw error
        },
      },
    )
    assert.equal(result.ok, false)
    assert.equal(result.code, code)
    assert.equal(result.identity, undefined)
  }
})

test('malformed or incomplete output never becomes a successful collection', async () => {
  for (const stdout of [
    'not json',
    'null',
    '{}',
    JSON.stringify({ ...identity, hostname: '' }),
    JSON.stringify({ ...identity, collected_at: 'invalid' }),
  ]) {
    const result = await collectDockerGuestIdentity({ id: 'vm-01' }, { run: async () => ({ stdout }) })
    assert.equal(result.ok, false)
    assert.equal(result.identity, undefined)
  }
})
