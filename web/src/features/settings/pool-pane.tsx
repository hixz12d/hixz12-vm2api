import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SettingRow } from '@/components/setting-row'

type PoolPaneProps = {
  pool: Record<string, unknown>
  failover: Record<string, unknown>
  onPoolChange: (next: Record<string, unknown>) => void
  onFailoverChange: (next: Record<string, unknown>) => void
}

export function PoolPane(props: PoolPaneProps) {
  const { pool, failover, onPoolChange, onFailoverChange } = props
  return (
    <Card>
      <CardHeader>
        <CardTitle>挑选账号</CardTitle>
        <p className='text-xs text-muted-foreground'>
          只对 Claude
          账号生效。账号有三种状态：开、暂时受限、关。「关」只有你手动拨；额度用完、被限流、冷却、连续出错都记为「暂时受限」，到时间或检查通过后会自动恢复。
        </p>
      </CardHeader>
      <CardContent className='divide-y'>
        <SettingRow
          label='挑选方式'
          desc='只影响新的对话，已经固定了账号的对话不变。推荐「智能评分」：综合 7 天额度快过期的程度、5 小时剩余额度和最近 5 分钟的活跃对话数来挑；你手动设的调度等级仍然优先。'
        >
          <Select
            value={String(pool.strategy || 'weighted-round-robin')}
            onValueChange={(strategy) => onPoolChange({ ...pool, strategy })}
          >
            <SelectTrigger className='w-56'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='smart'>智能评分</SelectItem>
              <SelectItem value='weighted-round-robin'>按权重轮流</SelectItem>
              <SelectItem value='round-robin'>依次轮流</SelectItem>
              <SelectItem value='lru'>最久没用的优先</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          label='同一个账号重试几次'
          desc='优先尝试其他空闲账号，没有时再回原账号重试；空响应单独处理，每个请求在同一账号最多执行 3 次'
        >
          <Input
            className='w-24'
            type='number'
            min={0}
            max={5}
            value={Number(failover.max_same_account_retries ?? 1)}
            onChange={(event) =>
              onFailoverChange({
                ...failover,
                max_same_account_retries: Number(event.target.value),
              })
            }
          />
        </SettingRow>
        <SettingRow label='原地重试间隔' desc='单位毫秒，默认 500'>
          <Input
            className='w-24'
            type='number'
            min={0}
            value={Number(failover.same_account_retry_delay_ms ?? 500)}
            onChange={(event) =>
              onFailoverChange({
                ...failover,
                same_account_retry_delay_ms: Number(event.target.value),
              })
            }
          />
        </SettingRow>
        <SettingRow
          label='连续出错几次就暂停'
          desc='一个账号连续返回服务器错误（5xx）这么多次，就暂时不给它派请求。529 和 401 不算'
        >
          <Input
            className='w-24'
            type='number'
            min={1}
            max={20}
            value={Number(pool.circuit_failure_threshold ?? 3)}
            onChange={(event) =>
              onPoolChange({
                ...pool,
                circuit_failure_threshold: Number(event.target.value),
              })
            }
          />
        </SettingRow>
        <SettingRow
          label='暂停多久'
          desc='单位毫秒，默认 30000。到时间后先放 1 个请求试试，成功才恢复'
        >
          <Input
            className='w-24'
            type='number'
            min={1000}
            value={Number(pool.circuit_open_ms ?? 30000)}
            onChange={(event) =>
              onPoolChange({
                ...pool,
                circuit_open_ms: Number(event.target.value),
              })
            }
          />
        </SettingRow>
        <SettingRow
          label='换账号的重试预算'
          desc='预算用完后，只尝试这个请求还没试过的账号，直到总时限'
        >
          <Input
            className='w-24'
            type='number'
            value={Number(failover.max_account_switches ?? 10)}
            onChange={(event) =>
              onFailoverChange({
                ...failover,
                max_account_switches: Number(event.target.value),
              })
            }
          />
        </SettingRow>
        <SettingRow
          label='总尝试预算'
          desc='预算用完后不再重复尝试同一账号，只尝试还没试过的账号，直到总时限'
        >
          <Input
            className='w-24'
            type='number'
            value={Number(failover.max_total_attempts ?? 12)}
            onChange={(event) =>
              onFailoverChange({
                ...failover,
                max_total_attempts: Number(event.target.value),
              })
            }
          />
        </SettingRow>
        <SettingRow
          label='每个账号最多排队几个请求'
          desc='账号忙时最多让多少个请求排队等它，默认 100'
        >
          <Input
            className='w-24'
            type='number'
            min={1}
            value={Number(pool.max_waiters_per_account ?? 100)}
            onChange={(event) =>
              onPoolChange({
                ...pool,
                max_waiters_per_account: Number(event.target.value),
              })
            }
          />
        </SettingRow>
        <SettingRow
          label='等固定账号最多等多久'
          desc='对话固定的账号正忙时最多等多久再换号。单位毫秒，1000–120000，默认 45000'
        >
          <Input
            className='w-24'
            type='number'
            min={1000}
            max={120000}
            value={Number(pool.sticky_wait_timeout_ms ?? 45000)}
            onChange={(event) =>
              onPoolChange({
                ...pool,
                sticky_wait_timeout_ms: Number(event.target.value),
              })
            }
          />
        </SettingRow>
        <SettingRow
          label='等其他账号最多等多久'
          desc='所有账号都忙时最多等多久。单位毫秒，1000–120000，默认 30000'
        >
          <Input
            className='w-24'
            type='number'
            min={1000}
            max={120000}
            value={Number(pool.fallback_wait_timeout_ms ?? 30000)}
            onChange={(event) =>
              onPoolChange({
                ...pool,
                fallback_wait_timeout_ms: Number(event.target.value),
              })
            }
          />
        </SettingRow>
        <SettingRow
          label='一个请求最多重试多久'
          desc='换号重试总共最多花多长时间。单位毫秒，默认 120000'
        >
          <Input
            className='w-24'
            type='number'
            min={1000}
            value={Number(failover.total_retry_deadline_ms ?? 120000)}
            onChange={(event) =>
              onFailoverChange({
                ...failover,
                total_retry_deadline_ms: Number(event.target.value),
              })
            }
          />
        </SettingRow>
        <SettingRow
          label='凭证报错（401）后暂停多久'
          desc='账号凭证被官方拒绝后，暂时不给它派请求的时长'
        >
          <Select
            value={String(failover.oauth_401_cooldown_ms ?? 120000)}
            onValueChange={(cooldownMs) =>
              onFailoverChange({
                ...failover,
                oauth_401_cooldown_ms: Number(cooldownMs),
              })
            }
          >
            <SelectTrigger className='w-56'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='30000'>30 秒</SelectItem>
              <SelectItem value='120000'>2 分钟</SelectItem>
              <SelectItem value='300000'>5 分钟</SelectItem>
              <SelectItem value='600000'>10 分钟</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          label='流式回复怎么发'
          desc='边收边发：响应快。确认后再发：先确认上游没出错再开始发，失败能换号，但首字会慢一些'
        >
          <Select
            value={String(failover.delivery_mode || 'realtime')}
            onValueChange={(deliveryMode) =>
              onFailoverChange({
                ...failover,
                delivery_mode: deliveryMode,
              })
            }
          >
            <SelectTrigger className='w-56'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='realtime'>边收边发（realtime）</SelectItem>
              <SelectItem value='verified'>确认后再发（verified）</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </CardContent>
    </Card>
  )
}
