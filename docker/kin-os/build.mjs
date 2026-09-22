#!/usr/bin/env node
/** Prepare slot images explicitly; production boot can use --check without building. */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectKernelImage, selectSlotImages } from '../../src/lib/vm/os-images.mjs'
import { OS_REGISTRY } from '../../src/lib/vm/os-catalog.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))

export function buildSlotImages(args = [], { runDocker = spawnSync, log = console.log, env = process.env } = {}) {
  const force = args.includes('--force')
  const checkOnly = args.includes('--check')
  const pullOnly = args.includes('--pull-only')
  const pull = pullOnly || args.includes('--pull')
  if (checkOnly && (force || pull)) throw new Error('--check cannot be combined with --force or --pull')
  if (pull && !OS_REGISTRY) throw new Error('--pull requires KIN_OS_REGISTRY; local kin-os tags are never pulled')
  const images = selectSlotImages(args.filter((arg) => !['--force', '--check', '--pull', '--pull-only'].includes(arg)))
  for (const img of images) {
    const inspected = inspectKernelImage(img.kernel, { runDocker })
    if (!inspected.ok && inspected.code !== 'slot_image_missing') throw new Error(inspected.error)
    if (inspected.ok && !force) {
      log(`vm2api: ready ${img.image}`)
      continue
    }
    if (checkOnly) throw new Error(inspected.error)
    if (pull) {
      const pulled = runDocker('docker', ['pull', img.image], { stdio: 'inherit' })
      if (pulled.status === 0) {
        const ready = inspectKernelImage(img.kernel, { runDocker })
        if (!ready.ok) throw new Error(ready.error)
        continue
      }
      if (pullOnly) {
        log(`vm2api: ${img.image} not pulled; prepare the image before starting a slot`)
        continue
      }
    }
    const builder = String(env.VM2API_BUILD_BUILDER || '').trim()
    const cgroup = String(env.VM2API_BUILD_CGROUP_PARENT || '').trim()
    const command = builder ? ['buildx', 'build', '--builder', builder, '--load'] : ['build']
    if (cgroup) command.push('--cgroup-parent', cgroup)
    command.push('-t', img.image, path.join(root, img.kernel))
    const result = runDocker('docker', command, { stdio: 'inherit' })
    if (result.status !== 0) throw new Error(`Failed to build ${img.image}: ${result.error?.message || `exit ${result.status}`}`)
    const ready = inspectKernelImage(img.kernel, { runDocker })
    if (!ready.ok) throw new Error(ready.error)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    buildSlotImages(process.argv.slice(2))
  } catch (error) {
    console.error(`vm2api: ${error.message}`)
    process.exitCode = 1
  }
}
