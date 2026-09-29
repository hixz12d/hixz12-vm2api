import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { VIEW_TITLES } from '@/config/nav'
import type { OpsWindow } from '@/types/panel-overview'
import type { Vm } from '@/types/panel-vm'
import { ChevronRight, Download } from 'lucide-react'
import { fmtNum, pct } from '@/lib/format'
import { opsSince } from '@/lib/ops-window'
import { accountUsable, vmRunning } from '@/lib/vm-status'
import { cacheHitPct } from '@/lib/vm-usage'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { PageHeader } from '@/components/page-header'
import { QueryGate } from '@/components/query-gate'
import { groupsQueryOptions } from '@/features/keys/groups-query'
import { apiKeysQueryOptions } from '@/features/keys/queries'
import { logStatsQueryOptions } from '@/features/logs/queries'
import { BillingStrip } from '@/features/overview/billing-strip'
import { ErrorCollectionSummary } from '@/features/overview/error-collection-summary'
import { HostColumn } from '@/features/overview/host-column'
import { OverviewSkeleton } from '@/features/overview/overview-skeleton'
import { PanelCard, StatCell } from '@/features/overview/panel-card'
import { PoolQuota } from '@/features/overview/pool-quota'
import {
  dashboardQueryOptions,
  usageQueryOptions,
} from '@/features/overview/queries'
import { StatisticsChartCard } from '@/features/overview/statistics-chart-card'
import { TrafficOps } from '@/features/overview/traffic-ops'
import { KeyPatchPanel, StatusLine, Switchboard } from './switchboard'
import { buildLines, summarize } from './switchboard-model'

const DETAILS_OPEN_KEY = 'overview_details_open'

/**
 * 总览 = 夜班交换台。
 * 上：一句话说明现在要不要管；中：每个账号一条线（灯 + 额度刻度）；
 * 右：调用 Key，点一个 Key 标出它能用到的账号。
 * 其余统计（额度池、费用、服务质量、错误分类、主机、趋势图）收进页尾「详细数据」。
 */
