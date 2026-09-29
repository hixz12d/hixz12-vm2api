import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { SettingRow } from '@/components/setting-row'
import {
  healthProbeQueryOptions,
  type HealthSnapshotView,
} from '@/features/settings/queries'

type Obj = Record<string, unknown>

type HealthPaneProps = {
  title: string
  failover: Obj
  healthProbe: Obj | undefined
  compatibility: Obj
  onFailoverChange: (next: Obj) => void
  onHealthProbeChange: (next: Obj) => void
  onCompatibilityChange: (next: Obj) => void
}

function obj(value: unknown): Obj {
  return value && typeof value === 'object' ? (value as Obj) : {}
}

function clampInt(raw: string, min: number, max: number, fallback: number) {
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function HealthPane(props: HealthPaneProps) {
  const {
    title,
    failover,
    healthProbe,
    compatibility,
    onFailoverChange,
    onHealthProbeChange,
    onCompatibilityChange,
  } = props
  const probe = obj(healthProbe)
  const real = obj(probe.real)
  const minTokens = obj(compatibility.min_max_tokens)
  const setProbe = (patch: Obj) => onHealthProbeChange({ ...probe, ...patch })
  const setReal = (patch: Obj) => setProbe({ real: { ...real, ...patch } })
  const setMinTokens = (patch: Obj) =>
    onCompatibilityChange({
      ...compatibility,
      min_max_tokens: { enabled: true, value: 128, ...minTokens, ...patch },
    })

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <p className='text-xs text-muted-foreground'>
            下游发来的连通性测试请求（比如「hi」「ping」）直接由本服务回答，不占用账号额度和并发。
          </p>
        </CardHeader>
        <CardContent className='divide-y'>
          <SettingRow
            label='直接回答预热请求'
            desc='Claude Code 启动时会发一些预热、生成标题、连通性检查之类的小请求，打开后由本服务直接回答，不消耗账号额度。只对 Claude 模型生效'
          >
            <Switch
              checked={probe.intercept_warmup === true}
              onCheckedChange={(checked) =>
                setProbe({ intercept_warmup: checked })
              }
              aria-label='拦截预热请求'
            />
          </SettingRow>
          <SettingRow
            label='最少允许输出多少 Token'
            desc='请求要求的输出上限太小时自动调高到这个值，避免回复还没开始就被截断。没设置输出上限的请求不受影响'
          >
            <div className='flex items-center gap-3'>
              <Input
                className='w-24'
                type='number'
                min={1}
                max={4096}
                disabled={minTokens.enabled === false}
                value={Number(minTokens.value ?? 128)}
                onChange={(event) =>
                  setMinTokens({
                    value: clampInt(event.target.value, 1, 4096, 128),
                  })
                }
                aria-label='max_tokens 下限'
              />
              <Switch
                checked={minTokens.enabled !== false}
                onCheckedChange={(checked) =>
                  setMinTokens({ enabled: checked })
                }
                aria-label='启用 max_tokens 下限'
              />
            </div>
          </SettingRow>
        </CardContent>
      </Card>
      <HealthCacheCard
        probe={probe}
        real={real}
        onProbeChange={setProbe}
        onRealChange={setReal}
      />
      <SignatureRepairCard failover={failover} onChange={onFailoverChange} />
    </>
  )
}

