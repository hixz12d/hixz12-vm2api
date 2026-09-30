import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { VIEW_TITLES } from '@/config/nav'
import type { Vm } from '@/types/panel-vm'
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Download,
  LayoutGrid,
  List,
  Rows3,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { fleetCounts, type FleetGroup } from '@/lib/vm-status'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SlotIdentity } from '@/components/platform-chip'
import { QueryGate } from '@/components/query-gate'
import { meQueryOptions } from '@/features/auth/queries'
import { usageQueryOptions } from '@/features/overview/queries'
import { AccountLines } from '@/features/vm/account-lines'
import { clearVmRestriction } from '@/features/vm/clear-restriction'
import { CreateVmDialog } from '@/features/vm/create-vm-dialog'
import { VmListSkeleton } from '@/features/vm/list-skeleton'
import { vmsListQueryOptions } from '@/features/vm/queries'
import { VmActionsProvider } from '@/features/vm/vm-actions-provider'
import {
  filterVms,
  KindFilterChips,
  sortVms,
  VmCards,
  VmTable,
  type VmKindFilter,
  type VmSortKey,
} from '@/features/vm/vm-table'

const SORT_CHIPS = [
  ['status', '按状态'],
  ['name', '按名称'],
  ['remain', '按 5 小时剩余'],
  ['today', '按今天花费'],
  ['cache', '按缓存命中'],
] as const

/** 状态筛选：白话名称 + 一句说明。顺序即「能用 → 不能用」。 */
const STATUS_FILTERS: { key: FleetGroup; label: string; hint: string }[] = [
  { key: 'pool', label: '正在接请求', hint: '凭证有效、调度开着的账号' },
  {
    key: 'restricted',
    label: '暂时受限',
    hint: '额度用完或在冷却，到点自动恢复',
  },
  { key: 'off', label: '已暂停', hint: '你手动关了「接请求」的账号' },
  { key: 'none', label: '没有凭证', hint: '运行环境建好了，还没导入凭证' },
  { key: 'bad', label: '凭证失效', hint: '过期或无效，需要重新导入' },
  { key: 'revoke', label: '已被吊销', hint: '官方吊销了授权，只能换新凭证' },
]

type ViewMode = 'lines' | 'table' | 'grid'
const VIEW_KEY = 'vm_list_view'

