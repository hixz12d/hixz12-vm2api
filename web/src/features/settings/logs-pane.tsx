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

type LogsPaneProps = {
  value: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}

export function LogsPane({ value: logging, onChange }: LogsPaneProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>请求日志</CardTitle>
      </CardHeader>
      <CardContent className='divide-y'>
        <SettingRow
          label='记录多少'
          desc='普通：记请求概况。详细：连请求和回复内容也记，排查问题时用，占空间大'
        >
          <Select
            value={String(logging.mode || 'normal')}
            onValueChange={(mode) => onChange({ ...logging, mode })}
          >
            <SelectTrigger className='w-40'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='off'>不记录</SelectItem>
              <SelectItem value='normal'>普通</SelectItem>
              <SelectItem value='debug'>详细（Debug）</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow label='保留几天'>
          <Input
            className='w-24'
            type='number'
            min={1}
            max={90}
            value={Number(logging.retain_days ?? 7)}
            onChange={(event) =>
              onChange({
                ...logging,
                retain_days: Number(event.target.value),
              })
            }
          />
        </SettingRow>
        <SettingRow
          label='详细内容保留几天'
          desc='详细模式记下的请求和回复内容保留几天，不会超过上面的天数'
        >
          <Input
            className='w-24'
            type='number'
            min={1}
            max={90}
            value={Number(logging.debug_retain_days ?? 3)}
            onChange={(event) =>
              onChange({
                ...logging,
                debug_retain_days: Number(event.target.value),
              })
            }
          />
        </SettingRow>
        <SettingRow
          label='最多占多少空间（MB）'
          desc='超过后先删最旧的详细内容。0 表示不按大小清理'
        >
          <Input
            className='w-24'
            type='number'
            min={0}
            value={Number(logging.max_mb ?? 2048)}
            onChange={(event) =>
              onChange({
                ...logging,
                max_mb: Number(event.target.value),
              })
            }
          />
        </SettingRow>
      </CardContent>
    </Card>
  )
}