export function OverviewPage() {
  const dash = useQuery(dashboardQueryOptions())
  const usage = useQuery(usageQueryOptions())
  const keysQ = useQuery(apiKeysQueryOptions())
  const groupsQ = useQuery(groupsQueryOptions())
  const since = opsSince('1h')
  const stats = useQuery(logStatsQueryOptions(since))
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(
    () => localStorage.getItem(DETAILS_OPEN_KEY) === '1'
  )

  const d = dash.data || {}
  const vms: Vm[] = d.vms || []
  const summary = (d.summary || {}) as Record<string, unknown>
  const totals = (usage.data?.totals || {}) as Record<string, unknown>
  const accounts = usage.data?.accounts
  const groups = groupsQ.data?.items || []
  const keys = keysQ.data?.keys || []

  // `currentOps()` 等价逻辑：优先 request-logs/stats 的 window，回落 dashboard.ops。
  const statsWindow = stats.data?.window
  const ops: OpsWindow | undefined =
    statsWindow && (statsWindow.error || statsWindow.requests != null)
      ? statsWindow
      : d.ops
  const recentErrors = Number(ops?.errors || 0)

  const fableCool = vms.filter(
    (v) => v.fable_cooldown_until && Number(v.fable_cooldown_until) > Date.now()
  ).length
  const lines = buildLines(vms, groups)
  const status = summarize(lines, recentErrors)

  const running = vms.filter(vmRunning).length
  const withToken = vms.filter((v) => v.has_token).length
  const available = vms.filter((v) => v.has_token && accountUsable(v)).length
  const tokensIn = Number(totals.tokens_in ?? summary.tokens_in ?? 0)
  const tokensOut = Number(totals.tokens_out ?? summary.tokens_out ?? 0)
  const reqs = Number(totals.requests ?? summary.requests ?? 0)
  const peak5 = pct(summary.peak_5h ?? totals.peak_5h)
  const cacheHitRate = summary.cache_hit_rate as number | null | undefined
  const cachePct =
    cacheHitRate != null
      ? cacheHitRate * 100
      : cacheHitPct(
          tokensIn,
          summary.cache_read_tokens as number | undefined,
          summary.cache_creation_tokens as number | undefined
        )

  const toggleDetails = (open: boolean) => {
    setDetailsOpen(open)
    localStorage.setItem(DETAILS_OPEN_KEY, open ? '1' : '0')
  }

  return (
    <PageHeader
      title={VIEW_TITLES.overview}
      extra={
        <Button size='sm' asChild>
          <Link to='/import'>
            <Download />
            导入账号
          </Link>
        </Button>
      }
    >
      <QueryGate
        loading={dash.isLoading}
        error={dash.error || (d.error ? new Error(d.error) : null)}
        skeleton={<OverviewSkeleton />}
      >
        <div className='space-y-4'>
          <StatusLine
            summary={status}
            recentErrors={recentErrors}
            fableCool={fableCool}
          />

          <div className='grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]'>
            <Switchboard
              lines={lines}
              accounts={accounts}
              groups={groups}
              selectedKey={keys.find((k) => k.id === selectedKey)}
            />
            <KeyPatchPanel
              keys={keys}
              groups={groups}
              selectedId={selectedKey}
              onSelect={setSelectedKey}
            />
          </div>

          <Collapsible open={detailsOpen} onOpenChange={toggleDetails}>
            <CollapsibleTrigger className='group flex w-full items-center gap-2 py-2 text-sm font-medium text-muted-foreground outline-none after:h-px after:flex-1 after:bg-brass-dim hover:text-foreground focus-visible:text-foreground'>
              <ChevronRight className='size-4 transition-transform duration-200 group-data-[state=open]:rotate-90' />
              详细数据
              <span className='text-xs font-normal'>
                额度池、费用、服务质量、错误分类、主机、趋势图
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className='CollapsibleContent'>
              <div className='space-y-3 pt-2'>
                <PanelCard title='数字一览'>
                  <div className='grid gap-px bg-border/60 sm:grid-cols-2 lg:grid-cols-4'>
                    <StatCell
                      label='能用的账号'
                      value={`${available} / ${withToken}`}
                      hint='凭证有效的账号数 / 已导入凭证的账号数'
                    />
                    <StatCell
                      label='在线'
                      value={`${running} / ${vms.length}`}
                      hint='运行环境已启动的账号'
                    />
                    <StatCell
                      label='5 小时用量最高'
                      value={`${peak5.toFixed(0)}%`}
                      hint='所有账号里 5 小时额度用得最多的那个'
                    />
                    <StatCell
                      label='请求数'
                      value={fmtNum(reqs)}
                      hint={`缓存命中 ${cachePct == null ? '—' : `${cachePct.toFixed(0)}%`} · Tokens ${fmtNum(tokensIn)} / ${fmtNum(tokensOut)}`}
                    />
                  </div>
                </PanelCard>

                <PoolQuota vms={vms} />

                <BillingStrip
                  billing={d.billing}
                  vms={vms}
                  fallbackToday={Number(
                    summary.today_cost ?? totals.today_cost ?? 0
                  )}
                  fallbackTotal={Number(
                    summary.total_cost ?? totals.total_cost ?? 0
                  )}
                />

                <TrafficOps ops={ops} showModels />

                <ErrorCollectionSummary
                  collection={ops?.error_collection}
                  serverMuted={stats.data?.muted_error_classes}
                />

                <PanelCard
                  title='这台服务器'
                  meta={`正在调度：${String(summary.active_vm || '未指定')}`}
                >
                  <div className='px-4 py-3 [&>div]:w-full [&>div]:border-0 [&>div]:p-0 sm:[&>div]:w-full'>
                    <HostColumn host={d.host} />
                  </div>
                </PanelCard>

                <StatisticsChartCard />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </QueryGate>
    </PageHeader>
  )
}
