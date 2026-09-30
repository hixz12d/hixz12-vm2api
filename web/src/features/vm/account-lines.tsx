import { Link } from '@tanstack/react-router'
import type { UsageAccountRow } from '@/types/panel-usage'
import type { Vm } from '@/types/panel-vm'
import { MoreHorizontal } from 'lucide-react'
import { credTypeLabel, credTypeOf } from '@/lib/cred-type'
import { fmtNum, fmtUsd, usedPctOf } from '@/lib/format'
import { cn } from '@/lib/utils'
import { isCodexVm } from '@/lib/vm-kind'
import {
  accountStatus,
  claudeTier,
  vmCircuit,
  vmCircuitTitle,
  vmCooldown,
  vmCooldownTitle,
} from '@/lib/vm-status'
import { vmTodayStats, vmWeekOutcome, vmWindowCosts } from '@/lib/vm-usage'
import { vmTotalCost } from '@/lib/vm-usage'
import { useNow } from '@/hooks/use-now'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Cord,
  LabelStrip,
  Lamp,
  QuotaScale,
  type CordKey,
  type LampTone,
} from '@/components/switchboard-parts'
import { ProxyChip } from '@/features/proxies/proxy-chip'
import { OpenaiQuotaActions } from '@/features/vm/openai-quota-actions'
import {
  SchedulableSwitch,
  vmSchedulableProps,
} from '@/features/vm/schedulable-switch'
import { fableRow } from '@/features/vm/usage-meter'
import { useVmActions } from '@/features/vm/vm-actions-context'

/** 账号的灯：坏了红、要留意琥珀；正常、主动暂停、没凭证都不亮。 */
export function accountLamp(vm: Vm): {
  lamp: LampTone
  text: string
  idle: boolean
} {
  const s = accountStatus(vm)
  if (s.cls === 'bad') return { lamp: 'red', text: s.text, idle: false }
  if (s.cls === 'warn' || s.cls === 'caution')
    return { lamp: 'amber', text: s.text, idle: false }
  if (s.cls === 'off') return { lamp: null, text: '已暂停调度', idle: true }
  if (s.cls === 'none') return { lamp: null, text: '还没导入凭证', idle: true }
  return { lamp: null, text: '正常', idle: false }
}

function planOf(vm: Vm): { label: string; cord: CordKey } {
  if (isCodexVm(vm)) return { label: 'GPT', cord: 'codex' }
  const t = claudeTier(vm)
  if (t.key === 'max') return { label: 'Claude Max', cord: 'max' }
  if (t.key === 'pro') return { label: 'Claude Pro', cord: 'pro' }
  return { label: 'Claude', cord: 'other' }
}

/**
 * 账号线列表。每行 = 一个账号：灯 + 名牌 + 套餐 + 出口 → 5 小时 / 7 天额度 →
 * 今天用量 → 调度开关和更多操作。点整行进详情。
 */
export function AccountLines({
  vms,
  accounts,
  onReset,
  onDelete,
  onClearCooldown,
}: {
  vms: Vm[]
  accounts?: UsageAccountRow[]
  onReset?: (vm: Vm) => void
  onDelete?: (vm: Vm) => void
  onClearCooldown?: (vm: Vm) => void
}) {
  const now = useNow()
  return (
    <ul className='divide-y divide-brass-dim overflow-hidden rounded-md border border-brass-dim bg-card'>
      {vms.map((vm) => (
        <AccountLine
          key={vm.id}
          vm={vm}
          accounts={accounts}
          now={now}
          onReset={onReset}
          onDelete={onDelete}
          onClearCooldown={onClearCooldown}
        />
      ))}
    </ul>
  )
}

