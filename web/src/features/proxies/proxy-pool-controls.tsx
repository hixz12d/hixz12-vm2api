import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

const BIND_LIMITS = [1, 2, 3, 4, 5, 8, 10, 16, 20, 32]
const PROBE_MINS = [5, 10, 30, 60]
// Values mirror DNS_UPSTREAMS in src/lib/vm/egress.mjs. The chosen one is tried
// first; the rest stay behind it as automatic fallback.
const DNS_CHOICES = [
  { value: 'auto', label: '自动（默认顺序）' },
  { value: 'https://1.1.1.1/dns-query', label: 'Cloudflare DoH' },
  { value: 'https://8.8.8.8/dns-query', label: 'Google DoH' },
  { value: '8.8.8.8:53', label: 'Google TCP 53（明文）' },
  { value: '1.1.1.1:53', label: 'Cloudflare TCP 53（明文）' },
]

type ProxyPoolControlsProps = {
  bindLimit: number
  probeMin: number
  raw: string
  importing: boolean
  onBindLimitChange: (value: number) => void
  onProbeMinChange: (value: number) => void
  dnsPrimary: string
  onDnsPrimaryChange: (value: string) => void
  followProxyTimezone: boolean
  onFollowProxyTimezoneChange: (value: boolean) => void
  onRawChange: (value: string) => void
  onImport: () => void
  onAddLocal?: () => void
  addingLocal?: boolean
  hasLocal?: boolean
}

export function ProxyPoolControls(props: ProxyPoolControlsProps) {
  const {
    bindLimit,
    probeMin,
    raw,
    importing,
    onBindLimitChange,
    onProbeMinChange,
    dnsPrimary,
    onDnsPrimaryChange,
    followProxyTimezone,
    onFollowProxyTimezoneChange,
    onRawChange,
    onImport,
    onAddLocal,
    addingLocal,
    hasLocal,
  } = props

  return (
    <>
      <p className='mb-3 max-w-3xl text-sm text-muted-foreground'>
        每个账号的请求都从它绑定的代理出去，官方看到的就是代理的 IP
        和地区。也可以添加「本机直连」，直接用这台服务器的网络。自动检查只看代理能不能连上，不会访问官方。
      </p>
      <div className='mb-4 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-md border border-brass-dim bg-card px-4 py-3 text-sm'>
        <label className='flex items-center gap-2'>
          每条代理最多给
          <Select
            value={String(bindLimit)}
            onValueChange={(value) => onBindLimitChange(Number(value))}
          >
            <SelectTrigger
              className='h-8 w-[88px]'
              aria-label='每条代理最多给几个账号用'
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BIND_LIMITS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} 个账号
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className='flex items-center gap-2'>
          每隔
          <Select
            value={String(probeMin)}
            onValueChange={(value) => onProbeMinChange(Number(value))}
          >
            <SelectTrigger className='h-8 w-[88px]' aria-label='自动检查间隔'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROBE_MINS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} 分钟
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className='flex items-center gap-2'>
          查域名用
          <Select value={dnsPrimary} onValueChange={onDnsPrimaryChange}>
            <SelectTrigger
              className='h-8 w-[200px]'
              aria-label='代理优先使用的 DNS'
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DNS_CHOICES.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className='text-xs text-muted-foreground'>
            选的不通时自动换下一个
          </span>
        </label>
        <label className='flex items-center gap-2'>
          <Switch
            checked={followProxyTimezone}
            onCheckedChange={onFollowProxyTimezoneChange}
            aria-label='绑代理后账号时区跟着代理走'
          />
          绑代理后账号时区跟着代理走
          <span className='text-xs text-muted-foreground'>
            手动设过时区的账号不受影响
          </span>
        </label>
      </div>
      <Card className='mb-4 border-brass-dim shadow-none'>
        <CardHeader>
          <CardTitle className='text-base'>添加 SOCKS5 代理</CardTitle>
        </CardHeader>
        <CardContent className='space-y-2'>
          <Label>
            每行一条，格式 host:port 或
            user:pass@host:port，可以一次贴多行。账号密码保存后不会再显示。
          </Label>
          <Textarea
            value={raw}
            onChange={(event) => onRawChange(event.target.value)}
            rows={4}
          />
          <div className='flex flex-wrap gap-2'>
            <Button
              onClick={onImport}
              disabled={!raw.trim() || importing}
              loading={importing}
            >
              添加
            </Button>
            {onAddLocal ? (
              <Button
                variant='outline'
                onClick={onAddLocal}
                disabled={addingLocal || hasLocal}
                loading={addingLocal}
              >
                {hasLocal ? '已有本机直连' : '添加本机直连'}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </>
  )
}
