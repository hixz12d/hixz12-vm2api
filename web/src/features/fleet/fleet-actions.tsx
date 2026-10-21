import { useState } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import {
  ChevronDown,
  Gauge,
  Layers,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { wrapSyncKernelFails } from '@/lib/wrap-health'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ChoiceTiles } from '@/components/choice-tiles'
import { meQueryOptions } from '@/features/auth/queries'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  dashboardQueryOptions,
  usageQueryOptions,
} from '@/features/overview/queries'
import { proxiesQueryOptions } from '@/features/proxies/queries'
import { vmsListQueryOptions } from '@/features/vm/queries'
import type { WrapSyncReport } from '@/features/wrap/queries'
import {
  syncReportFromError,
  syncReportSummary,
} from '@/features/wrap/sync-report'

type FleetAction = 'roll' | 'collect'

type FleetReport = {
  action?: FleetAction
  total?: number
  ok_count?: number
  items?: { id?: string; ok?: boolean }[]
}

type ProbeItem = {
  vm_id?: string
  id?: string
  ok?: boolean
  error?: unknown
}

function errorText(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>
    const nested = rec.error as Record<string, unknown> | undefined
    return String(
      rec.message ||
        nested?.message ||
        rec.code ||
        nested?.code ||
        JSON.stringify(value)
    )
  }
  return String(value)
}

async function invalidateFleet(qc: QueryClient) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: dashboardQueryOptions().queryKey }),
    qc.invalidateQueries({ queryKey: usageQueryOptions().queryKey }),
    qc.invalidateQueries({ queryKey: proxiesQueryOptions().queryKey }),
    qc.invalidateQueries({ queryKey: vmsListQueryOptions().queryKey }),
    qc.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        q.queryKey[0] === 'panel' &&
        q.queryKey[1] === 'vm',
    }),
  ])
}

