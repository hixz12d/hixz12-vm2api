import type { ReactNode } from 'react'
import { Outlet } from '@tanstack/react-router'
import { getCookie } from '@/lib/cookies'
import { cn } from '@/lib/utils'
import { LayoutProvider } from '@/context/layout-provider'
import { SearchProvider } from '@/context/search-provider'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppHeader } from '@/components/layout/app-header'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { StarHint } from '@/components/layout/star-hint'
import type { NavLamps } from '@/components/layout/types'
import { SkipToMain } from '@/components/skip-to-main'

type AuthenticatedLayoutProps = {
  children?: ReactNode
  headerActions?: ReactNode
  /** 侧栏导航项上的状态灯，由路由层组合业务数据后传入。 */
  navLamps?: NavLamps
}

export function AuthenticatedLayout({
  children,
  headerActions,
  navLamps,
}: AuthenticatedLayoutProps) {
  const defaultOpen = getCookie('sidebar_state') !== 'false'
  return (
    <SearchProvider>
      <LayoutProvider>
        <SidebarProvider defaultOpen={defaultOpen}>
          <SkipToMain />
          <AppSidebar lamps={navLamps} />
          <SidebarInset
            className={cn(
              // Set content container, so we can use container queries
              '@container/content',

              // If layout is fixed, set the height
              // to 100svh to prevent overflow
              'has-data-[layout=fixed]:h-svh',

              // If layout is fixed and sidebar is inset,
              // set the height to 100svh - spacing (total margins) to prevent overflow
              'peer-data-[variant=inset]:has-data-[layout=fixed]:h-[calc(100svh-(var(--spacing)*4))]'
            )}
          >
            <AppHeader actions={headerActions} />
            {children ?? <Outlet />}
          </SidebarInset>
          <StarHint />
        </SidebarProvider>
      </LayoutProvider>
    </SearchProvider>
  )
}
