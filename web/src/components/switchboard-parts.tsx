import { expiresAtToMs, resetCountdown } from '@/lib/fable-status'
import { cn } from '@/lib/utils'

/**
 * 交换台的公共零件：灯、分组插线、额度刻度尺。
 * 总览页和账号页共用，保证同一件事在全站长一个样子。
 */

export type LampTone = 'red' | 'amber' | null
export type CordKey = 'pro' | 'max' | 'codex' | 'other'

const CORD_BG: Record<CordKey, string> = {
  pro: 'bg-cord-pro',
  max: 'bg-cord-max',
  codex: 'bg-cord-codex',
  other: 'bg-muted-foreground/50',
}

/** 一盏灯。不亮时是暗色玻璃；亮时琥珀 / 红。 */
export function Lamp({
  tone,
  className,
}: {
  tone: LampTone
  className?: string
}) {
  return (
    <span
      aria-hidden='true'
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-full ring-1 ring-black/40',
        tone === 'red'
          ? 'bg-[radial-gradient(circle_at_35%_35%,oklch(0.9_0.08_40),var(--lamp-red)_60%)]'
          : tone === 'amber'
            ? 'bg-[radial-gradient(circle_at_35%_35%,oklch(0.95_0.08_85),var(--lamp-amber)_60%)]'
            : 'bg-lamp-off',
        className
      )}
    />
  )
}

/** 分组插线：一小段彩色线 + 分组名。分组身份只靠线色，不给整行上色。 */
export function Cord({
  cord,
  name,
  lit,
}: {
  cord: CordKey
  name: string
  lit?: boolean
}) {
  return (
    <span className='inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'>
      <span
        aria-hidden='true'
        className={cn(
          'h-[3px] w-4 shrink-0 rounded-full transition-colors',
          lit ? 'bg-lamp-green' : CORD_BG[cord]
        )}
      />
      <span className='truncate'>{name}</span>
    </span>
  )
}

/** 账号名标签条：象牙底深色字，像面板上贴的名牌。 */
export function LabelStrip({
  children,
  dim,
  className,
}: {
  children: React.ReactNode
  dim?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-block max-w-full truncate rounded-[3px] border border-brass-dim bg-ivory px-2 py-0.5 text-[13px] font-semibold text-ivory-ink shadow-[0_1px_1px_oklch(0_0_0/0.3)]',
        dim && 'opacity-60',
        className
      )}
    >
      {children}
    </span>
  )
}

/**
 * 额度刻度尺：10 格刻度，填充 = 已用。正常时是中性色，
 * 用到 85% 以上才变琥珀，满了变红——颜色只在需要注意时出现。
 */
export function QuotaScale({
  label,
  used,
  reset,
  now,
  extra,
  showIdleReset,
}: {
  label: string
  used: number
  reset: unknown
  now: number
  /** 标签行右侧的补充信息（例如这个窗口花了多少钱）。 */
  extra?: React.ReactNode
  /** 已用为 0 但窗口已打开（重置时间在未来）时也显示倒计时，用于 5 小时窗口。 */
  showIdleReset?: boolean
}) {
  const left = Math.max(0, 100 - used)
  const tone =
    used >= 100 ? 'text-lamp-red' : used >= 85 ? 'text-lamp-amber' : ''
  const fill =
    used >= 100
      ? 'bg-lamp-red'
      : used >= 85
        ? 'bg-lamp-amber'
        : 'bg-foreground/55'
  const countdown =
    used > 0 || (showIdleReset && expiresAtToMs(reset) > now)
      ? resetCountdown(reset, now)
      : null
  return (
    <div className='min-w-0'>
      <div className='flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground'>
        <span className='flex min-w-0 items-baseline gap-1.5'>
          <span className='shrink-0'>{label}</span>
          {extra}
        </span>
        <span className={cn('shrink-0 tabular-nums', tone)}>
          剩 <b className='font-semibold'>{left.toFixed(0)}%</b>
        </span>
      </div>
      <div
        role='img'
        aria-label={`${label}额度剩 ${left.toFixed(0)}%${countdown ? `，${countdown} 后恢复` : ''}`}
        className='relative mt-1 h-2.5 overflow-hidden rounded-[2px] bg-muted'
      >
        <span
          className={cn(
            'absolute inset-y-0 start-0 transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none',
            fill
          )}
          style={{ width: `${Math.min(100, used)}%` }}
        />
        {/* 刻度：每 10% 一道发丝线 */}
        <span
          aria-hidden='true'
          className='absolute inset-0 bg-[repeating-linear-gradient(90deg,transparent_0,transparent_calc(10%-1px),var(--background)_calc(10%-1px),var(--background)_10%)] opacity-70'
        />
      </div>
      <div className='mt-0.5 h-3.5 text-[10.5px] text-muted-foreground/80 tabular-nums'>
        {countdown ? `${countdown} 后恢复` : null}
      </div>
    </div>
  )
}
