import { Link } from '@tanstack/react-router'
import type { ApiKeyItem } from '@/types/panel-keys'
import type { UsageAccountRow } from '@/types/panel-usage'
import { ArrowRight, KeyRound, X } from 'lucide-react'
import { fmtNum } from '@/lib/format'
import { cn } from '@/lib/utils'
import { vmTodayStats, vmWeekOutcome } from '@/lib/vm-usage'
import { useNow } from '@/hooks/use-now'
import { Button } from '@/components/ui/button'
import {
  Cord,
  Lamp,
  LabelStrip,
  QuotaScale,
} from '@/components/switchboard-parts'
import { keyIsDead, maskApiKeyItem } from '@/features/keys/key-format'
import {
  type AccountGroupLite,
  type LineView,
  type StatusSummary,
  cordOf,
  reachableVmIds,
} from './switchboard-model'

/* ── 顶部状态句 ─────────────────────────────────────── */

export function StatusLine({
  summary,
  recentErrors,
  fableCool = 0,
}: {
  summary: StatusSummary
  recentErrors: number
  /** Fable（Max 专属模型）冷却中的账号数；其它模型不受影响，所以只提示不点灯。 */
  fableCool?: number
}) {
  return (
    <section
      aria-live='polite'
      className='rounded-md border border-brass-dim bg-card px-4 py-3.5'
    >
      <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
        <Lamp tone={summary.tone} className='size-3' />
        <p className='text-[17px] leading-snug font-semibold tracking-tight'>
          {summary.sentence}
        </p>
        {recentErrors > 0 ? (
          <Button variant='outline' size='sm' className='ms-auto' asChild>
            <Link to='/logs' search={{ kind: 'error' }}>
              看出错的请求
            </Link>
          </Button>
        ) : null}
      </div>
      {summary.lit.length ? (
        <ul className='mt-3 grid gap-1.5 border-t border-brass-dim pt-3'>
          {summary.lit.map((l) => (
            <li
              key={l.vm.id}
              className='flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm'
            >
              <Lamp tone={l.lamp} />
              <span className='font-medium'>{l.name}</span>
              <span
                className={cn(
                  'text-[13px]',
                  l.lamp === 'red' ? 'text-lamp-red' : 'text-lamp-amber'
                )}
              >
                {l.statusText}
              </span>
              <Link
                to='/vm/$id'
                params={{ id: l.vm.id }}
                className='ms-auto inline-flex items-center gap-1 text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'
              >
                去处理
                <ArrowRight className='size-3.5' />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {fableCool > 0 ? (
        <p className='mt-2 text-xs text-muted-foreground'>
          {fableCool} 个 Max 账号的 Fable 模型在冷却，暂时不接 Fable
          请求，其它模型照常。
        </p>
      ) : null}
      {summary.idleCount > 0 ? (
        <p className='mt-2 text-xs text-muted-foreground'>
          另有 {summary.idleCount} 个账号已暂停或还没导入凭证，不算问题。
        </p>
      ) : null}
    </section>
  )
}

/* ── 账号线 ─────────────────────────────────────────── */

function AccountLine({
  line,
  accounts,
  now,
  reach,
}: {
  line: LineView
  accounts?: UsageAccountRow[]
  now: number
  /** 选中 Key 时：true = 这个 Key 能用到，false = 用不到，undefined = 没选 Key */
  reach?: boolean
}) {
  const { vm } = line
  const today = vmTodayStats(vm, accounts)
  const week = vmWeekOutcome(vm, accounts)
  const recent = line.idle
    ? line.statusText
    : `今天 ${fmtNum(today.req)} 次请求${week.known && week.fail > 0 ? ` · 近 7 天失败 ${fmtNum(week.fail)} 次` : ''}`
  return (
    <li
      className={cn(
        'transition-opacity duration-200',
        reach === false && 'opacity-35'
      )}
    >
      <Link
        to='/vm/$id'
        params={{ id: vm.id }}
        className='group grid gap-x-5 gap-y-2 px-4 py-3 outline-none hover:bg-accent/50 focus-visible:bg-accent/60 md:grid-cols-[minmax(11rem,1.1fr)_minmax(0,1fr)_minmax(0,1fr)]'
      >
        <div className='flex min-w-0 items-start gap-3'>
          <Lamp tone={line.lamp} className='mt-1.5' />
          <div className='min-w-0'>
            <LabelStrip dim={line.idle}>{line.name}</LabelStrip>
            <div className='mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5'>
              <Cord cord={line.cord} name={line.groupName} lit={reach} />
            </div>
            <p
              className={cn(
                'mt-1 truncate text-xs',
                line.lamp === 'red'
                  ? 'text-lamp-red'
                  : line.lamp === 'amber'
                    ? 'text-lamp-amber'
                    : 'text-muted-foreground'
              )}
            >
              {line.lamp ? `${line.statusText} · ` : ''}
              {recent}
            </p>
          </div>
        </div>
        <QuotaScale
          label='5 小时'
          used={line.used5h}
          reset={vm.reset_5h}
          now={now}
        />
        <QuotaScale
          label='7 天'
          used={line.used7d}
          reset={vm.reset_7d}
          now={now}
        />
      </Link>
    </li>
  )
}

export function Switchboard({
  lines,
  accounts,
  selectedKey,
  groups,
}: {
  lines: LineView[]
  accounts?: UsageAccountRow[]
  selectedKey?: ApiKeyItem
  groups: AccountGroupLite[]
}) {
  const now = useNow()
  const reach = selectedKey ? reachableVmIds(selectedKey, groups) : null
  return (
    <section
      aria-label='账号'
      className='min-w-0 overflow-hidden rounded-md border border-brass-dim bg-card'
    >
      <header className='flex items-center justify-between gap-2 border-b border-brass-dim px-4 py-2.5'>
        <h3 className='text-sm font-semibold'>账号</h3>
        <Link
          to='/vm'
          className='text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'
        >
          全部账号和操作
        </Link>
      </header>
      {lines.length ? (
        <ul className='divide-y divide-brass-dim'>
          {lines.map((line) => (
            <AccountLine
              key={line.vm.id}
              line={line}
              accounts={accounts}
              now={now}
              reach={reach ? reach.has(line.vm.id) : undefined}
            />
          ))}
        </ul>
      ) : (
        <div className='px-4 py-10 text-center text-sm text-muted-foreground'>
          还没有账号。点右上角「导入账号」，贴入 Setup Token 或 OAuth
          凭证就能开始用。
        </div>
      )}
    </section>
  )
}

/* ── Key 面板 ───────────────────────────────────────── */

export function KeyPatchPanel({
  keys,
  groups,
  selectedId,
  onSelect,
}: {
  keys: ApiKeyItem[]
  groups: AccountGroupLite[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const selected = keys.find((k) => k.id === selectedId)
  const reachCount = selected ? reachableVmIds(selected, groups).size : 0
  return (
    <section
      aria-label='调用 Key'
      className='min-w-0 overflow-hidden rounded-md border border-brass-dim bg-card'
    >
      <header className='flex items-center justify-between gap-2 border-b border-brass-dim px-4 py-2.5'>
        <h3 className='text-sm font-semibold'>调用 Key</h3>
        <Link
          to='/keys'
          className='text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'
        >
          管理 Key 和分组
        </Link>
      </header>
      {keys.length ? (
        <>
          <p className='px-4 pt-2.5 text-xs text-muted-foreground'>
            点一个 Key，左边会标出它能用到哪些账号。
          </p>
          <ul className='grid gap-0.5 p-2'>
            {keys.map((k) => {
              const active = k.id === selectedId
              const dead = keyIsDead(k)
              const groupName = k.group_name || '没绑分组'
              return (
                <li key={k.id}>
                  <button
                    type='button'
                    aria-pressed={active}
                    onClick={() => onSelect(active ? null : k.id)}
                    className={cn(
                      'grid w-full gap-0.5 rounded-[4px] px-2.5 py-2 text-start outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring',
                      active && 'bg-accent'
                    )}
                  >
                    <span className='flex items-center gap-2'>
                      <KeyRound className='size-3.5 shrink-0 text-muted-foreground' />
                      <span
                        className={cn(
                          'truncate text-[13px] font-medium',
                          dead && 'text-muted-foreground line-through'
                        )}
                      >
                        {k.name || maskApiKeyItem(k)}
                      </span>
                      {dead ? (
                        <span className='ms-auto text-[11px] text-muted-foreground'>
                          {k.status === 'disabled' ? '已停用' : '已过期'}
                        </span>
                      ) : null}
                    </span>
                    <span className='ps-5.5'>
                      <Cord
                        cord={cordOf(groupName)}
                        name={groupName}
                        lit={active && reachCount > 0}
                      />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {selected ? (
            <div className='flex items-center gap-2 border-t border-brass-dim px-4 py-2.5 text-xs'>
              <span className='text-muted-foreground'>
                {reachCount
                  ? `「${selected.name || '这个 Key'}」能用到 ${reachCount} 个账号`
                  : `「${selected.name || '这个 Key'}」现在用不到任何账号，检查它绑的分组`}
              </span>
              <Button
                variant='ghost'
                size='icon'
                className='ms-auto size-6'
                onClick={() => onSelect(null)}
                aria-label='取消选中'
              >
                <X className='size-3.5' />
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <div className='px-4 py-8 text-center text-sm text-muted-foreground'>
          还没有调用 Key。去「Key 和分组」新建一个，给 Sub2API 等下游使用。
        </div>
      )}
    </section>
  )
}
