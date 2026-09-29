import { Lamp } from '@/components/switchboard-parts'

type ProxySummaryProps = {
  total: number
  totals: Record<string, unknown>
  slotsUsed: number
  slotsCap: number
}

/**
 * 出口代理状态句：一眼看出有没有坏掉的代理。
 * 数字仍全部给出（总数 / 能用 / 已绑 / 失效），只是不再做成四张卡片。
 */
export function ProxySummary(props: ProxySummaryProps) {
  const { total, totals: tot, slotsUsed, slotsCap } = props
  const ok = Number(tot.ok ?? 0)
  const dead = Number(tot.dead ?? 0)
  const full = slotsCap > 0 && slotsUsed >= slotsCap
  const tone = dead > 0 ? 'red' : full ? 'amber' : null
  const sentence = !total
    ? '还没有出口代理，在下面粘贴一条 SOCKS5 就能添加'
    : dead > 0
      ? `${dead} 条代理连不上，用它的账号现在发不出请求`
      : full
        ? '所有代理都绑满了，新账号需要先添加代理'
        : `${total} 条代理，${ok} 条正常`
  return (
    <section
      aria-live='polite'
      className='mb-4 rounded-md border border-brass-dim bg-card px-4 py-3'
    >
      <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
        <Lamp tone={tone} className='size-3' />
        <p className='text-[15px] font-semibold tracking-tight'>{sentence}</p>
      </div>
      <p className='mt-1 text-xs text-muted-foreground tabular-nums'>
        共 {total} 条 · 正常 {ok} · 连不上 {dead} · 已绑账号 {slotsUsed} /
        最多可绑 {slotsCap || '—'}
      </p>
    </section>
  )
}
