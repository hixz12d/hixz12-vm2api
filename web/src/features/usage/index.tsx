import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { VIEW_TITLES } from '@/config/nav'
import type { UsageAccountRow } from '@/types/panel-usage'
import type { Vm } from '@/types/panel-vm'
import { credTypeFromMode } from '@/lib/cred-type'
import { concInfo, defaultConc, fableState, rpmInfo } from '@/lib/fable-status'
import { fmtNum, fmtUsd, pct } from '@/lib/format'
import { cn } from '@/lib/utils'
import { indexVms } from '@/lib/vm-kind'
import { cacheHitPct, isLeftoverUsageAccount } from '@/lib/vm-usage'
import { Progress } from '@/components/ui/progress'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { CardGridSkeleton, TableSkeleton } from '@/components/page-skeletons'
import { CredLaneChip, SlotIdentity } from '@/components/platform-chip'
import { QueryGate } from '@/components/query-gate'
import { StatusMark } from '@/components/status-mark'
import { Lamp } from '@/components/switchboard-parts'
import { BillingStrip } from '@/features/overview/billing-strip'
import {
  dashboardQueryOptions,
  usageQueryOptions,
} from '@/features/overview/queries'

type SortKey = 'name' | 'u5' | 'u7' | 'conc' | 'req' | 'cost' | 'st'

function nearLimitOf(row: UsageAccountRow): boolean {
  return Boolean(row.near_limit) || pct(row.utilization_5h) >= 95
}

function sortAccounts(
  rows: UsageAccountRow[],
  key: SortKey,
  dir: 'asc' | 'desc'
): UsageAccountRow[] {
  const sign = dir === 'asc' ? 1 : -1
  const val = (row: UsageAccountRow): number | string => {
    switch (key) {
      case 'u5':
        return pct(row.utilization_5h)
      case 'u7':
        return pct(row.utilization_7d)
      case 'conc':
        return Number(row.inflight || 0)
      case 'req':
        return Number(row.requests || 0)
      case 'cost':
        return Number(row.total_cost || 0)
      case 'st':
        return nearLimitOf(row) ? 1 : 0
      default:
        return String(row.email || row.account_id || '').toLowerCase()
    }
  }
  return rows.slice().sort((a, b) => {
    const av = val(a)
    const bv = val(b)
    if (typeof av === 'string' || typeof bv === 'string') {
      return sign * String(av).localeCompare(String(bv))
    }
    return sign * (av - bv)
  })
}