function HealthCacheCard({
  probe,
  real,
  onProbeChange,
  onRealChange,
}: {
  probe: Obj
  real: Obj
  onProbeChange: (patch: Obj) => void
  onRealChange: (patch: Obj) => void
}) {
  const status = useQuery(healthProbeQueryOptions())
  const snaps = status.data?.snapshots
  return (
    <Card>
      <CardHeader>
        <CardTitle>定时健康检查</CardTitle>
        <p className='text-xs text-muted-foreground'>
          定时用真实账号发一次对话，把结果存下来。new-api、Sub2API
          后台点「测试」时发来的 hi / ping
          请求，直接用这份结果回答，不再真的调用账号。
        </p>
      </CardHeader>
      <CardContent className='divide-y'>
        <SettingRow
          label='开启'
          desc='关闭后，测试请求会像普通请求一样真的调用账号'
        >
          <Switch
            checked={probe.enabled === true}
            onCheckedChange={(checked) => onProbeChange({ enabled: checked })}
            aria-label='启用健康缓存'
          />
        </SettingRow>
        <SettingRow label='多久检查一次' desc='单位秒，30–86400'>
          <Input
            className='w-28'
            type='number'
            min={30}
            max={86400}
            value={Number(probe.interval_sec ?? 600)}
            onChange={(event) =>
              onProbeChange({
                interval_sec: clampInt(event.target.value, 30, 86400, 600),
              })
            }
            aria-label='探测间隔'
          />
        </SettingRow>
        <SettingRow
          label='结果保留多久'
          desc='单位秒。过期后测试请求会真的调用账号'
        >
          <Input
            className='w-28'
            type='number'
            min={30}
            max={172800}
            value={Number(probe.cache_ttl_sec ?? 900)}
            onChange={(event) =>
              onProbeChange({
                cache_ttl_sec: clampInt(event.target.value, 30, 172800, 900),
              })
            }
            aria-label='缓存有效期'
          />
        </SettingRow>
        <SettingRow
          label='检查 Claude 用的模型'
          desc='在 Claude 账号上用这个模型做检查'
        >
          <Input
            className='w-56'
            value={String(real.model ?? 'claude-haiku-4-5')}
            onChange={(event) => onRealChange({ model: event.target.value })}
            aria-label='Claude 探测模型'
          />
        </SettingRow>
        <SettingRow
          label='检查 GPT 用的模型'
          desc='在 GPT 账号上用这个模型做检查。留空则 GPT 的测试请求不走这份结果'
        >
          <Input
            className='w-56'
            placeholder='gpt-5.4'
            value={String(real.openai_model ?? '')}
            onChange={(event) =>
              onRealChange({ openai_model: event.target.value })
            }
            aria-label='GPT 探测模型'
          />
        </SettingRow>
        <SettingRow label='最近一次结果'>
          <div className='flex flex-col items-end gap-1 text-xs'>
            <SnapshotLine label='Claude' snap={snaps?.anthropic} />
            <SnapshotLine label='GPT' snap={snaps?.openai} />
          </div>
        </SettingRow>
      </CardContent>
    </Card>
  )
}

function SnapshotLine({
  label,
  snap,
}: {
  label: string
  snap: HealthSnapshotView | undefined
}) {
  if (!snap?.at) {
    return <span className='text-muted-foreground'>{label}：暂无</span>
  }
  const tone = snap.ok ? 'default' : snap.error ? 'destructive' : 'secondary'
  const text = snap.ok ? '可用' : snap.error ? '失败' : '已过期'
  return (
    <span className='flex items-center gap-2'>
      <span className='text-muted-foreground'>
        {label} · {snap.vm_id || '—'} · {snap.model || '—'}
      </span>
      <Badge variant={tone} title={snap.error || undefined}>
        {text}
      </Badge>
    </span>
  )
}

function SignatureRepairCard({
  failover,
  onChange,
}: {
  failover: Obj
  onChange: (next: Obj) => void
}) {
  // 默认值在 gateway HEAD 与工作区之间相反（!== false vs === true），
  // 所以不硬编码默认态，严格按 GET /routing 的实际值回显。
  const enabled = failover.signature_repair === true
  return (
    <Card>
      <CardHeader>
        <CardTitle>自动修复思考签名错误</CardTitle>
      </CardHeader>
      <CardContent className='flex items-start justify-between gap-4'>
        <div className='space-y-1 text-sm text-muted-foreground'>
          <p>
            官方因为「思考内容签名不对」返回 400
            错误时，去掉之前的思考内容再试一次，下游最终拿到正常结果。
          </p>
          <p>
            关闭则把 400
            原样返回给下游（做签名相关测试时需要）。其他自动修复不受这个开关影响。
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(checked) =>
            onChange({ ...failover, signature_repair: checked })
          }
          aria-label='自动修复思考签名错误'
        />
      </CardContent>
    </Card>
  )
}