export function FleetActions() {
  const qc = useQueryClient()
  const me = useQuery(meQueryOptions())
  // 额度探测、全槽更新、重装内核都是管理员接口，其它角色点了只会 403。
  const canManage = me.data?.role === 'admin'
  const [fleetOpen, setFleetOpen] = useState(false)
  const [kernelOpen, setKernelOpen] = useState(false)
  const [kernelMode, setKernelMode] = useState<'keep' | 'traits'>('keep')
  const refresh = useMutation({
    mutationFn: () => invalidateFleet(qc),
    onSuccess: () => toast.success('已刷新'),
  })
  const probe = useMutation({
    mutationFn: () =>
      api<{ items?: ProbeItem[] }>('/api/panel/probe', {
        method: 'POST',
        body: JSON.stringify({ hop: true, force: true }),
      }),
    onSuccess: async (data) => {
      const items = data.items || []
      const ok = items.filter((x) => x && x.ok).length
      const failed = items.filter((x) => x && !x.ok)
      if (failed.length) {
        const reasons = failed
          .slice(0, 2)
          .map(
            (x) => `${x.vm_id || x.id || '?'} ${errorText(x.error) || '失败'}`
          )
          .join('；')
        toast.error(
          `额度查询 ${ok}/${items.length} 成功 · ${failed.length} 个失败${reasons ? ` · ${reasons}` : ''}`
        )
      } else {
        toast.success(`额度已更新（${ok}/${items.length}）`)
      }
      await invalidateFleet(qc)
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const fleet = useMutation({
    mutationFn: (action: FleetAction) =>
      api<FleetReport>('/api/panel/vms/fleet-update', {
        method: 'POST',
        body: JSON.stringify({ action, concurrency: 4 }),
      }),
    onSuccess: async (report) => {
      const items = report.items || []
      const total = report.total ?? items.length
      const ok = report.ok_count ?? items.filter((x) => x?.ok).length
      const failed = items.filter((x) => x && !x.ok).map((x) => x.id || '?')
      const label = report.action === 'collect' ? '重新读取' : '重新加载并读取'
      if (failed.length) {
        toast.error(`${label} ${ok}/${total} 成功 · 失败：${failed.join('、')}`)
      } else {
        toast.success(`${label}完成（${ok}/${total}）`)
      }
      setFleetOpen(false)
      await invalidateFleet(qc)
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const wrapSync = useMutation({
    mutationFn: (mode: 'keep' | 'traits') =>
      api<WrapSyncReport>('/api/panel/wrap-cli/sync', {
        method: 'POST',
        body: JSON.stringify({ restart: true, mode }),
      }),
    onSuccess: (report) => {
      const total = report.total ?? 0
      const ok = report.ok_count ?? 0
      const kernelFail = wrapSyncKernelFails(report.items)
      if ((report.failed_count || 0) > 0) {
        toast.error(`内核重装 ${syncReportSummary(report)}`)
      } else if (kernelFail > 0) {
        toast.error(
          `内核已装好 ${ok}/${total}，但有 ${kernelFail} 个没能重新跑起来`
        )
      } else {
        toast.success(`内核重装完成（${ok}/${total}）`)
      }
      setKernelOpen(false)
    },
    onError: (error: Error) => {
      // 部分槽失败时网关回 400，正文仍是逐槽报告。
      const report = syncReportFromError(error)
      toast.error(
        report ? `内核重装 ${syncReportSummary(report)}` : error.message
      )
    },
    onSettled: () => invalidateFleet(qc),
  })

  const busy = probe.isPending || fleet.isPending || wrapSync.isPending

  return (
    <div className='flex items-center gap-1.5'>
      <Button
        variant='outline'
        size='sm'
        className='max-md:hidden'
        onClick={() => refresh.mutate()}
        disabled={refresh.isPending}
        loading={refresh.isPending}
      >
        刷新
      </Button>
      {canManage ? (
        <Button
          variant='outline'
          size='sm'
          className='max-md:hidden'
          onClick={() => probe.mutate()}
          disabled={probe.isPending}
          loading={probe.isPending}
          title='向每个账号查一次 5 小时 / 7 天额度还剩多少'
        >
          查一遍额度
        </Button>
      ) : null}

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            size='sm'
            className='gap-1 px-2'
            aria-label={busy ? '更多批量操作（有任务在执行）' : '更多批量操作'}
          >
            {busy && <Loader2 className='size-3.5 animate-spin' />}
            <span className='max-md:sr-only'>更多</span>
            <MoreHorizontal className='md:hidden' />
            <ChevronDown className='size-3.5 opacity-60 max-md:hidden' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-64'>
          <DropdownMenuItem
            className='md:hidden'
            onSelect={() => refresh.mutate()}
            disabled={refresh.isPending}
          >
            <RefreshCw />
            刷新
          </DropdownMenuItem>
          {canManage ? (
            <>
              <DropdownMenuItem
                className='md:hidden'
                onSelect={() => probe.mutate()}
                disabled={probe.isPending}
              >
                <Gauge />
                查一遍额度
              </DropdownMenuItem>
              <DropdownMenuSeparator className='md:hidden' />
              <DropdownMenuLabel className='text-xs font-normal text-muted-foreground'>
                对所有账号生效，会先让你确认
              </DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={() => setFleetOpen(true)}
                disabled={fleet.isPending}
              >
                <Layers />
                全部账号更新…
              </DropdownMenuItem>
              <DropdownMenuItem
                variant='destructive'
                onSelect={() => setKernelOpen(true)}
                disabled={wrapSync.isPending}
              >
                <RotateCcw />
                重装内核并重启…
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuLabel className='text-xs font-normal text-muted-foreground'>
              批量操作仅管理员可用
            </DropdownMenuLabel>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={fleetOpen} onOpenChange={setFleetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>全部账号更新</DialogTitle>
            <DialogDescription>
              一次处理所有账号的运行环境，同时最多 4
              个。不会删除任何账号，也不会重启管理台。
            </DialogDescription>
          </DialogHeader>
          <dl className='grid gap-3 text-sm'>
            <div>
              <dt className='font-medium'>只重新读取机器特征</dt>
              <dd className='text-muted-foreground'>
                不打断任何账号，只是把每台机器的设备信息重新记一遍。
              </dd>
            </div>
            <div>
              <dt className='font-medium'>重新加载并读取</dt>
              <dd className='text-muted-foreground'>
                把每个账号已在跑的运行程序重新加载一次再读取特征，不更换程序版本（换版本请用「重装内核并重启」）。加载那几秒里，这个账号上正在跑的请求可能失败。真虚拟机账号如果还没接好会跳过并记为失败。
              </dd>
            </div>
          </dl>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setFleetOpen(false)}
              disabled={fleet.isPending}
            >
              取消
            </Button>
            <Button
              variant='outline'
              disabled={fleet.isPending}
              loading={fleet.isPending}
              onClick={() => fleet.mutate('collect')}
            >
              只重新读取
            </Button>
            <Button
              disabled={fleet.isPending}
              loading={fleet.isPending}
              onClick={() => fleet.mutate('roll')}
            >
              重新加载并读取
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={kernelOpen} onOpenChange={setKernelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重装内核并重启</DialogTitle>
            <DialogDescription>
              把当前选定的内核（含 cli-node 与官方统计上报程序）重新装到所有账号上，再逐个重启正在运行的账号。GPT（Codex）账号不参与。
            </DialogDescription>
          </DialogHeader>
          <p className='text-sm text-muted-foreground'>
            影响：重启那几秒里，这些账号上正在进行的请求会中断，调用方会看到报错。已停止的账号只换文件、不启动。一般只在换了内核版本、或某个账号内核卡住时才需要。
          </p>
          <ChoiceTiles
            label='更新方式'
            value={kernelMode}
            onChange={setKernelMode}
            choices={[
              {
                value: 'keep',
                title: '保留原数据重建',
                detail:
                  '留下凭证、设备指纹和统计，只换程序并重启运行中的账号。可随时再执行一次，不丢数据。',
              },
              {
                value: 'traits',
                title: '重建新特征',
                detail:
                  '本机账号清空家目录并重新生成机器身份（设备指纹会变）；集群节点上的账号仍只换镜像。',
              },
            ]}
          />
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setKernelOpen(false)}
              disabled={wrapSync.isPending}
            >
              取消
            </Button>
            <Button
              disabled={wrapSync.isPending}
              loading={wrapSync.isPending}
              variant={kernelMode === 'traits' ? 'destructive' : 'default'}
              onClick={() => wrapSync.mutate(kernelMode)}
            >
              {kernelMode === 'keep' ? '保留原数据重建' : '重建新特征'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
