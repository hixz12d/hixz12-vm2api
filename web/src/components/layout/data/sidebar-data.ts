import { VIEW_TITLES } from '@/config/nav'
import {
  Boxes,
  Cable,
  ChartColumn,
  Database,
  Download,
  Gauge,
  KeyRound,
  Layers,
  LayoutDashboard,
  MessageSquareText,
  ScrollText,
  Settings,
  ShieldAlert,
  Sparkles,
  UserCog,
  Users,
} from 'lucide-react'
import type { NavGroup, NavItem, SidebarData } from '../types'

// 监控组对应 claude-code-hub 的 仪表盘 / 使用记录 / 限额管理：
// 总览看集群健康，统计看趋势与排行，日志看逐条请求，用量看账号限额。
// 标题统一取 VIEW_TITLES（fork 文案），url 与权限 view 名保持不变。
const ALL_GROUPS: NavGroup[] = [
  {
    title: '监控',
    items: [
      { title: VIEW_TITLES.overview, url: '/overview', icon: LayoutDashboard },
      { title: VIEW_TITLES.statistics, url: '/statistics', icon: ChartColumn },
      { title: VIEW_TITLES.logs, url: '/logs', icon: ScrollText },
      { title: VIEW_TITLES.usage, url: '/usage', icon: Gauge },
    ],
  },
  {
    title: '资源',
    items: [
      { title: VIEW_TITLES.cluster, url: '/cluster', icon: Boxes },
      { title: VIEW_TITLES.vm, url: '/vm', icon: Users, lamp: 'accounts' },
      { title: VIEW_TITLES.import, url: '/import', icon: Download },
      { title: VIEW_TITLES.proxies, url: '/proxies', icon: Cable },
    ],
  },
  {
    title: '协议',
    items: [
      { title: VIEW_TITLES.models, url: '/models', icon: Sparkles },
      { title: VIEW_TITLES.risk, url: '/risk', icon: ShieldAlert },
      {
        title: VIEW_TITLES.system,
        url: '/system',
        icon: MessageSquareText,
      },
      { title: VIEW_TITLES.keys, url: '/keys', icon: KeyRound },
    ],
  },
  {
    title: '系统',
    items: [
      { title: VIEW_TITLES.settings, url: '/settings', icon: Settings },
      { title: VIEW_TITLES.users, url: '/users', icon: UserCog },
      { title: VIEW_TITLES.wrap, url: '/wrap', icon: Layers },
      { title: VIEW_TITLES.database, url: '/database', icon: Database },
    ],
  },
]

function itemView(item: NavItem): string {
  if (item.url) return String(item.url).replace(/^\//, '')
  return item.title
}

export function navGroupsFor(views?: string[] | null): NavGroup[] {
  if (views == null) return ALL_GROUPS
  const allow = new Set(views.map((v) => String(v).trim()).filter(Boolean))
  if (allow.size === 0) return []
  return ALL_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      const key = itemView(item)
      return allow.has(key) || allow.has(`/${key}`)
    }),
  })).filter((group) => group.items.length > 0)
}

export const sidebarData: SidebarData = {
  user: {
    name: 'admin',
    email: 'admin',
    avatar: '',
  },
  teams: [
    {
      name: 'vm2api',
      logo: LayoutDashboard,
      plan: 'Console API',
    },
  ],
  navGroups: ALL_GROUPS,
}
