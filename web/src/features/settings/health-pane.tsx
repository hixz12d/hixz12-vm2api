import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { RawConfigFields } from '@/features/settings/raw-config-fields'

type HealthPaneProps = {
  title: string
  failover: Record<string, unknown>
  healthProbe: Record<string, unknown> | undefined
  onFailoverChange: (next: Record<string, unknown>) => void
}

export function HealthPane(props: HealthPaneProps) {
  const { title, failover, healthProbe, onFailoverChange } = props
  return (
    <>
      <SignatureRepairCard failover={failover} onChange={onFailoverChange} />
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-2 text-sm text-muted-foreground'>
          <p>这里显示当前的健康检查配置，改动随页面底部的「保存」一起生效。</p>
          <RawConfigFields value={healthProbe} />
        </CardContent>
      </Card>
    </>
  )
}
function SignatureRepairCard({
  failover,
  onChange,
}: {
  failover: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
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