function SortHead({
  label,
  col,
  current,
  dir,
  onToggle,
  className,
}: {
  label: string
  col: SortKey
  current: SortKey
  dir: 'asc' | 'desc'
  onToggle: (col: SortKey) => void
  className?: string
}) {
  const on = current === col
  return (
    <button
      type='button'
      className={cn('truncate text-left', on && 'text-foreground', className)}
      aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={() => onToggle(col)}
    >
      {label}
      {on ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  )
}

function Meter({ value }: { value: number }) {
  const tone =
    value >= 100
      ? 'bg-[color:var(--status-bad)]'
      : value >= 95
        ? 'bg-[color:var(--status-warn)]'
        : value >= 85
          ? 'bg-[color:var(--status-caution)]'
          : 'bg-[color:var(--status-ok)]'
  return (
    <div className='w-24 space-y-0.5'>
      <div className='text-right text-[11px] text-muted-foreground tabular-nums'>
        {value.toFixed(1)}%
      </div>
      <Progress
        value={Math.min(100, value)}
        className='h-1'
        indicatorClassName={tone}
      />
    </div>
  )
}

function FableCell({ row }: { row: UsageAccountRow }) {
  const state = fableState(row, String(row.account_tier || ''))
  if (state.usedPct != null) return <Meter value={state.usedPct} />
  return <StatusMark tone={state.tone} />
}

function AccountRow({ row, vm }: { row: UsageAccountRow; vm?: Vm }) {
  const p5 = pct(row.utilization_5h)
  const p7 = pct(row.utilization_7d)
  const nearL = nearLimitOf(row)
  const conc = concInfo(row, undefined, 4)
  const rpm = rpmInfo(row)
  return (
    <div
      className={cn(
        'flex items-center border-b border-border/40 text-sm',
        nearL && 'bg-destructive/10'
      )}
    >
      <div className='min-w-[160px] flex-[1.6] truncate py-2 pl-3'>
        <div className='truncate'>
          <SlotIdentity vm={vm} vmId={row.vm_id} email={row.email} />
        </div>
        <div className='flex items-center gap-1.5 truncate text-xs text-muted-foreground'>
          {row.vm_id ? (
            <Link
              to='/vm/$id'
              params={{ id: String(row.vm_id) }}
              className='hover:underline'
            >
              {row.vm_id}
            </Link>
          ) : (
            '—'
          )}
          {row.credential_mode ? (
            <CredLaneChip type={credTypeFromMode(row.credential_mode)} />
          ) : null}
        </div>
      </div>
      <div className='min-w-[100px] flex-[0.9] px-1.5'>
        <Meter value={p5} />
      </div>
      <div className='min-w-[100px] flex-[0.9] px-1.5'>
        <Meter value={p7} />
      </div>
      <div className='min-w-[90px] flex-[0.8] px-1.5'>
        <FableCell row={row} />
      </div>
      <div className='min-w-[110px] flex-[0.9] px-1.5 font-mono text-xs'>
        <div>
          {conc.inf}/
          {Number(row.max_concurrency) ||
            defaultConc(undefined, String(row.account_tier || ''))}
        </div>
        {rpm ? (
          <div className='text-muted-foreground'>
            RPM {rpm.n}/{rpm.max}
          </div>
        ) : null}
      </div>
      <div className='min-w-[80px] flex-[0.7] px-1.5 text-right font-mono text-xs tabular-nums'>
        {fmtNum(row.requests || 0)}
      </div>
      <div
        className='min-w-[110px] flex-[1] px-1.5 text-right font-mono text-xs'
        title={`5 小时 ${fmtUsd(row.window_5h_cost || 0)} · 今天 ${fmtUsd(row.today_cost || 0)} · 按官方价格累计`}
      >
        <div className='tabular-nums'>{fmtUsd(row.window_5h_cost || 0)}</div>
        <div className='text-muted-foreground tabular-nums'>
          {fmtUsd(row.today_cost || 0)} / {fmtUsd(row.total_cost || 0)}
        </div>
      </div>
      <div className='min-w-[80px] flex-[0.7] pr-3 text-right'>
        {nearL ? (
          <StatusMark tone={{ key: 'warn', cls: 'warn', text: '近限额' }} />
        ) : (
          <StatusMark tone={{ key: 'ok', cls: 'ok', text: '正常' }} />
        )}
      </div>
    </div>
  )
}

export function UsagePage() {
  const usage = useQuery(usageQueryOptions(5000))
  const dash = useQuery(dashboardQueryOptions(5000))
  const [sortKey, setSortKey] = useState<SortKey>('u5')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const rawAccounts = usage.data?.accounts || []
  const totals = (usage.data?.totals || {}) as Record<string, unknown>
  const accounts = useMemo(
    () => rawAccounts.filter((a) => !isLeftoverUsageAccount(a)),
    [rawAccounts]
  )
  const near = accounts.filter(nearLimitOf).length
  const peak5 = pct(totals.peak_5h ?? totals.peak_5h_utilization)
  const peak7 = pct(totals.peak_7d ?? totals.peak_7d_utilization)
  const cacheHit =
    totals.cache_hit_rate != null
      ? Number(totals.cache_hit_rate) * 100
      : cacheHitPct(
          totals.tokens_in,
          totals.cache_read_tokens,
          totals.cache_creation_tokens
        )
  const rows = sortAccounts(accounts, sortKey, sortDir)
  const vmIndex = indexVms(dash.data?.vms)

  function toggleSort(next: SortKey) {
    if (sortKey === next) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(next)
    setSortDir('desc')
  }

  return (
    <PageHeader title={VIEW_TITLES.usage}>
      <QueryGate
        loading={usage.isLoading}
        error={
          usage.error ||
          (usage.data?.error ? new Error(usage.data.error) : null)
        }
        skeleton={
          <div>
            <CardGridSkeleton
              cards={4}
              className='mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4'
            />
            <TableSkeleton rows={8} columns={6} />
          </div>
        }
      >
        <section
          aria-live='polite'
          className='mb-4 rounded-md border border-brass-dim bg-card px-4 py-3'
        >
          <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
            <Lamp tone={near ? 'amber' : null} className='size-3' />
            <p className='text-[15px] font-semibold tracking-tight'>
              {near ? `${near} 个账号的额度快用完了` : '所有账号额度都还充足'}
            </p>
          </div>
          <dl className='mt-2 grid gap-x-6 gap-y-1 text-xs text-muted-foreground tabular-nums sm:grid-cols-4'>
            <div>
              <dt className='inline'>账号数 </dt>
              <dd className='inline font-semibold text-foreground'>
                {String(totals.account_count ?? accounts.length)}
              </dd>
            </div>
            <div>
              <dt className='inline'>5 小时额度用得最多的 </dt>
              <dd
                className={cn(
                  'inline font-semibold text-foreground',
                  peak5 >= 85 && 'text-lamp-amber'
                )}
              >
                {peak5.toFixed(0)}%
              </dd>
            </div>
            <div>
              <dt className='inline'>7 天额度用得最多的 </dt>
              <dd
                className={cn(
                  'inline font-semibold text-foreground',
                  peak7 >= 85 && 'text-lamp-amber'
                )}
              >
                {peak7.toFixed(0)}%
              </dd>
            </div>
            <div>
              <dt className='inline' title='重复内容命中缓存的比例，越高越省钱'>
                缓存命中
              </dt>
              <dd className='inline font-semibold text-foreground'>
                {cacheHit == null ? '—' : `${cacheHit.toFixed(1)}%`}
              </dd>
            </div>
          </dl>
        </section>
        <div className='mb-4'>
          <BillingStrip
            billing={usage.data?.billing || dash.data?.billing}
            vms={dash.data?.vms}
            fallbackToday={Number(totals.today_cost)}
            fallbackTotal={Number(totals.total_cost)}
          />
        </div>
        {rows.length === 0 ? (
          <EmptyState reason='这段时间里还没有用量记录。' />
        ) : (
          <div className='overflow-x-auto rounded-lg border border-border/60'>
            <div className='min-w-[900px]'>
              <div className='flex h-8 items-center border-b bg-muted/30 text-[11px] font-medium tracking-wide text-muted-foreground/80'>
                <SortHead
                  label='账号'
                  col='name'
                  current={sortKey}
                  dir={sortDir}
                  onToggle={toggleSort}
                  className='min-w-[160px] flex-[1.6] pl-3'
                />
                <SortHead
                  label='5 小时'
                  col='u5'
                  current={sortKey}
                  dir={sortDir}
                  onToggle={toggleSort}
                  className='min-w-[100px] flex-[0.9] px-1.5'
                />
                <SortHead
                  label='7 天'
                  col='u7'
                  current={sortKey}
                  dir={sortDir}
                  onToggle={toggleSort}
                  className='min-w-[100px] flex-[0.9] px-1.5'
                />
                <div className='min-w-[90px] flex-[0.8] px-1.5'>Fable</div>
                <SortHead
                  label='同时请求'
                  col='conc'
                  current={sortKey}
                  dir={sortDir}
                  onToggle={toggleSort}
                  className='min-w-[110px] flex-[0.9] px-1.5'
                />
                <SortHead
                  label='请求数'
                  col='req'
                  current={sortKey}
                  dir={sortDir}
                  onToggle={toggleSort}
                  className='min-w-[80px] flex-[0.7] px-1.5 text-right'
                />
                <SortHead
                  label='费用'
                  col='cost'
                  current={sortKey}
                  dir={sortDir}
                  onToggle={toggleSort}
                  className='min-w-[110px] flex-[1] px-1.5 text-right'
                />
                <SortHead
                  label='状态'
                  col='st'
                  current={sortKey}
                  dir={sortDir}
                  onToggle={toggleSort}
                  className='min-w-[80px] flex-[0.7] pr-3 text-right'
                />
              </div>
              {rows.map((row, i) => (
                <AccountRow
                  key={String(row.account_id || row.email || i)}
                  row={row}
                  vm={row.vm_id ? vmIndex.get(String(row.vm_id)) : undefined}
                />
              ))}
            </div>
          </div>
        )}
      </QueryGate>
    </PageHeader>
  )
}
