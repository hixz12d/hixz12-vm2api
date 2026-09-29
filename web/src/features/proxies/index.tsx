import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { VIEW_TITLES } from '@/config/nav'
import type { Vm } from '@/types/panel-vm'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { PageHeader } from '@/components/page-header'
import {
  CardGridSkeleton,
  SectionSkeleton,
  TableSkeleton,
} from '@/components/page-skeletons'
import { QueryGate } from '@/components/query-gate'
import { dashboardQueryOptions } from '@/features/overview/queries'
import { ProxyPoolControls } from '@/features/proxies/proxy-pool-controls'
import { ProxySummary } from '@/features/proxies/proxy-summary'
import { ProxyTable } from '@/features/proxies/proxy-table'
import { proxiesQueryOptions } from '@/features/proxies/queries'
import { ProxyEditDialog } from './proxy-edit-dialog'
import {
  type ProxySortKey,
  proxyBoundIds,
  readPositive,
  sortedProxies,
} from './proxy-sort'

export function ProxiesPage() {
  const px = useQuery(proxiesQueryOptions())
  const dash = useQuery(dashboardQueryOptions())
  const qc = useQueryClient()
  const [raw, setRaw] = useState('')
  const [sortKey, setSortKey] = useState<ProxySortKey>('status')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [delId, setDelId] = useState('')
  const [editId, setEditId] = useState('')
  const [unbindTarget, setUnbindTarget] = useState<{
    id: string
    vmId: string
  } | null>(null)
  const list = px.data?.proxies || []
  const tot = px.data?.totals || {}
  const cfg = px.data?.config || {}
  const vms: Vm[] = dash.data?.vms || []
  // 回落序对齐 index.html:7756 的 proxyBindLimit()：totals 先于 config。
  const bindLimit = readPositive(
    tot,
    'bind_limit',
    readPositive(cfg, 'bind_limit', 5)
  )
  const probeMin = readPositive(cfg, 'probe_interval_min', 10)
  const total = Number(tot.total ?? list.length)
  const slotsUsed = Number(tot.slots_used ?? tot.bound ?? 0)
  const slotsCap = Number(tot.slots_cap ?? total * bindLimit)
  const rows = useMemo(
    () => sortedProxies(list, sortKey, sortDir),
    [list, sortKey, sortDir]
  )
  const deleting = rows.find((p) => p.id === delId)
  const delBound = proxyBoundIds(deleting).length
  const editing = rows.find((p) => p.id === editId) || null

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: proxiesQueryOptions().queryKey }),
      qc.invalidateQueries({ queryKey: dashboardQueryOptions().queryKey }),
    ])

  const addLocal = useMutation({
    mutationFn: () =>
      api<Record<string, unknown>>('/api/panel/proxies/local', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: async (data) => {
      toast.success(data.created ? '已添加本机直连' : '本机直连已经有了')
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const importPx = useMutation({
    mutationFn: () =>
      api<Record<string, unknown>>('/api/panel/proxies/import', {
        method: 'POST',
        body: JSON.stringify({ text: raw }),
      }),
    onSuccess: async (data) => {
      toast.success(
        `新增 ${data.added ?? 0} 条，跳过 ${data.skipped ?? 0} 条（重复或格式不对）`
      )
      setRaw('')
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const probeAll = useMutation({
    mutationFn: () => api('/api/panel/proxies/probe', { method: 'POST' }),
    onSuccess: async () => {
      toast.success('已检查所有代理能不能连上')
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const saveConfig = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api<{
        egress?: { proxy_id: string; ok: boolean; error?: string | null }[]
      }>('/api/panel/proxies/config', {
        method: 'PUT',
        body: JSON.stringify(patch),
      }),
    onSuccess: async (data, patch) => {
      const failed = (data.egress || []).filter((entry) => !entry.ok)
      if (failed.length) {
        toast.warning(
          `DNS 已保存，但 ${failed.length} 个出口重载失败：${failed.map((entry) => entry.proxy_id).join('、')}`
        )
      } else if (patch.dns_primary != null) {
        toast.success('DNS 设置已保存，已同步到正在用的代理')
      } else if (patch.bind_limit != null) {
        toast.success(`每条代理最多给 ${String(patch.bind_limit)} 个账号用`)
      } else if (patch.probe_interval_min != null) {
        toast.success(`每 ${String(patch.probe_interval_min)} 分钟自动检查一次`)
      } else {
        toast.success('已保存')
      }
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const probeOne = useMutation({
    mutationFn: (id: string) =>
      api(`/api/panel/proxies/${encodeURIComponent(id)}/probe`, {
        method: 'POST',
      }),
    onSuccess: async () => {
      toast.success('检查完成')
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const geoOne = useMutation({
    mutationFn: (id: string) =>
      api<{ geo?: { timezone?: string | null; country?: string | null } }>(
        `/api/panel/proxies/${encodeURIComponent(id)}/geo`,
        { method: 'POST' }
      ),
    onSuccess: async (data) => {
      const where = [data.geo?.country, data.geo?.timezone]
        .filter(Boolean)
        .join(' · ')
      toast.success(where ? `出口在 ${where}` : '已查过位置')
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const geoAll = useMutation({
    mutationFn: () =>
      api<{ results?: { ok?: boolean }[] }>('/api/panel/proxies/geo', {
        method: 'POST',
        body: JSON.stringify({ force: true }),
      }),
    onSuccess: async (data) => {
      const rows = data.results || []
      const ok = rows.filter((r) => r.ok).length
      toast.success(`位置查询完成（${ok}/${rows.length}）`)
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/api/panel/proxies/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: async () => {
      toast.success('代理已删除')
      setDelId('')
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const setEnabled = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) =>
      api(
        `/api/panel/proxies/${encodeURIComponent(id)}/${on ? 'enable' : 'disable'}`,
        { method: 'POST' }
      ),
    onSuccess: async (_data, { on }) => {
      toast.success(on ? '代理已启用' : '代理已停用')
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const bind = useMutation({
    mutationFn: ({ id, vmId }: { id: string; vmId: string }) =>
      api(`/api/panel/proxies/${encodeURIComponent(id)}/bind`, {
        method: 'POST',
        body: JSON.stringify({ vm_id: vmId }),
      }),
    onSuccess: async () => {
      toast.success('已绑到账号')
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const unbind = useMutation({
    mutationFn: ({ id, vmId }: { id: string; vmId: string }) =>
      api(`/api/panel/proxies/${encodeURIComponent(id)}/unbind`, {
        method: 'POST',
        body: JSON.stringify({ vm_id: vmId }),
      }),
    onSuccess: async () => {
      toast.success('已解除绑定')
      setUnbindTarget(null)
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  /**
   * 取回含账密的 SOCKS5 地址并写入剪贴板。
   *
   * URI 只在这个回调里存活，不进 state、不渲染 —— 复制到剪贴板与显示在页面上
   * 是两个风险级别，后者会进 DOM、DevTools 和截图。见 api-contract.md。
   */
  const copyUri = useMutation({
    mutationFn: (id: string) =>
      api<{ uri?: string }>(
        `/api/panel/proxies/${encodeURIComponent(id)}/reveal`,
        { method: 'POST' }
      ),
    onSuccess: async (data) => {
      const uri = data.uri || ''
      if (!uri) {
        toast.error('未取到地址')
        return
      }
      try {
        await navigator.clipboard.writeText(uri)
        toast.success('已复制完整代理地址（含账号密码），注意不要泄露')
      } catch {
        // 剪贴板 API 需要安全上下文（HTTPS 或 localhost），失败要说明白，
        // 而不是静默什么都没发生。这里也不把 uri 兜底渲染出来。
        toast.error('浏览器拒绝了剪贴板写入，请检查是否在 HTTPS 下访问')
      }
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const busy =
    probeOne.isPending ||
    geoOne.isPending ||
    remove.isPending ||
    saveConfig.isPending ||
    setEnabled.isPending ||
    bind.isPending ||
    unbind.isPending

  function toggleSort(next: ProxySortKey) {
    if (sortKey === next) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(next)
    // 换列时落 desc，对齐 index.html:2444 的 sortDir()。
    setSortDir('desc')
  }

  return (
    <PageHeader
      title={VIEW_TITLES.proxies}
      extra={
        <>
          <Button
            variant='outline'
            title='通过每条代理查一下出口 IP 在哪个国家、城市、时区'
            onClick={() => geoAll.mutate()}
            disabled={geoAll.isPending}
            loading={geoAll.isPending}
          >
            查所有位置
          </Button>
          <Button
            variant='outline'
            title='只检查能不能连上代理，不会访问官方'
            onClick={() => probeAll.mutate()}
            disabled={probeAll.isPending}
            loading={probeAll.isPending}
          >
            检查全部连通
          </Button>
        </>
      }
    >
      <QueryGate
        loading={px.isLoading}
        error={px.error || (px.data?.error ? new Error(px.data.error) : null)}
        skeleton={
          <div>
            <CardGridSkeleton
              cards={4}
              className='mb-4 grid gap-3 sm:grid-cols-4'
            />
            <SectionSkeleton
              className='mb-4'
              titleWidth='w-28'
              showDescription={false}
              rows={2}
            />
            <TableSkeleton rows={8} columns={4} />
          </div>
        }
      >
        <ProxySummary
          total={total}
          totals={tot}
          slotsUsed={slotsUsed}
          slotsCap={slotsCap}
        />
        <ProxyPoolControls
          bindLimit={bindLimit}
          probeMin={probeMin}
          raw={raw}
          importing={importPx.isPending}
          onBindLimitChange={(value) =>
            saveConfig.mutate({ bind_limit: value })
          }
          onProbeMinChange={(value) =>
            saveConfig.mutate({ probe_interval_min: value })
          }
          dnsPrimary={String(cfg.dns_primary || 'auto')}
          onDnsPrimaryChange={(value) =>
            saveConfig.mutate({ dns_primary: value })
          }
          followProxyTimezone={cfg.follow_proxy_timezone !== false}
          onFollowProxyTimezoneChange={(value) =>
            saveConfig.mutate({ follow_proxy_timezone: value })
          }
          onRawChange={setRaw}
          onImport={() => importPx.mutate()}
          onAddLocal={() => addLocal.mutate()}
          addingLocal={addLocal.isPending}
          hasLocal={list.some(
            (item) =>
              item.kind === 'local' ||
              item.scheme === 'local' ||
              item.id === 'px-local'
          )}
        />
        <ProxyTable
          rows={rows}
          vms={vms}
          bindLimit={bindLimit}
          busy={busy}
          sortKey={sortKey}
          sortDir={sortDir}
          copyingId={copyUri.isPending ? copyUri.variables : ''}
          onToggleSort={toggleSort}
          onProbe={(id) => probeOne.mutate(id)}
          onGeo={(id) => geoOne.mutate(id)}
          onDelete={setDelId}
          onEdit={setEditId}
          onCopy={(id) => copyUri.mutate(id)}
          onToggleEnabled={(item) => {
            if (!item.id) return
            setEnabled.mutate({ id: item.id, on: item.enabled === false })
          }}
          onBind={(id, vmId) => bind.mutate({ id, vmId })}
          onUnbind={(id, vmId) => setUnbindTarget({ id, vmId })}
        />
      </QueryGate>
      <ProxyEditDialog
        proxy={editing}
        onOpenChange={(open) => !open && setEditId('')}
      />
      <ConfirmDialog
        open={!!unbindTarget}
        onOpenChange={() => setUnbindTarget(null)}
        title='解除这个账号的代理？'
        desc={`${
          vms.find((v) => v.id === unbindTarget?.vmId)?.name ||
          unbindTarget?.vmId ||
          ''
        } 解除后发不出请求，直到重新绑一条代理。`}
        confirmText='解除绑定'
        cancelBtnText='取消'
        destructive
        isLoading={unbind.isPending}
        handleConfirm={() => {
          if (unbindTarget) unbind.mutate(unbindTarget)
        }}
      />
      <ConfirmDialog
        open={!!delId}
        onOpenChange={() => setDelId('')}
        title='删除这条代理？'
        desc={
          delBound
            ? `有 ${delBound} 个账号在用它，删除后这些账号发不出请求，直到重新绑代理。无法恢复。`
            : '删除后无法恢复，需要时要重新添加。'
        }
        confirmText='删除代理'
        cancelBtnText='取消'
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => {
          if (delId) remove.mutate(delId)
        }}
      />
    </PageHeader>
  )
}
