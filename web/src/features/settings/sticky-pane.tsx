import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { SettingRow } from '@/components/setting-row'

type StickyPaneProps = {
  value: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}

export function StickyPane({ value: sticky, onChange }: StickyPaneProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>固定账号</CardTitle>
      </CardHeader>
      <CardContent className='divide-y'>
        <SettingRow
          label='开启'
          desc='同一段对话的请求在保持时间内交给同一个账号'
        >
          <Switch
            checked={sticky.enabled !== false}
            onCheckedChange={(enabled) => onChange({ ...sticky, enabled })}
          />
        </SettingRow>
        <SettingRow label='按什么认定「同一段对话」' desc='一般选「对话」'>
          <Select
            value={String(sticky.mode || 'conversation')}
            onValueChange={(mode) => onChange({ ...sticky, mode })}
          >
            <SelectTrigger className='w-40'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='conversation'>对话</SelectItem>
              <SelectItem value='session'>登录身份</SelectItem>
              <SelectItem value='ip'>来源 IP</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          label='保持多久'
          desc='超过这个时间没有新请求，就重新挑账号'
        >
          <Select
            value={String(sticky.ttl_seconds ?? 86400)}
            onValueChange={(ttlSeconds) =>
              onChange({
                ...sticky,
                ttl_seconds: Number(ttlSeconds),
              })
            }
          >
            <SelectTrigger className='w-40'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[3600, 21600, 86400, 604800, 2592000].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n / 3600} 小时
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </CardContent>
    </Card>
  )
}
