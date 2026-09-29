import { VIEW_TITLES } from '@/config/nav'
import {
  Activity,
  Boxes,
  Cable,
  Database,
  Download,
  Gauge,
  KeyRound,
  Layers,
  LayoutDashboard,
  ScrollText,
  Settings,
  Shield,
  Sparkles,
  Users,
} from 'lucide-react'
import type { NavGroup, NavItem, SidebarData } from '../types'

/**
 * 侧栏按「多常用」分组，不按实现分：
 * 常用 = 三件日常事（看状态、管 Key 和分组、导入 / 管理账号）；
 * 高级 = 很少碰的底层页，功能全保留，只是不和常用项混在一起。
 * url 与权限 view 名保持不变。
 */
const ALL_GROUPS: NavGroup[] = [
  {
    title: '常用',
    items: [
      { title: VIEW_TITLES.overview, url: '/overview', icon: LayoutDashboard },
      { title: VIEW_TITLES.vm, url: '/vm', icon: Users, lamp: 'accounts' },
      { title: VIEW_TITLES.keys, url: '/keys', icon: KeyRound },
      { title: VIEW_TITLES.import, url: '/import', icon: Download },
      { title: VIEW_TITLES.proxies, url: '/proxies', icon: Cable },
    ],
  },
  {
    title: '记录与设置',
    items: [
      { title: VIEW_TITLES.usage, url: '/usage', icon: Gauge },
      { title: VIEW_TITLES.logs, url: '/logs', icon: ScrollText },
      { title: VIEW_TITLES.settings, url: '/settings', icon: Settings },
    ],
  },
  {
    title: '高级',
    folded: true,
    items: [
      { title: VIEW_TITLES.models, url: '/models', icon: Sparkles },
      { title: VIEW_TITLES.protocol, url: '/protocol', icon: Shield },
      { title: VIEW_TITLES.wrap, url: '/wrap', icon: Layers },
      { title: VIEW_TITLES.loadtest, url: '/loadtest', icon: Activity },
      { title: VIEW_TITLES.database, url: '/database', icon: Database },
      { title: VIEW_TITLES.cluster, url: '/cluster', icon: Boxes },
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
