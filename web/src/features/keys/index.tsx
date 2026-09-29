import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { VIEW_TITLES } from '@/config/nav'
import type { ApiKeyItem } from '@/types/panel-keys'
import { Copy, MoreHorizontal, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { fmtNum, fmtUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { TableSkeleton } from '@/components/page-skeletons'
import { QueryGate } from '@/components/query-gate'
import { Cord, Lamp, type CordKey } from '@/components/switchboard-parts'
import { meQueryOptions } from '@/features/auth/queries'
import { apiKeysQueryOptions } from '@/features/keys/queries'
import { GroupsDialog } from './groups-dialog'
import { groupsQueryOptions, type AccountGroup } from './groups-query'
import {
  keyExpiryText,
  keyIsDead,
  keyQuotaLabel,
  keyQuotaPct,
  keyStatusTone,
  maskApiKeyItem,
  plaintextFromPayload,
} from './key-format'
import { KeyLimitsDialog } from './key-limits-dialog'
import { keyLimitsPayload, type KeyLimitsDraft } from './key-payload'
import { KeyRevealDialog, type RevealedKey } from './key-reveal-dialog'

/** 分组名里带 Max / Pro / GPT 时给对应的线色，和总览页一致。 */
function cordOf(name: string): CordKey {
  const n = name.toLowerCase()
  if (/max/.test(n)) return 'max'
  if (/pro/.test(n)) return 'pro'
  if (/gpt|codex|openai/.test(n)) return 'codex'
  return 'other'
}

/**
 * Key 和分组。左：每个 Key 一行，写清它接到哪个分组、能用几个账号、用了多少；
 * 右：分组一览（组里有哪些账号、几个 Key 在用）。
 */
export function KeysPage() {
  const qc = useQueryClient()
  const q = useQuery(apiKeysQueryOptions())
  const groups = useQuery(groupsQueryOptions())
  const me = useQuery(meQueryOptions())
  const isAdmin = me.data?.role === 'admin'
  const [groupsOpen, setGroupsOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editId, setEditId] = useState('')
  const [delId, setDelId] = useState('')
  const [rotateId, setRotateId] = useState('')
  const [revealed, setRevealed] = useState<RevealedKey | null>(null)
  const keys = q.data?.keys || []
  const editing = keys.find((k) => k.id === editId) || null
  const rotating = keys.find((k) => k.id === rotateId) || null
  const deleting = keys.find((k) => k.id === delId) || null
  const refresh = () =>
    qc.invalidateQueries({ queryKey: apiKeysQueryOptions().queryKey })

  const create = useMutation({
    mutationFn: (draft: KeyLimitsDraft) => {
      const body = keyLimitsPayload(draft, 'create')
      return api<unknown>('/api/panel/api-keys', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    },
    onSuccess: async (data) => {
      const key = plaintextFromPayload(data)
      setCreateOpen(false)
      if (key) {
        setRevealed({ title: '新 Key 已生成', name: draftName(data), key })
      } else {
        toast.success('Key 已创建')
      }
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const edit = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: KeyLimitsDraft }) =>
      api(`/api/panel/api-keys/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(keyLimitsPayload(draft, 'edit')),
      }),
    onSuccess: async () => {
      toast.success('Key 设置已保存')
      setEditId('')
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const toggle = useMutation({
    mutationFn: ({ id, enable }: { id: string; enable: boolean }) =>
      api(`/api/panel/api-keys/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: enable ? 'active' : 'disabled' }),
      }),
    onSuccess: async (_data, vars) => {
      toast.success(vars.enable ? 'Key 已重新启用' : 'Key 已停用')
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const resetQuota = useMutation({
    mutationFn: (id: string) =>
      api(`/api/panel/api-keys/${encodeURIComponent(id)}/reset-quota`, {
        method: 'POST',
      }),
    onSuccess: async () => {
      toast.success('用量已清零')
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const reveal = useMutation({
    mutationFn: (id: string) =>
      api<unknown>(`/api/panel/api-keys/${encodeURIComponent(id)}/reveal`, {
        method: 'POST',
      }),
    onError: (error: Error) => toast.error(error.message),
  })

  const rotate = useMutation({
    mutationFn: (id: string) =>
      api<unknown>(`/api/panel/api-keys/${encodeURIComponent(id)}/rotate`, {
        method: 'POST',
      }),
    onSuccess: async (data) => {
      const key = plaintextFromPayload(data)
      setRotateId('')
      if (key)
        setRevealed({ title: '已换成新 Key', name: draftName(data), key })
      else toast.success('已换成新 Key')
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/api/panel/api-keys/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: async () => {
      toast.success('Key 已删除')
      setDelId('')
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  async function viewPlain(k: ApiKeyItem) {
    try {
      const data = await reveal.mutateAsync(k.id)
      const key = plaintextFromPayload(data)
      if (!key) {
        toast.error('这个 Key 的原文找不回来，需要的话请换新 Key')
        return
      }
      setRevealed({ title: '查看 Key', name: k.name, id: k.id, key })
    } catch {
      /* onError 已 toast */
    }
  }

  async function copyPlain(k: ApiKeyItem) {
    try {
      const data = await reveal.mutateAsync(k.id)
      const key = plaintextFromPayload(data)
      if (!key) {
        toast.error('这个 Key 的原文找不回来，需要的话请换新 Key')
        return
      }
      try {
        await navigator.clipboard.writeText(key)
        toast.success('Key 已复制，注意不要泄露')
      } catch {
        toast.error('复制失败，请点「查看」手动复制')
      }
    } catch {
      /* onError 已 toast */
    }
  }

  const groupItems = groups.data?.items || []
  const slots = groups.data?.slots || []

  return (
    <PageHeader
      title={VIEW_TITLES.keys}
      extra={
        <Button size='sm' onClick={() => setCreateOpen(true)}>
          <Plus />
          新建 Key
        </Button>
      }
    >
      <p className='-mt-2 mb-4 max-w-3xl text-sm text-muted-foreground'>
        Key 是给 Sub2API 等下游调用本服务用的密码。每个 Key
        接到一个账号分组，只会用那个分组里的账号，组里没有能用的账号时直接报错，不会借用别的分组。
      </p>
      <div className='grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]'>
        <section
          aria-label='调用 Key'
          className='min-w-0 overflow-hidden rounded-md border border-brass-dim bg-card'
        >
          <header className='flex items-center justify-between gap-2 border-b border-brass-dim px-4 py-2.5'>
            <h3 className='text-sm font-semibold'>调用 Key</h3>
            <span className='text-xs text-muted-foreground tabular-nums'>
              {keys.length} 个
            </span>
          </header>
          <QueryGate
            loading={q.isLoading}
            error={q.error}
            skeleton={<TableSkeleton rows={4} columns={4} />}
          >
            {keys.length === 0 ? (
              <EmptyState
                reason='还没有 Key。新建一个，把它填到 Sub2API 的上游配置里就能用。'
                actionLabel='新建 Key'
                onAction={() => setCreateOpen(true)}
              />
            ) : (
              <ul className='divide-y divide-brass-dim'>
                {keys.map((k) => (
                  <KeyLine
                    key={k.id}
                    item={k}
                    group={groupItems.find((g) => g.id === k.group_id)}
                    busy={
                      toggle.isPending ||
                      resetQuota.isPending ||
                      reveal.isPending ||
                      rotate.isPending
                    }
                    onView={() => void viewPlain(k)}
                    onCopy={() => void copyPlain(k)}
                    onRotate={() => setRotateId(k.id)}
                    onEdit={() => setEditId(k.id)}
                    onToggle={() =>
                      toggle.mutate({
                        id: k.id,
                        enable: k.status === 'disabled',
                      })
                    }
                    onReset={() => resetQuota.mutate(k.id)}
                    onDelete={() => setDelId(k.id)}
                  />
                ))}
              </ul>
            )}
          </QueryGate>
        </section>

        <section
          aria-label='账号分组'
          className='min-w-0 overflow-hidden rounded-md border border-brass-dim bg-card'
        >
          <header className='flex items-center justify-between gap-2 border-b border-brass-dim px-4 py-2.5'>
            <h3 className='text-sm font-semibold'>账号分组</h3>
            {isAdmin ? (
              <Button
                size='sm'
                variant='outline'
                className='h-7'
                onClick={() => setGroupsOpen(true)}
              >
                管理分组
              </Button>
            ) : null}
          </header>
          {groupItems.length ? (
            <ul className='divide-y divide-brass-dim'>
              {groupItems.map((g) => {
                const members = (g.vm_ids || []).map(
                  (id) => slots.find((s) => s.id === id)?.name || id
                )
                const keyCount = keys.filter((k) => k.group_id === g.id).length
                const off = g.status !== 'active'
                return (
                  <li key={g.id} className='px-4 py-3'>
                    <div className='flex items-center gap-2'>
                      <Cord cord={cordOf(g.name)} name='' />
                      <span
                        className={cn(
                          'text-sm font-semibold',
                          off && 'text-muted-foreground line-through'
                        )}
                      >
                        {g.name}
                      </span>
                      {off ? (
                        <span className='text-xs text-muted-foreground'>
                          已停用
                        </span>
                      ) : null}
                      <span className='ms-auto text-xs text-muted-foreground tabular-nums'>
                        {keyCount} 个 Key
                      </span>
                    </div>
                    {g.description ? (
                      <p className='mt-0.5 text-xs text-muted-foreground'>
                        {g.description}
                      </p>
                    ) : null}
                    <p
                      className={cn(
                        'mt-1.5 text-xs',
                        members.length
                          ? 'text-foreground/85'
                          : 'text-lamp-amber'
                      )}
                    >
                      {members.length
                        ? members.join('、')
                        : '组里没有账号，接到这个分组的 Key 会调用失败'}
                    </p>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className='px-4 py-6 text-sm text-muted-foreground'>
              {groups.isLoading ? '正在加载分组…' : '还没有分组。'}
            </p>
          )}
        </section>
      </div>

      <KeyLimitsDialog
        groups={groupItems}
        canAssignGroup={isAdmin}
        mode='create'
        open={createOpen}
        onOpenChange={setCreateOpen}
        pending={create.isPending}
        onSubmit={(draft) => create.mutate(draft)}
      />
      <KeyLimitsDialog
        groups={groupItems}
        canAssignGroup={isAdmin}
        mode='edit'
        open={!!editId}
        onOpenChange={(open) => {
          if (!open) setEditId('')
        }}
        initial={editing}
        pending={edit.isPending}
        onSubmit={(draft) => {
          if (!editId) return
          edit.mutate({ id: editId, draft })
        }}
      />
      {isAdmin && (
        <GroupsDialog open={groupsOpen} onOpenChange={setGroupsOpen} />
      )}
      <KeyRevealDialog value={revealed} onClose={() => setRevealed(null)} />
      <ConfirmDialog
        open={!!rotateId}
        onOpenChange={() => setRotateId('')}
        title='换一个新 Key？'
        desc={
          <div className='grid gap-1.5 text-sm'>
            <p>「{rotating?.name || rotateId}」</p>
            <p className='text-destructive'>
              旧 Key 会马上失效，还在用旧 Key 的下游（比如
              Sub2API）会立刻调用失败，要把新 Key 填回去。
            </p>
            <p>名称、分组、限额和用量统计都保留。</p>
          </div>
        }
        confirmText='换新 Key'
        cancelBtnText='取消'
        isLoading={rotate.isPending}
        handleConfirm={() => {
          if (rotateId) rotate.mutate(rotateId)
        }}
      />
      <ConfirmDialog
        open={!!delId}
        onOpenChange={() => setDelId('')}
        title='删除这个 Key？'
        desc={
          <div className='grid gap-1.5 text-sm'>
            <p>「{deleting?.name || delId}」</p>
            <p className='text-destructive'>
              删除后马上失效，用它的下游会立刻调用失败，无法恢复。只想暂时不让用，可以选「停用」。
            </p>
          </div>
        }
        confirmText='删除 Key'
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

function draftName(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const rec = payload as Record<string, unknown>
  if (typeof rec.name === 'string') return rec.name
  const item = rec.item
  if (item && typeof item === 'object') {
    const name = (item as Record<string, unknown>).name
    if (typeof name === 'string') return name
  }
  return undefined
}

function KeyLine({
  item,
  group,
  busy,
  onView,
  onCopy,
  onRotate,
  onEdit,
  onToggle,
  onReset,
  onDelete,
}: {
  item: ApiKeyItem
  group?: AccountGroup
  busy: boolean
  onView: () => void
  onCopy: () => void
  onRotate: () => void
  onEdit: () => void
  onToggle: () => void
  onReset: () => void
  onDelete: () => void
}) {
  const active = item.status !== 'disabled'
  const dead = keyIsDead(item)
  const expiry = keyExpiryText(item)
  const pct = keyQuotaPct(item)
  const conc = Number(item.max_concurrency || 0)
  const rpm = Number(item.rpm || 0)
  const usd = Number(item.quota_usd || 0)
  const groupName = item.group_name || group?.name || '分组已不存在'
  const reach =
    group && group.status === 'active' ? group.vm_ids?.length || 0 : 0
  const status = keyStatusTone(item)
  return (
    <li className='grid gap-x-5 gap-y-2 px-4 py-3 lg:grid-cols-[minmax(12rem,1.1fr)_minmax(10rem,1fr)_minmax(9rem,0.8fr)_auto] lg:items-center'>
      <div className='min-w-0'>
        <div className='flex min-w-0 items-center gap-2'>
          <Lamp
            tone={status.cls === 'bad' ? 'red' : null}
            className={cn(status.cls === 'off' && 'opacity-40')}
          />
          <span
            className={cn(
              'truncate text-sm font-semibold',
              dead && 'text-muted-foreground line-through'
            )}
          >
            {item.name || 'default'}
          </span>
          {dead ? (
            <span className='shrink-0 text-xs text-muted-foreground'>
              {status.text}
            </span>
          ) : null}
        </div>
        <div className='mt-1 flex flex-wrap items-center gap-1'>
          <code className='font-mono text-xs text-muted-foreground'>
            {maskApiKeyItem(item)}
          </code>
          {item.revealable ? (
            <>
              <Button
                size='sm'
                variant='ghost'
                className='h-6 px-1.5 text-xs'
                disabled={busy}
                onClick={onCopy}
              >
                <Copy className='size-3' />
                复制
              </Button>
              <Button
                size='sm'
                variant='ghost'
                className='h-6 px-1.5 text-xs'
                disabled={busy}
                onClick={onView}
              >
                查看
              </Button>
            </>
          ) : (
            <span
              className='text-[11px] text-muted-foreground'
              title='这个 Key 只保存了指纹，原文找不回来；需要原文时用「换新 Key」'
            >
              原文不可查看
            </span>
          )}
        </div>
      </div>

      <div className='min-w-0'>
        <Cord cord={cordOf(groupName)} name={groupName} />
        <p
          className={cn(
            'mt-1 text-xs',
            reach ? 'text-muted-foreground' : 'text-lamp-amber'
          )}
        >
          {item.category === 'api'
            ? 'API 直连（不走账号分组）'
            : reach
              ? `能用 ${reach} 个账号`
              : '现在用不到任何账号'}
        </p>
      </div>

      <div className='min-w-0 text-xs text-muted-foreground tabular-nums'>
        <div>
          已调用 {fmtNum(item.requests || 0)} 次
          {item.inflight ? ` · ${item.inflight} 个进行中` : ''}
        </div>
        <div className='mt-0.5'>
          次数 {keyQuotaLabel(item)}
          {usd
            ? ` · 金额 ${fmtUsd(item.quota_usd_used || 0, 2)} / ${fmtUsd(usd, 2)}`
            : ''}
        </div>
        {pct != null ? <Progress value={pct} className='mt-1 h-1' /> : null}
        <div className='mt-0.5'>
          同时 {conc || '不限'} · 每分钟 {rpm || '不限'} ·{' '}
          <span className={cn(expiry.expired && 'text-lamp-red')}>
            {expiry.expired
              ? '已过期'
              : expiry.text === '永久'
                ? '永久有效'
                : `${expiry.text}过期`}
          </span>
        </div>
      </div>

      <div className='flex items-center justify-end gap-1'>
        <Button
          size='sm'
          variant='outline'
          className='h-7'
          disabled={busy}
          onClick={onEdit}
        >
          改设置
        </Button>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              size='icon'
              variant='ghost'
              className='size-7'
              disabled={busy}
              aria-label={`${item.name || '这个 Key'} 的更多操作`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-52'>
            <DropdownMenuItem onSelect={onToggle}>
              {active ? '停用（暂时不让用）' : '重新启用'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onReset}>用量清零</DropdownMenuItem>
            <DropdownMenuItem onSelect={onRotate}>换新 Key…</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant='destructive' onSelect={onDelete}>
              删除…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}
