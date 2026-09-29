import { useAuthStore } from '@/stores/auth-store'
import { useLayout } from '@/context/layout-provider'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
import { AppTitle } from './app-title'
import { navGroupsFor, sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'
import type { NavLamps } from './types'

export function AppSidebar({ lamps }: { lamps?: NavLamps }) {
  const { collapsible, variant } = useLayout()
  const me = useAuthStore((s) => s.me)
  const userName = useAuthStore((s) => s.user) || me?.user || 'admin'
  const groups = navGroupsFor(me?.views)
  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader className='border-b border-brass-dim'>
        <AppTitle version={me?.version} />
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <NavGroup key={group.title} {...group} lamps={lamps} />
        ))}
      </SidebarContent>
      <SidebarFooter className='border-t border-brass-dim'>
        <NavUser
          user={{
            name: userName,
            email: me?.role || sidebarData.user.email,
            avatar: '',
          }}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