export function VmListPage() {
  const me = useQuery(meQueryOptions())
  const vmsQ = useQuery(vmsListQueryOptions(5000))
  const usage = useQuery({
    ...usageQueryOptions(5000),
    enabled: me.data?.role !== 'user',
  })
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [kind, setKind] = useState<VmKindFilter>('all')
  const [view, setViewState] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(VIEW_KEY)
    return saved === 'table' || saved === 'grid' ? saved : 'lines'
  })
  const setView = (next: ViewMode) => {
    setViewState(next)
    localStorage.setItem(VIEW_KEY, next)
  }
  const [sort, setSort] = useState<VmSortKey>('status')
  const [dir, setDir] = useState<'asc' | 'desc'>('asc')
  const [resetTarget, setResetTarget] = useState<Vm | null>(null)
  const [resetInput, setResetInput] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Vm | null>(null)
  const [deleteInput, setDeleteInput] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const resetVm = useMutation({
    mutationFn: (id: string) =>
      api(`/api/panel/vms/${encodeURIComponent(id)}/reset`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: async () => {
      toast.success('运行环境已清空重建，请重新导入凭证')
      setResetTarget(null)
      setResetInput('')
      await qc.invalidateQueries({ queryKey: vmsListQueryOptions().queryKey })
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const deleteVm = useMutation({
    mutationFn: (id: string) =>
      api(`/api/panel/vms/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('账号已删除')
      setDeleteTarget(null)
      setDeleteInput('')
      await qc.invalidateQueries({ queryKey: vmsListQueryOptions().queryKey })
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const clearCooldown = useMutation({
    mutationFn: (vm: Vm) => clearVmRestriction(vm),
    onSuccess: async () => {
      toast.success('已解除冷却，账号恢复接请求')
      await qc.invalidateQueries({ queryKey: vmsListQueryOptions().queryKey })
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const vms: Vm[] = vmsQ.data?.items || []
  const accounts = usage.data?.accounts
  const canCreate =
    me.data?.role === 'admin' ||
    (me.data?.role === 'user' && (me.data.vm_create_quota || 0) > 0)
  const scoped = filterVms(vms, '', 'all', kind)
  const counts = fleetCounts(scoped)
  const list = sortVms(filterVms(vms, q, filter, kind), sort, dir, accounts)

  return (
    <PageHeader
      title={VIEW_TITLES.vm}
      fluid
      extra={
        <div className='flex items-center gap-2'>
          {canCreate ? (
            <Button
              variant='outline'
              size='sm'
              onClick={() => setCreateOpen(true)}
              title='只建运行环境，凭证以后再导入'
            >
              新建空账号
            </Button>
          ) : null}
          <Button size='sm' asChild>
            <Link to='/import'>
              <Download />
              导入账号
            </Link>
          </Button>
        </div>
      }
    >
      <QueryGate
        loading={vmsQ.isLoading}
        error={vmsQ.error}
        skeleton={<VmListSkeleton />}
      >
        <div
          role='group'
          aria-label='按状态筛选'
          className='mb-3 flex flex-wrap items-center gap-1.5'
        >
          <FilterChip
            active={filter === 'all'}
            onClick={() => setFilter('all')}
            label='全部'
            count={counts.all}
          />
          {STATUS_FILTERS.filter(
            (f) => counts[f.key] > 0 || filter === f.key
          ).map((f) => (
            <FilterChip
              key={f.key}
              active={filter === f.key}
              onClick={() => setFilter(filter === f.key ? 'all' : f.key)}
              label={f.label}
              hint={f.hint}
              count={counts[f.key]}
              tone={
                f.key === 'bad' || f.key === 'revoke'
                  ? 'red'
                  : f.key === 'restricted'
                    ? 'amber'
                    : null
              }
            />
          ))}
        </div>
        <div className='mb-4 flex flex-wrap items-center gap-2'>
          <KindFilterChips vms={vms} kind={kind} onChange={setKind} />
          <Separator orientation='vertical' className='mx-1 h-5' />
          <div className='relative'>
            <Search className='pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground' />
            <Input
              className='h-8 w-64 ps-8'
              type='search'
              placeholder='搜索名称、邮箱、出口代理'
              aria-label='搜索账号'
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className='ms-auto flex flex-wrap items-center gap-2'>
            <Select
              value={sort}
              onValueChange={(next) => {
                setSort(next as VmSortKey)
                setDir(next === 'name' ? 'asc' : 'desc')
              }}
            >
              <SelectTrigger size='sm' className='w-36' aria-label='排序方式'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align='end'>
                {SORT_CHIPS.map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size='sm'
              variant='outline'
              title={dir === 'asc' ? '升序' : '降序'}
              aria-label={
                dir === 'asc' ? '当前升序，切到降序' : '当前降序，切到升序'
              }
              onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')}
            >
              {dir === 'asc' ? <ArrowUpNarrowWide /> : <ArrowDownWideNarrow />}
            </Button>
            <Separator orientation='vertical' className='mx-1 h-5' />
            <div
              role='group'
              aria-label='显示方式'
              className='flex items-center rounded-md border border-input p-0.5'
            >
              {(
                [
                  ['lines', Rows3, '简洁列表'],
                  ['table', List, '详细表格（全部字段）'],
                  ['grid', LayoutGrid, '卡片'],
                ] as const
              ).map(([key, Icon, label]) => (
                <Button
                  key={key}
                  size='icon'
                  variant='ghost'
                  className={cn(
                    'size-7',
                    view === key && 'bg-accent text-accent-foreground'
                  )}
                  aria-pressed={view === key}
                  aria-label={label}
                  title={label}
                  onClick={() => setView(key)}
                >
                  <Icon className='size-4' />
                </Button>
              ))}
            </div>
          </div>
        </div>
        <VmActionsProvider
          accounts={accounts}
          onReset={(vm) => {
            setResetInput('')
            setResetTarget(vm)
          }}
          onDelete={(vm) => {
            setDeleteInput('')
            setDeleteTarget(vm)
          }}
        >
          {list.length ? (
            view === 'lines' ? (
              <AccountLines
                vms={list}
                accounts={accounts}
                onClearCooldown={(vm) => clearCooldown.mutate(vm)}
                onReset={(vm) => {
                  setResetInput('')
                  setResetTarget(vm)
                }}
                onDelete={(vm) => {
                  setDeleteInput('')
                  setDeleteTarget(vm)
                }}
              />
            ) : view === 'grid' ? (
              <VmCards vms={list} accounts={accounts} />
            ) : (
              <VmTable vms={list} accounts={accounts} />
            )
          ) : (
            <EmptyState
              reason={
                vms.length
                  ? '没有符合当前筛选或搜索的账号。'
                  : '还没有账号。点右上角「导入账号」开始。'
              }
              actionLabel={vms.length ? '清除筛选' : undefined}
              onAction={() => {
                setFilter('all')
                setQ('')
                setKind('all')
              }}
            />
          )}
        </VmActionsProvider>
      </QueryGate>
      <ConfirmDialog
        open={!!resetTarget}
        onOpenChange={(open) => {
          if (!open) {
            setResetTarget(null)
            setResetInput('')
          }
        }}
        title='清空重建运行环境？'
        desc={
          resetTarget ? (
            <>
              <p className='flex min-w-0 items-center gap-1.5'>
                <SlotIdentity vm={resetTarget} compact />
                <span className='shrink-0 text-muted-foreground'>
                  · {resetTarget.id}
                </span>
              </p>
              <div className='mt-2 grid gap-1.5 text-sm'>
                <p className='text-destructive'>
                  会清空：凭证、设备特征、用量统计、运行环境里的所有文件。重建后需要重新导入凭证，清掉的内容无法找回。
                </p>
                <p>会保留：账号名称、出口代理、时区和其他设置。</p>
                <p className='text-muted-foreground'>
                  输入 <b className='text-foreground'>{resetTarget.id}</b>{' '}
                  确认。
                </p>
              </div>
            </>
          ) : (
            ''
          )
        }
        confirmText='清空并重建'
        cancelBtnText='取消'
        destructive
        disabled={resetInput.trim() !== resetTarget?.id}
        isLoading={resetVm.isPending}
        handleConfirm={() => {
          if (resetTarget) resetVm.mutate(resetTarget.id)
        }}
      >
        <Input
          autoFocus
          autoComplete='off'
          spellCheck={false}
          placeholder={resetTarget?.id}
          aria-label='确认 ID'
          value={resetInput}
          onChange={(e) => setResetInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && resetInput.trim() === resetTarget?.id) {
              resetVm.mutate(resetTarget.id)
            }
          }}
        />
      </ConfirmDialog>
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
            setDeleteInput('')
          }
        }}
        title='删除这个账号？'
        desc={
          deleteTarget ? (
            <>
              <p className='flex min-w-0 items-center gap-1.5'>
                <SlotIdentity vm={deleteTarget} compact />
                <span className='shrink-0 text-muted-foreground'>
                  · {deleteTarget.id}
                </span>
              </p>
              <div className='mt-2 grid gap-1.5 text-sm'>
                <p className='text-destructive'>
                  无法恢复：运行环境、凭证、出口代理绑定会一起删除，它所在的分组里也会少掉它。
                </p>
                <p className='text-muted-foreground'>
                  如果它是当前正在调度的账号，要先在详情页把调度切到别的账号。输入{' '}
                  <b className='text-foreground'>{deleteTarget.id}</b> 确认。
                </p>
              </div>
            </>
          ) : (
            ''
          )
        }
        confirmText='删除账号'
        cancelBtnText='取消'
        destructive
        disabled={deleteInput.trim() !== deleteTarget?.id}
        isLoading={deleteVm.isPending}
        handleConfirm={() => {
          if (deleteTarget) deleteVm.mutate(deleteTarget.id)
        }}
      >
        <Input
          autoFocus
          autoComplete='off'
          spellCheck={false}
          placeholder={deleteTarget?.id}
          aria-label='确认 ID'
          value={deleteInput}
          onChange={(e) => setDeleteInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && deleteInput.trim() === deleteTarget?.id) {
              deleteVm.mutate(deleteTarget.id)
            }
          }}
        />
      </ConfirmDialog>
      <CreateVmDialog open={createOpen} onOpenChange={setCreateOpen} />
    </PageHeader>
  )
}

function FilterChip({
  active,
  onClick,
  label,
  hint,
  count,
  tone,
}: {
  active: boolean
  onClick: () => void
  label: string
  hint?: string
  count: number
  tone?: 'red' | 'amber' | null
}) {
  return (
    <button
      type='button'
      aria-pressed={active}
      onClick={onClick}
      title={hint}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-transparent bg-primary text-primary-foreground'
          : 'border-input text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
    >
      {tone && !active ? (
        <span
          aria-hidden='true'
          className={cn(
            'size-1.5 rounded-full',
            tone === 'red' ? 'bg-lamp-red' : 'bg-lamp-amber'
          )}
        />
      ) : null}
      {label}
      <span className='font-semibold tabular-nums'>{count}</span>
    </button>
  )
}
