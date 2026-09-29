import {
  Activity,
  Archive,
  BellRing,
  Fingerprint,
  Gauge,
  Info,
  Layers,
  ListChecks,
  Magnet,
  Network,
  PackageCheck,
  RadioTower,
  ScrollText,
  type LucideIcon,
} from 'lucide-react'

export const SETTINGS_TABS = [
  ['sticky', '同一会话固定账号'],
  ['pool', '账号怎么分配'],
  ['quota', '额度用完怎么办'],
  ['logs', '日志保存'],
  ['protocol', '请求改写'],
  ['whitelist', '提示词规则'],
  ['init', '官方 Claude Code 安装'],
  ['health', '账号健康检查'],
  ['notify', '消息通知'],
  ['telemetry', '官方统计上报'],
  ['socks5', '出口代理'],
  ['backup', '备份与恢复'],
  ['about', '版本与更新'],
] as const

export type SettingsTabId = (typeof SETTINGS_TABS)[number][0]

/** 每个分区顶部的一句白话：这里管什么、什么时候需要动。 */
export const SETTINGS_TAB_INTROS: Record<SettingsTabId, string> = {
  sticky:
    '同一段对话的请求尽量一直交给同一个账号处理，这样能命中缓存、省钱，也更像真人在用。一般保持默认。',
  pool: '有多个账号时，新请求按什么规则挑账号，某个账号出错时要不要换一个重试。',
  quota:
    '账号的 5 小时 / 7 天额度快用完或用完时怎么处理，以及每种套餐默认允许的并发和速度。',
  logs: '请求日志保留多久、记录多少细节。出问题排查时需要日志，但记得越多越占空间。',
  protocol:
    '转发前怎么整理请求，让它看起来就是官方 Claude Code 发出的。属于底层设置，不确定时不要改。',
  whitelist:
    '按规则改写或保留请求里的提示词内容。属于底层设置，不确定时不要改。',
  init: '导入完整 OAuth 凭证后，是否自动在账号的运行环境里安装官方 Claude Code，以及安装的细节。',
  health:
    '定期检查每个账号还能不能用，连续出错的账号会被暂时停用，过一会儿再试。',
  notify: '账号出问题、额度用完时，通过哪些渠道提醒你。',
  telemetry:
    '官方 Claude Code 会向 Anthropic 上报使用统计。这里决定每个账号要不要照官方的方式上报。',
  socks5: '所有出口代理的列表。给账号换代理请到「出口代理」页或账号详情。',
  backup: '导出或导入整套配置，换机器或重装前先备份。',
  about: '当前版本、检查更新。',
}

/**
 * 设置页左侧分组导航。id 必须来自 SETTINGS_TABS（类型层面约束），
 * 分组只改呈现顺序，不改路由与合法 tab 集合。
 */
export const SETTINGS_NAV_GROUPS: {
  label: string
  items: { id: SettingsTabId; icon: LucideIcon }[]
}[] = [
  {
    label: '账号调度',
    items: [
      { id: 'sticky', icon: Magnet },
      { id: 'pool', icon: Layers },
      { id: 'quota', icon: Gauge },
      { id: 'health', icon: Activity },
    ],
  },
  {
    label: '提醒与记录',
    items: [
      { id: 'notify', icon: BellRing },
      { id: 'logs', icon: ScrollText },
    ],
  },
  {
    label: '账号环境',
    items: [
      { id: 'init', icon: PackageCheck },
      { id: 'telemetry', icon: RadioTower },
      { id: 'socks5', icon: Network },
    ],
  },
  {
    label: '高级',
    items: [
      { id: 'protocol', icon: Fingerprint },
      { id: 'whitelist', icon: ListChecks },
    ],
  },
  {
    label: '系统',
    items: [
      { id: 'backup', icon: Archive },
      { id: 'about', icon: Info },
    ],
  },
]

export const SETTINGS_TAB_LABELS = Object.fromEntries(SETTINGS_TABS) as Record<
  SettingsTabId,
  string
>

export function settingsTabId(tab: string | undefined): SettingsTabId {
  return SETTINGS_TABS.some((item) => item[0] === tab)
    ? (tab as SettingsTabId)
    : 'sticky'
}
