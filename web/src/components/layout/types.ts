import { type LinkProps } from '@tanstack/react-router'

type User = {
  name: string
  email: string
  avatar: string
}

type Team = {
  name: string
  logo: React.ElementType
  plan: string
}

/** 侧栏状态灯的编号；灯本身由路由层按编号传入（布局不依赖业务模块）。 */
type NavLampId = 'accounts'
type NavLamps = Partial<Record<NavLampId, React.ReactNode>>

type BaseNavItem = {
  title: string
  badge?: string
  icon?: React.ElementType
  /** 在导航项上挂一盏状态灯（只在需要处理时亮）。 */
  lamp?: NavLampId
}

type NavLink = BaseNavItem & {
  url: LinkProps['to'] | (string & {})
  items?: never
}

type NavCollapsible = BaseNavItem & {
  items: (BaseNavItem & { url: LinkProps['to'] | (string & {}) })[]
  url?: never
}

type NavItem = NavCollapsible | NavLink

type NavGroup = {
  title: string
  items: NavItem[]
  /** 默认收起（当前页在组内时自动展开），用于很少碰的「高级」组。 */
  folded?: boolean
}

type SidebarData = {
  user: User
  teams: Team[]
  navGroups: NavGroup[]
}

export type {
  SidebarData,
  NavGroup,
  NavItem,
  NavCollapsible,
  NavLink,
  NavLampId,
  NavLamps,
}
