import test from 'node:test'
import assert from 'node:assert/strict'
import { OS_CATALOG, OS_ORDER, inspectKernelImage, selectSlotImages } from '../../src/lib/vm/os-images.mjs'
import { checkSlotStartImage } from '../../src/lib/vm/vm-runtime.mjs'
import { buildSlotImages } from '../../docker/kin-os/build.mjs'

function dockerFixture({ ready = [], failBuild = false, failInspect = false } = {}) {
  const present = new Set(ready)
  const calls = []
  const runDocker = (command, args) => {
    assert.equal(command, 'docker')
    calls.push(args)
    if (args[0] === 'image') {
      if (failInspect) return { status: 1, stderr: 'Cannot connect to the Docker daemon' }
      return present.has(args[2])
        ? { status: 0 }
        : { status: 1, stderr: `Error response from daemon: No such image: ${args[2]}` }
    }
    assert.ok(args[0] === 'build' || args[0] === 'buildx')
    if (failBuild) return { status: 1 }
    present.add(args[args.indexOf('-t') + 1])
    return { status: 0 }
  }
  return { calls, runDocker, present }
}

for (const kernel of OS_ORDER) {
  test(`${kernel}: local image is checked without a registry pull`, () => {
    const docker = dockerFixture()
    const result = inspectKernelImage(kernel, docker)
    assert.equal(result.code, 'slot_image_missing')
    assert.match(result.error, new RegExp(kernel))
    assert.deepEqual(docker.calls, [['image', 'inspect', OS_CATALOG[kernel].image]])
    docker.present.add(OS_CATALOG[kernel].image)
    assert.equal(inspectKernelImage(kernel, docker).ok, true)
  })
}

test('Docker failure is not mistaken for a missing local image', () => {
  const result = inspectKernelImage('debian-12', dockerFixture({ failInspect: true }))
  assert.equal(result.code, 'docker_unavailable')
  assert.match(result.error, /Cannot connect/)
  assert.equal(inspectKernelImage('unknown').code, 'invalid_kernel')
})

test('all OS selectors resolve exact IDs, family aliases and full image tags', () => {
  assert.deepEqual(
    selectSlotImages().map((x) => x.kernel),
    OS_ORDER,
  )
  for (const kernel of OS_ORDER) {
    const meta = OS_CATALOG[kernel]
    assert.deepEqual(
      selectSlotImages([kernel, meta.family, meta.image]).map((x) => x.kernel),
      [kernel],
    )
  }
  assert.throws(() => selectSlotImages(['deb']), /Unknown slot OS selector/)
  assert.throws(() => selectSlotImages(['--typo']), /Unknown slot OS selector/)
})

test('default preparation builds every missing advertised OS serially and skips Ubuntu already present', () => {
  const docker = dockerFixture({ ready: [OS_CATALOG['ubuntu-24.04'].image] })
  buildSlotImages([], { ...docker, log() {}, env: {} })
  assert.equal(docker.present.size, OS_ORDER.length)
  const builds = docker.calls.filter((a) => a[0] === 'build')
  assert.deepEqual(
    builds.map((a) => a[2]),
    ['kin-os/debian:12', 'kin-os/arch:latest', 'kin-os/fedora:41'],
  )
  for (const build of builds) {
    const i = docker.calls.indexOf(build)
    assert.deepEqual(docker.calls[i + 1], ['image', 'inspect', build[2]])
  }
})

test('explicit builder and cgroup are passed through and the result is loaded into the host engine', () => {
  const docker = dockerFixture()
  buildSlotImages(['debian'], {
    ...docker,
    log() {},
    env: { VM2API_BUILD_BUILDER: 'vm2api', VM2API_BUILD_CGROUP_PARENT: 'vm2api-build.slice' },
  })
  const build = docker.calls.find((a) => a[0] === 'buildx')
  assert.deepEqual(build.slice(0, -1), [
    'buildx',
    'build',
    '--builder',
    'vm2api',
    '--load',
    '--cgroup-parent',
    'vm2api-build.slice',
    '-t',
    'kin-os/debian:12',
  ])
  assert.match(build.at(-1), /debian-12$/)
})

test('check-only refuses a missing image without starting a build', () => {
  const docker = dockerFixture()
  assert.throws(() => buildSlotImages(['--check', 'debian'], { ...docker, log() {}, env: {} }), /尚未准备/)
  assert.equal(docker.calls.length, 1)
  assert.throws(() => buildSlotImages(['--check', '--force'], docker), /cannot be combined/)
})

test('force rebuilds a present image; unknown selectors and daemon errors never start builds', () => {
  const docker = dockerFixture({ ready: ['kin-os/debian:12'] })
  buildSlotImages(['--force', 'debian'], { ...docker, log() {}, env: {} })
  assert.equal(docker.calls.filter((a) => a[0] === 'build').length, 1)
  assert.throws(
    () =>
      buildSlotImages(['bogus'], {
        runDocker() {
          assert.fail('No Docker call expected')
        },
      }),
    /Unknown/,
  )
  const unavailable = dockerFixture({ failInspect: true })
  assert.throws(() => buildSlotImages([], unavailable), /Cannot connect/)
  assert.equal(unavailable.calls.length, 1)
})

test('failed image build stops preparation before the next OS', () => {
  const docker = dockerFixture({ failBuild: true })
  assert.throws(() => buildSlotImages([], { ...docker, log() {}, env: {} }), /Failed to build kin-os\/ubuntu/)
  assert.equal(docker.calls.length, 2)
})

test('missing replacement image is rejected for new or explicitly recreated slots', () => {
  const missing = { ok: false, code: 'slot_image_missing' }
  const inspectImage = (kernel) => {
    assert.equal(kernel, 'debian-12')
    return missing
  }
  const existing = { running: true, image: 'kin-os/ubuntu:24.04', networkMode: 'kin-eg-1' }
  assert.equal(checkSlotStartImage({ kernel: 'debian-12' }, { inspectImage }), missing)
  assert.equal(checkSlotStartImage({ kernel: 'debian-12', existing, recreate: true }, { inspectImage }), missing)
  assert.equal(
    checkSlotStartImage({ kernel: 'debian-12', existing: { ...existing, running: false } }, { inspectImage }),
    missing,
  )
})

test('healthy running slots and resumable stopped containers do not need an image tag to be retained', () => {
  for (const running of [true, false]) {
    const existing = { running, image: 'kin-os/debian:12', networkMode: 'kin-eg-1' }
    const result = checkSlotStartImage(
      { kernel: 'debian-12', existing, network: 'kin-eg-1' },
      {
        inspectImage() {
          assert.fail('Do not require a new image when no container is created')
        },
      },
    )
    assert.equal(result.ok, true)
    assert.equal(result.skipped, true)
  }
})
