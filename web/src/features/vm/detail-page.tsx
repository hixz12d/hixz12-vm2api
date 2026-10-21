import { useMemo, useState } from 'react'
import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import type { Vm, VmKernelSnapshot, VmProxySnap } from '@/types/panel-vm'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import {
  canRefreshCredential,
  credTypeOf,
  supportsOfficialCc,
} from '@/lib/cred-type'
import {
  concInfo,
  fableCap,
  rpmInfo,
  vmCost,
  weeklySplitInfo,
} from '@/lib/fable-status'
import { usedPctOf } from '@/lib/format'
import { cn } from '@/lib/utils'
import { compactEmail, isCodexVm } from '@/lib/vm-kind'
import {
  claudeTier,
  poolStatus,
  restrictionCopy,
  vmRunning,
} from '@/lib/vm-status'
import { cacheHitPct } from '@/lib/vm-usage'
import { useNow } from '@/hooks/use-now'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ChoiceTiles } from '@/components/choice-tiles'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { PageHeader } from '@/components/page-header'
import { PlatformChip, SlotIdentity } from '@/components/platform-chip'
import { QueryGate } from '@/components/query-gate'
import { StatusMark } from '@/components/status-mark'
import { LabelStrip, Lamp } from '@/components/switchboard-parts'
import { dashboardQueryOptions } from '@/features/overview/queries'
import { proxiesForVmBind } from '@/features/proxies/proxy-sort'
import { proxiesQueryOptions } from '@/features/proxies/queries'
import { routingQueryOptions } from '@/features/settings/queries'
import { accountLamp } from '@/features/vm/account-lines'
import { VmAccountTab } from '@/features/vm/detail-account-tab'
import { VmOpsTab } from '@/features/vm/detail-ops-tab'
import { VmOverviewTab } from '@/features/vm/detail-overview-tab'
import { VmProxyTab } from '@/features/vm/detail-proxy-tab'
import { VmDetailSkeleton } from '@/features/vm/detail-skeleton'
import { VmTestTab } from '@/features/vm/detail-test-tab'
import { bootOutcome, vmTodayCounts } from '@/features/vm/detail-today'
import { NodeChip } from '@/features/vm/node-chip'
import {
  probeOutcome,
  syncOutcome,
  type ProbeCheck,
  type SyncResult,
} from '@/features/vm/probe-status'
import {
  vmQueryOptions,
  vmSeedQueryOptions,
  vmSeedUploadLogQueryOptions,
  vmsListQueryOptions,
} from '@/features/vm/queries'
import { RuntimeChip } from '@/features/vm/runtime-chip'
import {
  SchedulableSwitch,
  vmSchedulableProps,
} from '@/features/vm/schedulable-switch'
import { SeedPolicyCard } from '@/features/vm/seed-policy-card'
import { usePoolSeatStream } from '@/features/vm/use-pool-seat-stream'
import { useVmTestChat } from '@/features/vm/use-vm-test-chat'
import {
  pickBindTarget,
  useVmPerms,
  visibleTab,
  vmDetailTabs,
} from '@/features/vm/vm-perms'
import { VmTestSchedule } from '@/features/vm/vm-test-schedule'

