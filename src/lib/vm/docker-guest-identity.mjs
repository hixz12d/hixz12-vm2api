import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { promisify } from 'node:util'
import { containerName } from './vm-runtime.mjs'
import { runtimeKind, RUNTIME_DOCKER } from './runtime-kind.mjs'

const runFile = promisify(execFile)
const script = fs.readFileSync(new URL('../../../scripts/collect-guest-identity.py', import.meta.url), 'utf8')

/** Collect from the guest namespace, without requiring the retired Go HTTP worker. */
export async function collectDockerGuestIdentity(vm, { run = runFile, timeoutMs = 5000 } = {}) {
  if (!vm?.id) return { ok: false, code: 'vm_required', error: 'vm required' }
  if (runtimeKind(vm) !== RUNTIME_DOCKER) {
    return { ok: false, code: 'guest_identity_unsupported', error: 'guest identity collection requires a Docker slot' }
  }
  try {
    const { stdout } = await run('docker', ['exec', containerName(vm.id), 'python3', '-c', script], {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 64 * 1024,
    })
    const identity = JSON.parse(stdout)
    if (
      !identity ||
      identity.runtime_kind !== RUNTIME_DOCKER ||
      ['hostname', 'os_id', 'os_pretty', 'kernel_release', 'arch'].some(
        (key) => typeof identity[key] !== 'string' || !identity[key].trim(),
      ) ||
      typeof identity.collected_at !== 'string' ||
      !Number.isFinite(Date.parse(identity.collected_at))
    ) {
      return { ok: false, code: 'guest_identity_invalid', error: 'guest returned incomplete identity data' }
    }
    return { ok: true, identity }
  } catch (error) {
    return {
      ok: false,
      code: error.killed ? 'guest_identity_timeout' : 'guest_identity_failed',
      error: String(error.stderr || error.message || error)
        .trim()
        .slice(0, 300),
    }
  }
}
