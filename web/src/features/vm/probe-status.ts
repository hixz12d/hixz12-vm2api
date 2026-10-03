export type ProbeCheck = {
  at?: string
  probed_at?: string
  ok?: boolean
  source?: string
  via?: string
  error?: unknown
  data_at?: string | null
}

export function latestProbe(...records: (ProbeCheck | null | undefined)[]) {
  return (
    records
      .filter((p): p is ProbeCheck => !!p)
      .sort(
        (a, b) =>
          (Date.parse(b.at || b.probed_at || '') || 0) -
          (Date.parse(a.at || a.probed_at || '') || 0)
      )[0] || {}
  )
}

export function probeSourceLabel(source?: string) {
  return source === 'messages-headers' ? '请求响应头（缓存）' : source || '—'
}

export function probeOutcome(probe: ProbeCheck): string {
  if (probe.ok === false) {
    const error = probe.error
    const details =
      error && typeof error === 'object' && !Array.isArray(error)
        ? (error as Record<string, unknown>)
        : null
    const candidates = details
      ? [details.message, details.code, details.type]
      : [error]
    return (
      candidates.find(
        (value): value is string =>
          typeof value === 'string' && value.trim().length > 0
      ) || '探测失败'
    )
  }
  if (probe.ok === true)
    return probe.source === 'messages-headers' ? '已读取缓存' : '探测成功'
  return '—'
}

/** `POST /api/panel/vms/:id/sync` 剥壳后的 payload，字段见计划接口约定。 */
export type SyncResult = {
  vm_id?: string
  ok?: boolean
  account_tier?: string | null
  account_tier_source?: 'profile' | 'usage' | 'default' | null
  steps?: {
    /** GPT 账号为 null。 */
    profile?: { ok?: boolean; tier?: string | null; error?: string | null } | null
    usage?: { ok?: boolean; error?: string | null } | null
    cooldown?: {
      cleared?: boolean
      before?: string | null
      kept?: string | null
    } | null
  }
  account_issue?: { code: string; text: string; since?: string | null } | null
  probe?: ProbeCheck | null
}

const TIER_NAME: Record<string, string> = {
  max: 'Max',
  pro: 'Pro',
  codex: 'GPT',
  none: '未知',
}

const TIER_SOURCE_NAME: Record<string, string> = {
  profile: '官方资料',
  usage: '按额度推断',
  default: '默认值',
}

function tierName(tier?: string | null) {
  const t = String(tier || '').toLowerCase()
  return TIER_NAME[t] || tier || '未知'
}

/** 同步账号结果 → 一句提示：套餐 / 额度 / 冷却三部分，用「；」连接。 */
export function syncOutcome(result: SyncResult): string {
  const parts: string[] = []
  const steps = result.steps || {}
  const tier = tierName(result.account_tier)
  const profile = steps.profile
  if (profile) {
    if (profile.ok) {
      const src = TIER_SOURCE_NAME[String(result.account_tier_source || '')]
      parts.push(`套餐：${tier}${src ? `（${src}）` : ''}`)
    } else {
      parts.push(`套餐：未能读取官方资料，沿用 ${tier}`)
    }
  }
  const usage = steps.usage
  if (usage) {
    parts.push(
      usage.ok
        ? '额度已更新'
        : `额度查询失败：${usage.error || result.probe?.error || '未知错误'}`
    )
  } else if (result.ok === false) {
    parts.push(`额度查询失败：${result.probe?.error || '未知错误'}`)
  }
  const cd = steps.cooldown
  if (cd?.cleared) parts.push('已解除冷却')
  else if (cd?.kept === 'quota_rejected') parts.push('官方额度仍用完，保留冷却')
  else if (cd?.kept === 'usage_not_ok') parts.push('额度未确认，未解除冷却')
  else if (/^quota_(5h|7d)/.test(cd?.kept || ''))
    parts.push(
      `${cd?.kept?.startsWith('quota_5h') ? '5h' : '7d'} 额度安全线仍生效，保留限制（${cd?.kept}）`
    )
  else if (cd?.kept) parts.push(`保留冷却（${cd.kept}）`)
  if (result.account_issue) parts.push(`账号异常：${result.account_issue.text}`)
  return parts.join('；') || (result.ok ? '同步完成' : '同步失败')
}
