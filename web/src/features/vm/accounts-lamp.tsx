import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { accountStatus } from '@/lib/vm-status'
import { vmsListQueryOptions } from './queries'

type LampState = { tone: 'red' | 'amber' | null; count: number }

/**
 * 交换台上的一盏灯：账号全部正常时保持暗（不渲染），
 * 有账号需要处理时亮琥珀，有账号坏了亮红，旁边写需要看的个数。
 * 「调度关」「无凭证」是站长主动的状态，不点灯。
 */
function useAccountsLamp(): LampState {
  const q = useQuery({ ...vmsListQueryOptions(), refetchInterval: 60_000 })
  let bad = 0
  let attention = 0
  for (const vm of q.data?.items || []) {
    const cls = accountStatus(vm).cls
    if (cls === 'bad') bad += 1
    else if (cls === 'warn' || cls === 'caution') attention += 1
  }
  if (bad) return { tone: 'red', count: bad + attention }
  if (attention) return { tone: 'amber', count: attention }
  return { tone: null, count: 0 }
}

export function AccountsLamp() {
  const { tone, count } = useAccountsLamp()
  if (!tone) return null
  const label =
    tone === 'red' ? `${count} 个账号有问题` : `${count} 个账号需要留意`
  return (
    <span
      role='img'
      aria-label={label}
      title={label}
      className={cn(
        'ms-auto flex items-center gap-1.5 text-xs font-medium tabular-nums',
        tone === 'red' ? 'text-lamp-red' : 'text-lamp-amber',
        // 当前页是实心标签条，数字改用条上的字色才看得清
        'in-data-[active=true]:text-primary-foreground dark:in-data-[active=true]:text-ivory-ink',
        // 折叠成图标栏时，灯压在图标右上角，数字收起
        'group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:end-1 group-data-[collapsible=icon]:top-1'
      )}
    >
      <span className='group-data-[collapsible=icon]:hidden'>{count}</span>
      <span
        aria-hidden='true'
        className={cn(
          'size-2 rounded-full ring-1 ring-black/30',
          tone === 'red' ? 'bg-lamp-red' : 'bg-lamp-amber'
        )}
      />
    </span>
  )
}