function AccountLine({
  vm,
  accounts,
  now,
  onReset,
  onDelete,
  onClearCooldown,
}: {
  vm: Vm
  accounts?: UsageAccountRow[]
  now: number
  onReset?: (vm: Vm) => void
  onDelete?: (vm: Vm) => void
  onClearCooldown?: (vm: Vm) => void
}) {
  const actions = useVmActions()
  const { lamp, text, idle } = accountLamp(vm)
  const plan = planOf(vm)
  const today = vmTodayStats(vm, accounts)
  const week = vmWeekOutcome(vm, accounts)
  const costs = vmWindowCosts(vm, accounts)
  const fable = isCodexVm(vm) ? null : fableRow(vm)
  const tripped = Boolean(vmCircuit(vm))
  const cooling = tripped || Boolean(vmCooldown(vm))
  const credLabel = vm.has_token ? credTypeLabel(credTypeOf(vm)) : null
  const showQuota = Boolean(vm.has_token)

  return (
    <li className='group relative grid gap-x-5 gap-y-2 px-4 py-3 hover:bg-accent/40 lg:grid-cols-[minmax(14rem,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(8rem,0.7fr)_auto] lg:items-center'>
      {/* 整行可点：链接铺满，行内控件浮在其上 */}
      <Link
        to='/vm/$id'
        params={{ id: vm.id }}
        aria-label={`打开 ${vm.name || vm.id} 的详情`}
        className='absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
      />

      <div className='pointer-events-none relative flex min-w-0 items-start gap-3'>
        <Lamp tone={lamp} className='mt-1.5' />
        <div className='min-w-0'>
          <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
            <LabelStrip dim={idle}>{vm.name || vm.id}</LabelStrip>
            {vm.email && vm.email !== vm.name ? (
              <span
                className='truncate text-xs text-muted-foreground'
                title={vm.email}
              >
                {vm.email}
              </span>
            ) : null}
          </div>
          <div className='mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1'>
            <Cord cord={plan.cord} name={plan.label} />
            {credLabel ? (
              <span className='text-xs text-muted-foreground'>{credLabel}</span>
            ) : null}
            <ProxyChip vm={vm} compact className='text-xs' />
          </div>
          <p
            className={cn(
              'mt-1 truncate text-xs',
              lamp === 'red'
                ? 'text-lamp-red'
                : lamp === 'amber'
                  ? 'text-lamp-amber'
                  : 'text-muted-foreground'
            )}
            title={
              tripped
                ? vmCircuitTitle(vm)
                : vmCooldown(vm)
                  ? vmCooldownTitle(vm)
                  : undefined
            }
          >
            {text}
            {fable?.kind === 'note' ? ` · Fable ${fable.text}` : ''}
          </p>
        </div>
      </div>

      {showQuota ? (
        <>
          <div className='pointer-events-none relative'>
            <QuotaScale
              label='5 小时'
              used={usedPctOf(vm, '5h')}
              reset={vm.reset_5h}
              now={now}
              extra={
                costs.h5 ? (
                  <span className='tabular-nums opacity-80'>
                    {fmtUsd(costs.h5, 2)}
                  </span>
                ) : null
              }
            />
            {fable?.kind === 'bar' ? (
              <QuotaScale
                label='Fable'
                used={fable.pct}
                reset={vm.reset_7d_oi}
                now={now}
              />
            ) : null}
          </div>
          <div className='pointer-events-none relative'>
            <QuotaScale
              label='7 天'
              used={usedPctOf(vm, '7d')}
              reset={vm.reset_7d}
              now={now}
              extra={
                costs.d7 ? (
                  <span className='tabular-nums opacity-80'>
                    {fmtUsd(costs.d7, 2)}
                  </span>
                ) : null
              }
            />
          </div>
        </>
      ) : (
        <p className='pointer-events-none relative text-xs text-muted-foreground lg:col-span-2'>
          导入凭证后这里会显示额度。
        </p>
      )}

      <div className='pointer-events-none relative text-xs text-muted-foreground tabular-nums'>
        <div>
          今天{' '}
          <b className='font-semibold text-foreground'>{fmtNum(today.req)}</b>{' '}
          次 · {fmtUsd(today.today, 2)}
        </div>
        <div className='mt-0.5'>
          累计 {fmtUsd(vmTotalCost(vm, accounts), 2)}
          {week.known && week.fail > 0 ? (
            <span className='text-lamp-amber'>
              {' '}
              · 7 天失败 {fmtNum(week.fail)}
            </span>
          ) : null}
        </div>
      </div>

      <div className='relative flex items-center justify-end gap-1.5'>
        {isCodexVm(vm) ? <OpenaiQuotaActions vm={vm} compact /> : null}
        <label className='flex items-center gap-1.5 text-xs text-muted-foreground'>
          <span className='max-lg:hidden'>接请求</span>
          <SchedulableSwitch {...vmSchedulableProps(vm)} />
        </label>
        {onReset || onDelete || (onClearCooldown && cooling) ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                className='size-8'
                aria-label={`${vm.name || vm.id} 的更多操作`}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-56'>
              <DropdownMenuItem onSelect={() => actions.openDetail(vm)}>
                查看详情卡
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.openTest(vm)}>
                测试连接
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.openStats(vm)}>
                查看统计
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.openReauth(vm)}>
                重新授权
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {onClearCooldown && cooling ? (
                <DropdownMenuItem onSelect={() => onClearCooldown(vm)}>
                  解除冷却，马上恢复接请求
                </DropdownMenuItem>
              ) : null}
              {onReset ? (
                <>
                  {onClearCooldown && cooling ? (
                    <DropdownMenuSeparator />
                  ) : null}
                  <DropdownMenuItem
                    variant='destructive'
                    onSelect={() => onReset(vm)}
                  >
                    清空重建运行环境…
                  </DropdownMenuItem>
                </>
              ) : null}
              {onDelete ? (
                <DropdownMenuItem
                  variant='destructive'
                  onSelect={() => onDelete(vm)}
                >
                  删除这个账号…
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </li>
  )
}
