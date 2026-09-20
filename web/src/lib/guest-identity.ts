import type { Vm } from '@/types/panel-vm'

export function guestIdentityState(vm: Pick<Vm, 'fingerprint' | 'runtime'>) {
  const fp = vm.fingerprint || {}
  const runtime = vm.runtime || {}
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  const collectedAt = [runtime.identity_collected_at, fp.collected_at]
    .map(text)
    .find((value) => value && Number.isFinite(Date.parse(value)))
  const generated = fp.source === 'generated' && !!text(fp.hostname)
  return {
    hostname: collectedAt
      ? text(runtime.guest_hostname) ||
        text(fp.guest_hostname) ||
        text(fp.hostname) ||
        '—'
      : text(fp.hostname) || '—',
    status: collectedAt ? '已采集' : generated ? '已生成，未采集' : '未采集',
    collectedAt: collectedAt || null,
  }
}
