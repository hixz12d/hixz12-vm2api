import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

type OfficialCcConfig = Record<string, unknown>

const TIMEOUTS: [number, string][] = [
  [30000, '30 秒'],
  [60000, '1 分钟'],
  [120000, '2 分钟'],
  [240000, '4 分钟'],
  [480000, '8 分钟'],
  [900000, '15 分钟'],
]

const MEMORY: [string, string][] = [
  ['500m', '500 MB（推荐）'],
  ['512m', '512 MB'],
  ['1g', '1 GB'],
  ['2g', '2 GB'],
  ['4g', '4 GB'],
  ['8g', '8 GB'],
]

const BASIC: [string, string, string][] = [
  ['enabled', '导入凭证后自动安装', '开启'],
  ['sync_telemetry', '安装后照官方方式上报统计', '安装成功后打开'],
]

const ADVANCED: [string, string, string][] = [
  ['wipe', '安装前先清空', '每次导入凭证都清空运行环境'],
  ['apply_seed', '安装后改几项默认配置', '按账号「初装设置」页签的开关改'],
  [
    'reconcile_fingerprint',
    '用官方生成的设备编号',
    '以官方客户端生成的机器编号为准',
  ],
]

function SwitchRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string
  label: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className='flex items-center justify-between gap-3 py-1.5'>
      <div className='min-w-0'>
        <Label htmlFor={id} className='text-sm font-normal'>
          {label}
        </Label>
        <p className='text-xs text-muted-foreground'>{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

export function OfficialCcSettingsPane({
  config,
  onChange,
}: {
  config: OfficialCcConfig
  onChange: (next: OfficialCcConfig) => void
}) {
  const set = (patch: OfficialCcConfig) => onChange({ ...config, ...patch })
  const timeout = Number(config.timeout_ms ?? 240000)
  const memory = String(config.memory ?? '500m')
  const timeouts = TIMEOUTS.some(([v]) => v === timeout)
    ? TIMEOUTS
    : [
        ...TIMEOUTS,
        [timeout, `${Math.round(timeout / 1000)} 秒`] as [number, string],
      ]

  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='text-sm'>自动安装官方 Claude Code</CardTitle>
      </CardHeader>
      <CardContent className='space-y-3'>
        <p className='text-xs text-muted-foreground'>
          打开后，每次给账号导入完整 OAuth
          凭证，都会先清空它的运行环境，再装一遍官方 Claude Code
          并用它打个招呼，让这个账号的设备特征和真实用户一致。一般保持默认即可。
        </p>

        <div className='divide-y'>
          {BASIC.map(([key, label, hint]) => (
            <SwitchRow
              key={key}
              id={`occ-${key}`}
              label={label}
              hint={hint}
              checked={config[key] !== false}
              onChange={(v) => set({ [key]: v })}
            />
          ))}
          <SwitchRow
            id='occ-resident'
            label='打完招呼后不退出'
            hint='默认关。打开后官方 Claude Code 会一直开着'
            checked={config.resident === true}
            onChange={(v) => set({ resident: v })}
          />
        </div>

        <Collapsible>
          <CollapsibleTrigger className='text-sm text-muted-foreground hover:text-foreground'>
            高级设置
          </CollapsibleTrigger>
          <CollapsibleContent className='space-y-3 pt-3'>
            <div className='divide-y'>
              {ADVANCED.map(([key, label, hint]) => (
                <SwitchRow
                  key={key}
                  id={`occ-${key}`}
                  label={label}
                  hint={hint}
                  checked={config[key] !== false}
                  onChange={(v) => set({ [key]: v })}
                />
              ))}
            </div>

            <div className='space-y-1.5'>
              <Label htmlFor='occ-hello'>hello 提示词</Label>
              <Input
                id='occ-hello'
                maxLength={200}
                value={String(config.hello_prompt ?? 'hello')}
                onChange={(e) => set({ hello_prompt: e.target.value })}
              />
            </div>

            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='space-y-1.5'>
                <Label htmlFor='occ-timeout'>单轮超时</Label>
                <Select
                  value={String(timeout)}
                  onValueChange={(v) => set({ timeout_ms: Number(v) })}
                >
                  <SelectTrigger id='occ-timeout'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {timeouts.map(([v, l]) => (
                      <SelectItem key={v} value={String(v)}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='occ-memory'>初装内存</Label>
                <Select
                  value={memory}
                  onValueChange={(v) => set({ memory: v })}
                >
                  <SelectTrigger id='occ-memory'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEMORY.map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p className='text-xs text-muted-foreground'>
              技术细节：安装过程固定走 cli-hop
              通道（inference.engine=rust），打完招呼后会在账号里查一次 /usage
              来确认套餐等级，失败会重试 2 次。换内核组合在「设置 →
              请求改写」或「内核」页。
            </p>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  )
}
