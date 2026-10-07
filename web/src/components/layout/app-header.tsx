import type { ReactNode } from 'react'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

type AppHeaderProps = {
  actions?: ReactNode
}

/** 顶栏：搜索 + 本页操作 + 外观。登录用户菜单只在侧栏底部保留一处。 */
export function AppHeader({ actions }: AppHeaderProps) {
  return (
    <Header
      fixed
      className='h-auto min-h-16 xl:h-16 [&>div]:flex-wrap xl:[&>div]:flex-nowrap'
    >
      <Search placeholder='搜索页面…' />
      <div className='ms-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5 [&>div]:flex-wrap'>
        {actions}
        <ConfigDrawer />
        <ThemeSwitch />
      </div>
    </Header>
  )
}
