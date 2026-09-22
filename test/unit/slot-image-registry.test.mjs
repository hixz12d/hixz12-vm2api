import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { buildSlotImages } from '../../docker/kin-os/build.mjs'

// Use a fresh process because the registry is intentionally fixed at module load.
test('registry opt-in keeps image checks and explicit provisioning on the same catalog', () => {
  const script = `
    import assert from 'node:assert/strict'
    import { OS_CATALOG, imageForKernel } from './src/lib/vm/os-catalog.mjs'
    import { inspectKernelImage } from './src/lib/vm/os-images.mjs'
    import { buildSlotImages } from './docker/kin-os/build.mjs'
    const image = 'ghcr.io/dofastted/kin-os-debian:12'
    assert.equal(OS_CATALOG['debian-12'].image, image)
    assert.equal(imageForKernel('debian-12'), image)
    function fixture(pullOk) {
      let present = false
      const calls = []
      return { calls, runDocker(command, args) {
        assert.equal(command, 'docker')
        calls.push(args)
        if (args[0] === 'image') return present ? { status: 0 } : { status: 1, stderr: 'No such image' }
        if (args[0] === 'pull') { present = pullOk; return { status: pullOk ? 0 : 1 } }
        assert.equal(args[0], 'buildx')
        assert.equal(args[args.indexOf('-t') + 1], image)
        present = true
        return { status: 0 }
      }}
    }
    const options = { log() {}, env: { VM2API_BUILD_BUILDER: 'limited', VM2API_BUILD_CGROUP_PARENT: 'limited.slice' } }
    const pulled = fixture(true)
    buildSlotImages(['--pull', 'debian'], { ...options, ...pulled })
    assert.deepEqual(pulled.calls.map(a => a[0]), ['image', 'pull', 'image'])
    assert.equal(inspectKernelImage('debian-12', pulled).ok, true)
    const fallback = fixture(false)
    buildSlotImages(['--pull', 'debian'], { ...options, ...fallback })
    assert.deepEqual(fallback.calls.map(a => a[0]), ['image', 'pull', 'buildx', 'image'])
    const build = fallback.calls.find(a => a[0] === 'buildx')
    assert.equal(build[build.indexOf('--cgroup-parent') + 1], 'limited.slice')
    const only = fixture(false)
    buildSlotImages(['--pull-only', 'debian'], { ...options, ...only })
    assert.deepEqual(only.calls.map(a => a[0]), ['image', 'pull'])
    const check = fixture(false)
    assert.throws(() => buildSlotImages(['--check', 'debian'], { ...options, ...check }), /尚未准备/)
    assert.deepEqual(check.calls.map(a => a[0]), ['image'])
    assert.throws(() => buildSlotImages(['--check', '--pull']), /cannot be combined/)
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('../../', import.meta.url),
    env: { ...process.env, KIN_OS_REGISTRY: 'ghcr.io/dofastted/' },
    encoding: 'utf8',
    timeout: 10_000,
  })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
})

test('local image mode refuses pull flags before invoking Docker', () => {
  assert.throws(
    () =>
      buildSlotImages(['--pull'], {
        runDocker() {
          assert.fail('Must not call Docker')
        },
      }),
    /requires KIN_OS_REGISTRY/,
  )
})
