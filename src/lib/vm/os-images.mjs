/** Check prepared slot images without starting network or build work. */
import { spawnSync } from 'node:child_process'

import { OS_CATALOG, OS_ORDER, OS_REGISTRY } from './os-catalog.mjs'
export { OS_CATALOG, OS_ORDER } from './os-catalog.mjs'

export function inspectKernelImage(kernel, { runDocker = spawnSync } = {}) {
  const meta = OS_CATALOG[kernel]
  if (!meta) return { ok: false, code: 'invalid_kernel', error: `Unknown slot OS: ${kernel}` }
  const result = runDocker('docker', ['image', 'inspect', meta.image], { encoding: 'utf8', timeout: 10_000 })
  if (result.status === 0) return { ok: true, image: meta.image }
  const detail = String(result.stderr || result.error?.message || result.stdout || '').trim()
  if (!/No such (?:image|object)/i.test(detail)) {
    return {
      ok: false,
      code: 'docker_unavailable',
      image: meta.image,
      error: `Cannot inspect slot image: ${detail || 'Docker is unavailable'}`,
    }
  }
  return {
    ok: false,
    code: 'slot_image_missing',
    image: meta.image,
    error: `${meta.pretty} 槽位镜像尚未准备。请管理员在源码目录执行 node docker/kin-os/build.mjs ${OS_REGISTRY ? '--pull ' : ''}${kernel} 后重试。`,
  }
}

export function selectSlotImages(selectors = []) {
  if (!selectors.length) return OS_ORDER.map((kernel) => ({ kernel, ...OS_CATALOG[kernel] }))
  const selected = new Set()
  for (const selector of selectors) {
    const kernel = OS_ORDER.find((key) => {
      const meta = OS_CATALOG[key]
      return selector === key || selector === meta.family || selector === meta.image
    })
    if (!kernel) throw new Error(`Unknown slot OS selector: ${selector}; expected ${OS_ORDER.join(', ')}`)
    selected.add(kernel)
  }
  return OS_ORDER.filter((kernel) => selected.has(kernel)).map((kernel) => ({ kernel, ...OS_CATALOG[kernel] }))
}
