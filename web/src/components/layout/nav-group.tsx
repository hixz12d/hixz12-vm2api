import { type ReactNode } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { Badge } from '../ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import {
  type NavCollapsible,
  type NavItem,
  type NavLink,
  type NavLamps,
  type NavGroup as NavGroupProps,
} from './types'

/**
 * 分组标签：小号字 + 一条黄铜发丝线延伸到右边，像面板上的分区刻线。
 */
const GROUP_LABEL_CLASS =
  'gap-2 text-[11px] font-semibold tracking-[0.08em] text-sidebar-foreground/60 after:h-px after:flex-1 after:bg-brass-dim'

export function NavGroup({
  title,
  items,
  folded,
  lamps,
}: NavGroupProps & { lamps?: NavLamps }) {
  const { state, isMobile } = useSidebar()
  const href = useLocation({ select: (location) => location.href })
  const iconRail = state === 'collapsed' && !isMobile

  const menu = (
    <SidebarMenu>
      {items.map((item) => {
        const key = `${item.title}-${item.url}`

        if (!item.items)
          return (
            <SidebarMenuLink
              key={key}
              item={item}
              href={href}
              lamp={item.lamp ? lamps?.[item.lamp] : null}
            />
          )

        if (iconRail)
          return (
            <SidebarMenuCollapsedDropdown key={key} item={item} href={href} />
          )

        return <SidebarMenuCollapsible key={key} item={item} href={href} />
      })}
    </SidebarMenu>
  )

  // 普通分组，或侧栏已折叠成图标栏（此时没有标签可点，直接全部显示）
  if (!folded || iconRail)
    return (
      <SidebarGroup>
        <SidebarGroupLabel className={GROUP_LABEL_CLASS}>
          {title}
        </SidebarGroupLabel>
        {menu}
      </SidebarGroup>
    )

  // 很少用的分组：默认收起，当前页在组内时自动展开
  const containsCurrent = items.some((item) => checkIsActive(href, item, true))
  return (
    <Collapsible
      defaultOpen={containsCurrent}
      className='group/folded'
      key={containsCurrent ? 'open' : 'closed'}
    >
      <SidebarGroup>
        <SidebarGroupLabel asChild className={GROUP_LABEL_CLASS}>
          <CollapsibleTrigger className='w-full cursor-pointer hover:text-sidebar-foreground'>
            <span>{title}</span>
            <span className='order-last text-[10px] font-normal tracking-normal text-sidebar-foreground/45 group-data-[state=open]/folded:hidden'>
              {items.length} 项
            </span>
            <ChevronRight className='order-last size-3.5! transition-transform duration-200 group-data-[state=open]/folded:rotate-90' />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent className='CollapsibleContent'>
          {menu}
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}

function NavBadge({ children }: { children: ReactNode }) {
  return <Badge className='rounded-full px-1 py-0 text-xs'>{children}</Badge>
}

/**
 * 当前页 = 一条标签条，和其他项一眼区分开。
 * 深色：象牙条 + 深色字；亮色：底色本身就是象牙，改用胶木条 + 象牙字。
 */
const ACTIVE_STRIP_CLASS =
  'data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:hover:bg-primary data-[active=true]:hover:text-primary-foreground data-[active=true]:shadow-[0_1px_2px_oklch(0_0_0/0.35)] dark:data-[active=true]:bg-ivory dark:data-[active=true]:text-ivory-ink dark:data-[active=true]:hover:bg-ivory dark:data-[active=true]:hover:text-ivory-ink'

function SidebarMenuLink({
  item,
  href,
  lamp,
}: {
  item: NavLink
  href: string
  lamp?: React.ReactNode
}) {
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={checkIsActive(href, item)}
        tooltip={item.title}
        className={ACTIVE_STRIP_CLASS}
      >
        <Link to={item.url} onClick={() => setOpenMobile(false)}>
          {item.icon && <item.icon />}
          <span className='truncate'>{item.title}</span>
          {item.badge && <NavBadge>{item.badge}</NavBadge>}
          {lamp}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function SidebarMenuCollapsible({
  item,
  href,
}: {
  item: NavCollapsible
  href: string
}) {
  const { setOpenMobile } = useSidebar()
  return (
    <Collapsible
      asChild
      defaultOpen={checkIsActive(href, item, true)}
      className='group/collapsible'
    >
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={item.title}>
            {item.icon && <item.icon />}
            <span>{item.title}</span>
            {item.badge && <NavBadge>{item.badge}</NavBadge>}
            <ChevronRight className='ms-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 rtl:rotate-180' />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent className='CollapsibleContent'>
          <SidebarMenuSub>
            {item.items.map((subItem) => (
              <SidebarMenuSubItem key={subItem.title}>
                <SidebarMenuSubButton
                  asChild
                  isActive={checkIsActive(href, subItem)}
                >
                  <Link to={subItem.url} onClick={() => setOpenMobile(false)}>
                    {subItem.icon && <subItem.icon />}
                    <span>{subItem.title}</span>
                    {subItem.badge && <NavBadge>{subItem.badge}</NavBadge>}
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

function SidebarMenuCollapsedDropdown({
  item,
  href,
}: {
  item: NavCollapsible
  href: string
}) {
  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            tooltip={item.title}
            isActive={checkIsActive(href, item)}
          >
            {item.icon && <item.icon />}
            <span>{item.title}</span>
            {item.badge && <NavBadge>{item.badge}</NavBadge>}
            <ChevronRight className='ms-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90' />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side='right' align='start' sideOffset={4}>
          <DropdownMenuLabel>
            {item.title} {item.badge ? `(${item.badge})` : ''}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {item.items.map((sub) => (
            <DropdownMenuItem key={`${sub.title}-${sub.url}`} asChild>
              <Link
                to={sub.url}
                className={`${checkIsActive(href, sub) ? 'bg-secondary' : ''}`}
              >
                {sub.icon && <sub.icon />}
                <span className='max-w-52 text-wrap'>{sub.title}</span>
                {sub.badge && (
                  <span className='ms-auto text-xs'>{sub.badge}</span>
                )}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

function checkIsActive(href: string, item: NavItem, mainNav = false) {
  return (
    href === item.url || // /endpint?search=param
    href.split('?')[0] === item.url || // endpoint
    !!item?.items?.filter((i) => i.url === href).length || // if child nav is active
    (mainNav &&
      href.split('/')[1] !== '' &&
      href.split('/')[1] === item?.url?.split('/')[1])
  )
}