function postVm<T = unknown>(id: string, path: string, body?: unknown) {
  return api<T>(`/api/panel/vms/${encodeURIComponent(id)}${path}`, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** 操作成功后的白话提示；没列出的路径回落为「已完成」。 */
const ACTION_DONE: Record<string, string> = {
  '/start': '已启动，账号开始接请求',
  '/stop': '已停止，这个账号暂时不接请求',
  '/activate': '已设为当前调度账号',
  '/reload': '已重新加载，这个账号用上了最新程序',
  '/collect-identity': '已重新读取机器特征',
  '/official-cc-bootstrap': '已开始官方初装，稍后刷新看进度',
  '/reconcile-fingerprint': '已按官方配置对齐设备特征',
  '/oauth/refresh': '凭证已刷新',
  '/wrap-cli/promote': '已把这个账号的内核设为模板',
  '/wrap-cli/repair': '已重装这个账号的内核',
  '/allocate-proxy': '已分配一条空闲出口代理',
}

type VmJob = {
  key: string
  run: () => Promise<unknown>
  done?: (data: unknown) => void
}

/** 页签留在外层：切槽位时主体按 id 重挂清掉上一个槽的输入，但停在同一页签。 */
export function VmDetailPage() {
  const { id } = useParams({ from: '/_authenticated/vm/$id' })
  const [tab, setTab] = useState('overview')
  return <VmDetailBody key={id} id={id} tab={tab} onTabChange={setTab} />
}

function VmDetailBody({
  id,
  tab: wantedTab,
  onTabChange,
}: {
  id: string
  tab: string
  onTabChange: (tab: string) => void
}) {
  const navigate = useNavigate()
  const [seedDebug, setSeedDebug] = useState(false)
  const qc = useQueryClient()
  const perms = useVmPerms()
  const dash = useQuery({
    ...dashboardQueryOptions(5000),
    enabled: perms.dashboard,
  })
  // 租户读不了 dashboard，槽位下拉改用自己能看到的列表。
  const slots = useQuery({
    ...vmsListQueryOptions(),
    enabled: perms.known && !perms.dashboard,
  })
  const proxies = useQuery({ ...proxiesQueryOptions(), enabled: perms.admin })
  const detail = useQuery({
    ...vmQueryOptions(id),
    refetchInterval: wantedTab === 'seed' ? 2000 : false,
  })
  const seed = useQuery({
    ...vmSeedQueryOptions(id),
    enabled: perms.admin && wantedTab === 'seed',
    refetchInterval: wantedTab === 'seed' ? 2000 : false,
  })
  const seedUploadLog = useQuery({
    ...vmSeedUploadLogQueryOptions(id),
    enabled: perms.admin && wantedTab === 'seed' && seedDebug,
    refetchInterval: seedDebug && wantedTab === 'seed' ? 2000 : false,
  })
  const routing = useQuery({ ...routingQueryOptions(), enabled: perms.admin })
  usePoolSeatStream()

  const tabs = vmDetailTabs(perms)
  const tab = visibleTab(wantedTab, tabs)

  const [bindId, setBindId] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetMode, setResetMode] = useState<'keep' | 'traits'>('keep')
  const [resetInput, setResetInput] = useState('')
  const data = detail.data || {}
  const slotList: Vm[] =
    (perms.dashboard ? dash.data?.vms : slots.data?.items) || []
  const listVm = slotList.find((v) => v.id === id)
  const vm = ((data.vm as Vm | undefined) || listVm || { id }) as Vm
  const kernel = (data.kernel as VmKernelSnapshot | undefined) || null
  const acc = (data.account as Record<string, unknown> | undefined) || {}
  const proxy = ((data.proxy as VmProxySnap | undefined) ||
    vm.proxy ||
    {}) as VmProxySnap
  const seedSlot = useMemo(() => {
    const locale =
      typeof vm.locale === 'string'
        ? vm.locale
        : vm.locale === null
          ? null
          : undefined
    return {
      timezone: vm.timezone,
      timezone_source: vm.timezone_source,
      locale,
    }
  }, [vm.timezone, vm.timezone_source, vm.locale])
  const test = useVmTestChat(vm)
  const refreshAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: vmQueryOptions(id).queryKey }),
      qc.invalidateQueries({ queryKey: dashboardQueryOptions().queryKey }),
      qc.invalidateQueries({ queryKey: vmsListQueryOptions().queryKey }),
      qc.invalidateQueries({ queryKey: proxiesQueryOptions().queryKey }),
    ])
  }
  // 每个按钮按自己的 key 记进行中，可同时跑多个而互不覆盖。
  const jobKey = ['panel', 'vm-detail-job', id] as const
  const job = useMutation({
    mutationKey: jobKey,
    mutationFn: (j: VmJob) => j.run(),
    onSuccess: async (data, j) => {
      j.done?.(data)
      await refreshAll()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const pendingKeys = useMutationState({
    filters: { mutationKey: jobKey, status: 'pending' },
    select: (m) => (m.state.variables as VmJob | undefined)?.key ?? '',
  })
  const busy = (key: string) => pendingKeys.includes(key)
  const runJob = (j: VmJob) => {
    if (!busy(j.key)) job.mutate(j)
  }
  const act = (path: string, body?: unknown) =>
    runJob({
      key: path,
      run: () => postVm(id, path, body),
      done: (data) => {
        if (path === '/sync') {
          const result = (data || {}) as SyncResult
          if (result.ok === true) toast.success(syncOutcome(result))
          else toast.error(syncOutcome(result))
        } else if (path === '/probe') {
          const probe = data as ProbeCheck
          if (probe.ok === true) toast.success(probeOutcome(probe))
          else toast.error(probeOutcome({ ...probe, ok: false }))
        } else if (path === '/start') {
          const boot = bootOutcome(data)
          if (boot.ok) toast.success(boot.message)
          else toast.warning(boot.message)
        } else if (path === '/stop') {
          toast.success('已关机，调度已关闭')
        } else {
          toast.success(ACTION_DONE[path] || '已完成')
        }
      },
    })
  const saveTimezone = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/api/panel/vms/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: async (saved, body) => {
      const sync = (
        saved as { timezone_sync?: { kernel_hot?: boolean } } | undefined
      )?.timezone_sync
      const hot = sync?.kernel_hot ? ' · 已热更新 kernel.json' : ''
      toast.success(
        (body.timezone_follow_proxy ? '已跟随代理时区' : '已保存时区') + hot
      )
      await refreshAll()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const saveSeed = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/api/panel/vms/${encodeURIComponent(id)}/seed-settings`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      toast.success('已播种')
      await refreshAll()
      await qc.invalidateQueries({
        queryKey: ['panel', 'vm', id, 'seed'],
      })
      await qc.invalidateQueries({
        queryKey: ['panel', 'vm', id, 'seed-upload-log'],
      })
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const remove = useMutation({
    mutationFn: () =>
      api(`/api/panel/vms/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('账号已删除')
      await qc.invalidateQueries({ queryKey: dashboardQueryOptions().queryKey })
      navigate({ to: '/vm' })
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const resetVm = useMutation({
    mutationFn: (mode: 'keep' | 'traits') => postVm(id, '/reset', { mode }),
    onSuccess: async (_data, mode) => {
      toast.success(
        mode === 'keep' ? `已保留原数据重建 ${id}` : `已按新特征重建 ${id}`
      )
      setConfirmReset(false)
      setResetInput('')
      await refreshAll()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const pool = proxies.data?.proxies || []
  const boundId = String(proxy.id || vm.proxy_id || '')
  // 本地代理固定第一。已绑到本槽的留在下拉里，否则正在用它时列表里没有。
  const free = proxiesForVmBind(pool, id, 5, vm.node_id ?? null)
  const bindTarget = pickBindTarget(bindId, free)
  const syncTelemetry =
    (routing.data?.official_cc as { sync_telemetry?: boolean } | undefined)
      ?.sync_telemetry === true
  const quotaSrc = {
    utilization_5h: acc.utilization_5h ?? vm.utilization_5h,
    utilization_7d: acc.utilization_7d ?? vm.utilization_7d,
    codex_usage: (acc.codex_usage as Vm['codex_usage']) || vm.codex_usage,
  }
  const u5 = usedPctOf(quotaSrc, '5h')
  const u7 = usedPctOf(quotaSrc, '7d')
  const tierKey = claudeTier(vm).key
  const now = useNow()
  const cost = vmCost(vm)
  const split = weeklySplitInfo(
    (acc.weekly_split ? acc : vm) as Record<string, unknown>
  )
  const conc = concInfo(vm, dash.data?.routing?.tiers, fableCap(dash.data))
  const rpm = rpmInfo(vm, acc)
  const todayReadCache = Number(
    acc.today_cache_read_tokens ?? vm.today_cache_read_tokens ?? 0
  )
  const todayWriteCache = Number(
    acc.today_cache_creation_tokens ?? vm.today_cache_creation_tokens ?? 0
  )
  const todayInput = Number(
    acc.today_input_tokens ??
      vm.today_input_tokens ??
      acc.tokens_in ??
      vm.tokens_in ??
      0
  )
  const todayHit = cacheHitPct(todayInput, todayReadCache, todayWriteCache)
  const today = vmTodayCounts(vm, data.billing)
  const credType = credTypeOf(vm)
  const officialCc = supportsOfficialCc(vm)
  const canRefresh = canRefreshCredential(vm)
  // gateway 的 credential_mode_unsupported 在「手动初装」与「刷新凭证」下
  // 语义不同，这里按各自来源给文案，提前禁用而不是等 400。
  const refreshBlocked =
    credType === 'apikey'
      ? 'Console API Key 不能刷新'
      : credType === 'setup-token' && !vm.has_refresh
        ? '官方 Setup Token（无 refresh）不能刷新'
        : ''
  const lamp = accountLamp(vm)

  return (
    <PageHeader
      title={
        vm.email
          ? `账号 · ${compactEmail(vm.email, 28)}`
          : `账号 · ${vm.name || vm.id}`
      }
      fluid
    >
      <QueryGate
        loading={detail.isLoading && !listVm}
        error={detail.error}
        skeleton={<VmDetailSkeleton />}
      >
        <div className='mb-4 grid gap-3 rounded-md border border-brass-dim bg-card px-4 py-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <Button variant='ghost' size='sm' className='-ms-2' asChild>
              <Link to='/vm'>
                <ArrowLeft />
                全部账号
              </Link>
            </Button>
            {slotList.length > 1 ? (
              <Select
                value={id}
                onValueChange={(next) =>
                  navigate({ to: '/vm/$id', params: { id: next } })
                }
              >
                <SelectTrigger
                  size='sm'
                  className='w-[220px]'
                  aria-label='切换到其他账号'
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {slotList.map((v) => (
                    <SelectItem key={v.id} value={v.id} className='max-w-[280px]'>
                      <SlotIdentity vm={v} compact />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
          <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
            <Lamp tone={lamp.lamp} className='size-3' />
            <LabelStrip className='text-sm'>{vm.name || vm.id}</LabelStrip>
            <PlatformChip vm={vm} />
            <RuntimeChip vm={vm} className='text-[11px]' />
            <NodeChip nodeId={vm.node_id} className='text-[11px]' />
            {claudeTier(vm).key !== 'none' ? (
              <StatusMark tone={claudeTier(vm)} variant='pill' />
            ) : null}
            <span
              className={cn(
                'text-sm',
                lamp.lamp === 'red'
                  ? 'text-lamp-red'
                  : lamp.lamp === 'amber'
                    ? 'text-lamp-amber'
                    : 'text-muted-foreground'
              )}
            >
              {lamp.text}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <StatusMark tone={poolStatus(vm)} variant='pill' />
                </span>
              </TooltipTrigger>
              <TooltipContent>调度状态：{restrictionCopy(vm)}</TooltipContent>
            </Tooltip>
            <span className='text-sm text-muted-foreground'>
              运行环境{vmRunning(vm) ? '已启动' : '已停止'}
            </span>
            <label className='flex items-center gap-1.5 rounded-md border border-input px-2 py-1 text-sm text-muted-foreground'>
              接请求
              <SchedulableSwitch {...vmSchedulableProps(vm)} />
            </label>
            {perms.power ? (
              <div className='ms-auto flex flex-wrap items-center gap-2'>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => act('/sync', {})}
                  loading={busy('/sync')}
                  title='重新读取官方套餐和额度；官方确认有额度时解除额度冷却'
                >
                  同步账号
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => act('/probe', {})}
                  loading={busy('/probe')}
                  title='查询当前额度，不解除本地额度冷却'
                >
                  查额度
                </Button>
                {vmRunning(vm) ? (
                  <Button
                    size='sm'
                    variant='outline'
                    loading={busy('/stop')}
                    disabled={busy('/start')}
                    onClick={() => act('/stop')}
                    title='停止运行环境，同时关闭调度'
                  >
                    停止
                  </Button>
                ) : (
                  <Button
                    size='sm'
                    loading={busy('/start')}
                    disabled={busy('/stop')}
                    onClick={() => act('/start')}
                    title='启动运行环境；有凭证时会重新开启调度'
                  >
                    启动
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        </div>
        <Tabs value={tab} onValueChange={onTabChange}>
          <TabsList>
            <TabsTrigger value='overview'>状态和用量</TabsTrigger>
            <TabsTrigger value='account'>凭证</TabsTrigger>
            <TabsTrigger value='proxy'>出口代理</TabsTrigger>
            {tabs.includes('test') ? (
              <TabsTrigger value='test'>发条测试</TabsTrigger>
            ) : null}
            {tabs.includes('ops') ? (
              <TabsTrigger value='ops'>运行环境</TabsTrigger>
            ) : null}
            {tabs.includes('seed') ? (
              <TabsTrigger value='seed'>初装设置</TabsTrigger>
            ) : null}
          </TabsList>
          <VmOverviewTab
            kernel={kernel}
            vm={vm}
            acc={acc}
            proxy={proxy}
            dash={dash}
            u5={u5}
            u7={u7}
            tierKey={tierKey}
            now={now}
            cost={cost}
            split={split}
            conc={conc}
            rpm={rpm}
            today={today}
            costByModel={data.billing?.by_model}
            billing={data.billing}
          />
          <VmAccountTab
            id={id}
            vm={vm}
            acc={acc}
            dash={dash}
            credType={credType}
            officialCc={officialCc}
            u5={u5}
            u7={u7}
            tierKey={tierKey}
            todayReadCache={todayReadCache}
            todayWriteCache={todayWriteCache}
            todayHit={todayHit}
            today={today}
            canRefresh={canRefresh}
            refreshBlocked={refreshBlocked}
            busy={busy}
            onNeedProxy={() => onTabChange('proxy')}
            onAction={act}
            onCredentialCommitted={async (_data, _target, what) => {
              toast.success(what)
              await refreshAll()
            }}
          />
          <VmProxyTab
            vm={vm}
            proxy={proxy}
            boundId={boundId}
            free={free}
            pool={pool}
            bindId={bindTarget}
            canManage={perms.admin}
            busy={busy}
            onBindIdChange={setBindId}
            onUnbind={() =>
              runJob({
                key: 'proxy:unbind',
                run: () =>
                  api(`/api/panel/proxies/${boundId}/unbind`, {
                    method: 'POST',
                    body: JSON.stringify({ vm_id: id }),
                  }),
                done: () => toast.success('已解绑'),
              })
            }
            onAllocate={() => act('/allocate-proxy')}
            onBind={() =>
              runJob({
                key: 'proxy:bind',
                run: () =>
                  api(`/api/panel/proxies/${bindTarget}/bind`, {
                    method: 'POST',
                    body: JSON.stringify({ vm_id: id }),
                  }),
                done: () => toast.success('已绑定'),
              })
            }
            onProbe={() =>
              runJob({
                key: 'proxy:probe',
                run: () =>
                  api(`/api/panel/proxies/${boundId}/probe`, {
                    method: 'POST',
                  }),
                done: () => toast.success('探测完成'),
              })
            }
            onGeo={() =>
              runJob({
                key: 'proxy:geo',
                run: () =>
                  api(`/api/panel/proxies/${boundId}/geo`, { method: 'POST' }),
                done: (data) => {
                  const geo = (
                    data as {
                      geo?: {
                        timezone?: string | null
                        country?: string | null
                      }
                    }
                  )?.geo
                  const where = [geo?.country, geo?.timezone]
                    .filter(Boolean)
                    .join(' · ')
                  toast.success(where ? `出口位置 ${where}` : '已检测')
                },
              })
            }
          />
          {perms.test ? (
            <VmTestTab
              {...test}
              vm={vm}
              credType={credType}
              isCodex={isCodexVm(vm)}
              dataplane={vm.resolved_dataplane}
              schedule={<VmTestSchedule key={vm.id} vm={vm} {...test} />}
            />
          ) : null}
          {perms.admin ? (
            <>
              <VmOpsTab
                vm={vm}
                proxy={proxy}
                officialCc={officialCc}
                credType={credType}
                canRefresh={canRefresh}
                refreshBlocked={refreshBlocked}
                savingTimezone={saveTimezone.isPending}
                onAction={act}
                busy={busy}
                onRefresh={() => void refreshAll()}
                onTimezoneSave={(timezone) => saveTimezone.mutate({ timezone })}
                onTimezoneFollowProxy={() =>
                  saveTimezone.mutate({ timezone_follow_proxy: true })
                }
                onReset={() => {
                  setResetMode('keep')
                  setResetInput('')
                  setConfirmReset(true)
                }}
                onDelete={() => setConfirmDel(true)}
              />
              <TabsContent value='seed' className='space-y-3 pt-4'>
                <p className='text-sm text-muted-foreground'>
                  导入完整 OAuth 凭证后，系统会在这个账号的运行环境里安装官方
                  Claude Code。这里控制安装后的配置，遥测是否发送以这里的开关为准。
                </p>
                {seed.data ? (
                  <SeedPolicyCard
                    key={id}
                    seed={seed.data}
                    slot={seedSlot}
                    telemetry={kernel?.telemetry}
                    saving={saveSeed.isPending}
                    syncTelemetry={syncTelemetry}
                    debug={seedDebug}
                    onDebug={setSeedDebug}
                    uploadLog={seedUploadLog.data}
                    proxyTimezone={proxy.geo?.timezone || ''}
                    onSave={(next) => saveSeed.mutate(next)}
                  />
                ) : (
                  <p className='text-sm text-muted-foreground'>
                    {seed.isError ? '种子策略读取失败' : '读取种子策略…'}
                  </p>
                )}
              </TabsContent>
            </>
          ) : null}
        </Tabs>
        <ConfirmDialog
          open={confirmDel}
          onOpenChange={setConfirmDel}
          title='删除这个账号？'
          desc={
            <div className='grid gap-1.5 text-sm'>
              <p>
                {vm.name && vm.name !== id ? `${vm.name} · ` : ''}
                {id}
              </p>
              <p className='text-destructive'>
                无法恢复：运行环境、凭证、出口代理绑定会一起删除，它所在的分组里也会少掉它。
              </p>
            </div>
          }
          confirmText='删除账号'
          cancelBtnText='取消'
          destructive
          isLoading={remove.isPending}
          handleConfirm={() => {
            if (!remove.isPending) remove.mutate()
          }}
        />
        <ConfirmDialog
          open={confirmReset}
          onOpenChange={(open) => {
            setConfirmReset(open)
            if (!open) setResetInput('')
          }}
          title='重建运行环境？'
          desc={
            <>
              <p>
                {vm.name && vm.name !== id ? `${vm.name} · ` : ''}
                {id}
              </p>
              <div className='mt-2 grid gap-1.5 text-sm'>
                <p>换上当前版本的程序并重建容器，正在处理的请求会中断。</p>
                <p className={resetMode === 'traits' ? 'text-destructive' : ''}>
                  {resetMode === 'keep'
                    ? '保留凭证、设备特征和统计，只更换运行程序。'
                    : '清空凭证和家目录，重新生成设备特征；需要重新导入凭证，清掉的内容无法找回。'}
                </p>
                <p className='text-muted-foreground'>
                  输入 <b className='text-foreground'>{id}</b> 确认。
                </p>
              </div>
            </>
          }
          confirmText={resetMode === 'keep' ? '保留原数据重建' : '重建新特征'}
          cancelBtnText='取消'
          destructive={resetMode === 'traits'}
          disabled={resetInput.trim() !== id}
          isLoading={resetVm.isPending}
          handleConfirm={() => resetVm.mutate(resetMode)}
        >
          <ChoiceTiles
            label='重建方式'
            value={resetMode}
            onChange={setResetMode}
            choices={[
              {
                value: 'keep',
                title: '保留原数据重建',
                detail: '留下凭证、指纹、主机名和统计，只换容器里的服务。',
              },
              {
                value: 'traits',
                title: '重建新特征',
                detail:
                  '清掉凭证和家目录，重新生成主机名、machine-id 和设备特征。',
              },
            ]}
          />
          <Input
            autoFocus
            autoComplete='off'
            spellCheck={false}
            placeholder={id}
            aria-label='确认 ID'
            value={resetInput}
            onChange={(e) => setResetInput(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                resetInput.trim() === id &&
                !resetVm.isPending
              ) {
                resetVm.mutate(resetMode)
              }
            }}
          />
        </ConfirmDialog>
      </QueryGate>
    </PageHeader>
  )
}
