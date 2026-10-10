import { Link } from '@tanstack/react-router'
import { DOCS_URL, REPO_URL } from '@/config/repo'
import { ArrowUpRight, BookOpen, Menu, X } from 'lucide-react'
import { IconGithub } from '@/assets/brand-icons'
import { Logo } from '@/assets/logo'
import { cn } from '@/lib/utils'
import {
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { Button } from '../ui/button'

const CHIP_CLASS =
  'inline-flex h-8 min-w-0 items-center gap-1.5 rounded-lg border border-sidebar-foreground/15 bg-sidebar/70 px-2.5 text-[13px] font-medium text-sidebar-foreground shadow-xs outline-hidden transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-sidebar-ring'

const CHIP_LINK_CLASS =
  'cursor-pointer hover:border-primary/45 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'

// 版本号单独占一行且不截断：发布号可能带预发布/构建后缀，截断会丢失关键信息。
const VERSION_CHIP_CLASS = 'h-auto min-h-10 gap-2 py-1.5 text-base'

export function AppTitle({ version }: { version?: string }) {
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarMenu>
      <SidebarMenuItem className='py-1 group-data-[collapsible=icon]:p-0'>
        <div className='flex items-center gap-2'>
          <Link
            to='/overview'
            onClick={() => setOpenMobile(false)}
            aria-label='vm2api 概览'
            className='flex min-w-0 flex-1 items-center gap-2 rounded-md outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring'
          >
            <Logo aria-hidden className='size-5 shrink-0 text-primary' />
            <span className='grid min-w-0 leading-tight group-data-[collapsible=icon]:hidden'>
              <span className='truncate text-[15px] font-bold tracking-tight dark:text-ivory'>
                vm2api
              </span>
              <span className='truncate text-xs text-sidebar-foreground/60'>
                管理台
              </span>
            </span>
          </Link>
          <ToggleSidebar className='group-data-[collapsible=icon]:hidden' />
        </div>
        <div className='mt-2.5 grid gap-1.5 group-data-[collapsible=icon]:hidden'>
          <VersionChip version={version?.replace(/^v/i, '')} />
          <div className='flex gap-1.5'>
            <a
              href={REPO_URL}
              target='_blank'
              rel='noreferrer'
              title='github.com/dofastted/vm2api'
              className={cn(CHIP_CLASS, CHIP_LINK_CLASS)}
            >
              <IconGithub aria-hidden className='size-4 shrink-0' />
              GitHub
              <ArrowUpRight
                aria-hidden
                className='size-3.5 shrink-0 opacity-60'
              />
            </a>
            <a
              href={DOCS_URL}
              target='_blank'
              rel='noreferrer'
              title='项目入门'
              className={cn(CHIP_CLASS, CHIP_LINK_CLASS)}
            >
              <BookOpen aria-hidden className='size-4 shrink-0' />
              文档
              <ArrowUpRight
                aria-hidden
                className='size-3.5 shrink-0 opacity-60'
              />
            </a>
          </div>
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function VersionChip({ version }: { version?: string }) {
  if (!version) {
    return (
      <span className={cn(CHIP_CLASS, VERSION_CHIP_CLASS)}>
        <span className='size-2 shrink-0 rounded-full bg-sidebar-foreground/30' />
        <span className='font-mono text-sidebar-foreground/60'>版本 —</span>
      </span>
    )
  }
  return (
    <a
      href={`${REPO_URL}/releases/tag/v${version}`}
      target='_blank'
      rel='noreferrer'
      title={`v${version} 发布说明`}
      className={cn(CHIP_CLASS, CHIP_LINK_CLASS, VERSION_CHIP_CLASS)}
    >
      <span className='size-2 shrink-0 rounded-full bg-primary' />
      <span className='font-mono font-semibold break-all tabular-nums'>
        v{version}
      </span>
      <ArrowUpRight
        aria-hidden
        className='ms-auto size-4 shrink-0 opacity-60'
      />
    </a>
  )
}

function ToggleSidebar({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar()
  return (
    <Button
      data-sidebar='trigger'
      data-slot='sidebar-trigger'
      variant='ghost'
      size='icon'
      className={cn(
        'aspect-square size-8 shrink-0 cursor-pointer max-md:scale-125',
        className
      )}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <X className='md:hidden' />
      <Menu className='max-md:hidden' />
      <span className='sr-only'>切换侧栏</span>
    </Button>
  )
}
