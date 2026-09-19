import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPanelHandler } from '../../src/lib/admin/panel-routes.mjs'

function makeCreateHandler(project, body, inspectKernelImage = () => ({ ok: true })) {
  const response = {}
  const handlePanel = createPanelHandler({
    cfg: { paths: { project } },
    inspectKernelImage,
    requireAuth(req) {
      req.apiKeyKind = 'master'
      req.panelRole = 'admin'
      return true
    },
    json(_res, status, payload) {
      response.status = status
      response.body = payload
      return true
    },
    readBody: async () => body,
    proxyPool: {
      allocateForVm() {
        throw new Error('no healthy SOCKS5')
      },
      getProxyForVm() {
        return null
      },
    },
  })
  return { handlePanel, response }
}

test('import-style create succeeds without seed_policy or SOCKS5', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-create-'))
  try {
    const { handlePanel, response } = makeCreateHandler(root, {
      name: 'import-slot',
      start: false,
      auto_allocate_proxy: false,
    })
    const handled = await handlePanel({ method: 'POST' }, {}, new URL('http://localhost/api/panel/vms/create'))
    assert.equal(handled, true)
    assert.equal(response.status, 200, response.body?.error?.message || JSON.stringify(response.body))
    assert.equal(response.body?.ok, true)
    const vm = response.body?.data?.vm
    assert.ok(vm?.id, 'created vm id')
    assert.equal(vm.status, 'stopped')
    assert.equal(vm.proxy_cli_enabled, false)
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'vms', `${vm.id}.json`), 'utf8'))
    assert.equal(saved.seed_policy.telemetry_disabled, false)
    assert.equal(saved.proxy_required, false)
    assert.equal(saved.proxy, null)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

for (const kernel of ['ubuntu-24.04', 'debian-12', 'archlinux', 'fedora-41']) {
  test(`missing ${kernel} image refuses create before saving a slot or allocating a proxy`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-create-image-'))
    try {
      const { handlePanel, response } = makeCreateHandler(
        root,
        { id: 'vm-09', kernel, start: true, auto_allocate_proxy: true, activate: true },
        (selected) => {
          assert.equal(selected, kernel)
          assert.equal(fs.existsSync(path.join(root, 'vms', 'vm-09.json')), false)
          return { ok: false, code: 'slot_image_missing', error: 'Prepare the local OS image first' }
        },
      )
      await handlePanel({ method: 'POST' }, {}, new URL('http://localhost/api/panel/vms/create'))
      assert.equal(response.status, 409)
      assert.equal(response.body.error.code, 'slot_image_missing')
      assert.deepEqual(fs.readdirSync(path.join(root, 'vms')), [])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
}

test('create-only does not require Docker or an OS image', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-create-offline-'))
  try {
    const { handlePanel, response } = makeCreateHandler(root, { kernel: 'debian-12', start: false }, () => {
      throw new Error('Image inspection must not run for an idle slot')
    })
    await handlePanel({ method: 'POST' }, {}, new URL('http://localhost/api/panel/vms/create'))
    assert.equal(response.status, 200)
    assert.equal(response.body.data.vm.status, 'stopped')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('Docker inspection failure is reported as unavailable without saving a slot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-create-docker-'))
  try {
    const { handlePanel, response } = makeCreateHandler(root, { start: true }, () => ({
      ok: false,
      code: 'docker_unavailable',
      error: 'Cannot connect to the Docker daemon',
    }))
    await handlePanel({ method: 'POST' }, {}, new URL('http://localhost/api/panel/vms/create'))
    assert.equal(response.status, 503)
    assert.equal(response.body.error.code, 'docker_unavailable')
    assert.deepEqual(fs.readdirSync(path.join(root, 'vms')), [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('create preserves Tokyo in the slot, fingerprint and settings', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-create-tokyo-'))
  try {
    const { handlePanel, response } = makeCreateHandler(root, {
      name: 'tokyo-slot',
      timezone: ' asia/tokyo ',
      start: false,
      auto_allocate_proxy: false,
    })
    await handlePanel({ method: 'POST' }, {}, new URL('http://localhost/api/panel/vms/create'))
    assert.equal(response.status, 200, response.body?.error?.message || JSON.stringify(response.body))
    const id = response.body?.data?.vm?.id
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'vms', `${id}.json`), 'utf8'))
    assert.equal(saved.timezone, 'Asia/Tokyo')
    assert.equal(saved.fingerprint.timezone, 'Asia/Tokyo')
    assert.equal(saved.locale, 'en_US.UTF-8')
    const settings = JSON.parse(
      fs.readFileSync(path.join(root, 'vms', id, 'cli-home', '.claude', 'settings.json'), 'utf8'),
    )
    assert.equal(settings.env.TZ, 'Asia/Tokyo')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('create does not 409 when proxy allocation fails', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-create-proxy-'))
  try {
    const { handlePanel, response } = makeCreateHandler(root, {
      name: 'no-proxy',
      start: true,
      auto_allocate_proxy: true,
    })
    await handlePanel({ method: 'POST' }, {}, new URL('http://localhost/api/panel/vms/create'))
    assert.notEqual(response.status, 409)
    assert.equal(response.status, 200, response.body?.error?.message || JSON.stringify(response.body))
    assert.equal(response.body?.data?.vm?.status, 'stopped')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('create preserves Tokyo timezone in the VM, fingerprint, and CLI seed files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-create-tokyo-'))
  try {
    const { handlePanel, response } = makeCreateHandler(root, {
      name: 'tokyo-slot',
      timezone: 'Asia/Tokyo',
      start: false,
      auto_allocate_proxy: false,
    })
    await handlePanel({ method: 'POST' }, {}, new URL('http://localhost/api/panel/vms/create'))
    assert.equal(response.status, 200, response.body?.error?.message || JSON.stringify(response.body))
    const vm = response.body?.data?.vm
    assert.equal(vm.timezone, 'Asia/Tokyo')
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'vms', `${vm.id}.json`), 'utf8'))
    assert.equal(saved.timezone, 'Asia/Tokyo')
    assert.equal(saved.timezone_source, 'manual')
    assert.equal(saved.fingerprint.timezone, 'Asia/Tokyo')
    assert.equal(saved.locale, 'en_US.UTF-8')
    const claudeDir = path.join(root, 'vms', vm.id, 'cli-home', '.claude')
    const settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'))
    const seed = JSON.parse(fs.readFileSync(path.join(claudeDir, 'kin-seed.json'), 'utf8'))
    assert.equal(settings.env.TZ, 'Asia/Tokyo')
    assert.equal(seed.timezone, 'Asia/Tokyo')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
