import type { ApiKeyItem } from '@/types/panel-keys'
import type { Vm } from '@/types/panel-vm'
import { usedPctOf } from '@/lib/format'
import { isCodexVm } from '@/lib/vm-kind'
import { accountStatus, claudeTier } from '@/lib/vm-status'
/**
 * 总览「交换台」的纯逻辑：每个账号是一条线，灯只在需要处理时亮。
 * 只做展示层归类，状态判断全部复用 `accountStatus`，不自创口径。
 */

import type { CordKey, LampTone } from '@/components/switchboard-parts'

export type { CordKey, LampTone }

export type AccountGroupLite = {
  id: number
  name: string
  status?: string
  vm_ids?: string[]
}

export type LineView = {
  vm: Vm
  name: string
  /** 灯：red = 坏了，amber = 需要留意，null = 不亮（正常或站长主动关的）。 */
  lamp: LampTone
  statusText: string
  /** 站长主动关掉 / 没凭证：不点灯，但文字变暗。 */
  idle: boolean
  groupName: string
  cord: CordKey
  used5h: number
  used7d: number
}

export function lampOf(vm: Vm): {
  lamp: LampTone
  text: string
  idle: boolean
} {
  const s = accountStatus(vm)
  if (s.cls === 'bad') return { lamp: 'red', text: s.text, idle: false }
  if (s.cls === 'warn' || s.cls === 'caution')
    return { lamp: 'amber', text: s.text, idle: false }
  if (s.cls === 'off') return { lamp: null, text: '已暂停调度', idle: true }
  if (s.cls === 'none') return { lamp: null, text: '还没导入凭证', idle: true }
  return { lamp: null, text: '正常', idle: false }
}

/** 分组名里带 Max / Pro / GPT 时按名字定线色，否则按账号套餐。 */
export function cordOf(groupName: string, vm?: Vm): CordKey {
  const n = groupName.toLowerCase()
  if (/max/.test(n)) return 'max'
  if (/pro/.test(n)) return 'pro'
  if (/gpt|codex|openai/.test(n)) return 'codex'
  if (vm) {
    if (isCodexVm(vm)) return 'codex'
    const tier = claudeTier(vm).key
    if (tier === 'max' || tier === 'pro') return tier
  }
  return 'other'
}

export function groupOfVm(
  vmId: string,
  groups: AccountGroupLite[]
): AccountGroupLite | undefined {
  return groups.find((g) => (g.vm_ids || []).includes(vmId))
}

const LAMP_RANK: Record<string, number> = { red: 0, amber: 1 }

export function buildLines(vms: Vm[], groups: AccountGroupLite[]): LineView[] {
  const lines = vms.map<LineView>((vm) => {
    const { lamp, text, idle } = lampOf(vm)
    const group = groupOfVm(vm.id, groups)
    const tierLabel = isCodexVm(vm) ? 'GPT' : `Claude ${claudeTier(vm).label}`
    const groupName = group?.name || (vm.has_token ? tierLabel : '未分组')
    return {
      vm,
      name: String(vm.name || vm.id),
      lamp,
      statusText: text,
      idle,
      groupName,
      cord: cordOf(group?.name || '', vm),
      used5h: usedPctOf(vm, '5h'),
      used7d: usedPctOf(vm, '7d'),
    }
  })
  // 亮灯的排前面（红 → 琥珀），其余保持原顺序
  return lines
    .map((line, i) => ({ line, i }))
    .sort(
      (a, b) =>
        (LAMP_RANK[a.line.lamp ?? ''] ?? 9) -
          (LAMP_RANK[b.line.lamp ?? ''] ?? 9) || a.i - b.i
    )
    .map((x) => x.line)
}

export type StatusSummary = {
  tone: LampTone
  sentence: string
  /** 需要处理的线（亮灯的账号）。 */
  lit: LineView[]
  idleCount: number
}

export function summarize(
  lines: LineView[],
  recentErrors: number
): StatusSummary {
  const lit = lines.filter((l) => l.lamp)
  const red = lit.filter((l) => l.lamp === 'red').length
  const idleCount = lines.filter((l) => l.idle).length
  const working = lines.length - idleCount

  if (!lines.length)
    return {
      tone: null,
      sentence: '还没有账号，先导入一个吧',
      lit,
      idleCount,
    }

  if (!lit.length) {
    const base =
      working === lines.length
        ? `${lines.length} 个账号都正常`
        : `${working} 个在用的账号都正常`
    const tail =
      recentErrors > 0
        ? `，不过最近 1 小时有 ${recentErrors} 个请求出错`
        : '，没有需要处理的事'
    return {
      tone: recentErrors > 0 ? 'amber' : null,
      sentence: base + tail,
      lit,
      idleCount,
    }
  }

  const parts: string[] = []
  if (red) parts.push(`${red} 个账号出了问题`)
  if (lit.length - red) parts.push(`${lit.length - red} 个账号需要留意`)
  return {
    tone: red ? 'red' : 'amber',
    sentence: `${parts.join('，')}，其余 ${Math.max(0, working - lit.length)} 个正常`,
    lit,
    idleCount,
  }
}

/** 选中一个 Key 时，它能用到的账号 id；Key 没绑分组或分组停用时为空集。 */
export function reachableVmIds(
  key: ApiKeyItem | undefined,
  groups: AccountGroupLite[]
): Set<string> {
  if (!key || key.group_id == null) return new Set()
  const g = groups.find((x) => x.id === key.group_id)
  if (!g || g.status === 'disabled') return new Set()
  return new Set(g.vm_ids || [])
}
