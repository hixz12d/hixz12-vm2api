import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { SettingRow } from '@/components/setting-row'
import {
  proxiesQueryOptions,
  useRefreshProxies,
} from '@/features/proxies/queries'

export function Socks5Pane() {
  const pool = useQuery(proxiesQueryOptions())
  const refresh = useRefreshProxies()
  const ipv6 = useMutation({
    mutationFn: (enabled: boolean) =>
      api<{
        egress?: {
          ok: boolean
          proxy_id: string
          vm_id?: string
          error?: string
        }[]
      }>('/api/panel/proxies/config', {
        method: 'PUT',
        body: JSON.stringify({ ipv6_enabled: enabled }),
      }),
    onSuccess: async (data, enabled) => {
      const failed = (data.egress || []).filter((exit) => !exit.ok)
      if (failed.length) {
        toast.warning(
          `IPv6 设置已保存，${failed.length} 个出口未同步：${failed.map((exit) => exit.vm_id || exit.proxy_id).join('、')}。恢复节点连接后重试。`
        )
      } else {
        toast.success(
          enabled
            ? 'IPv6 代理出口已开启'
            : 'IPv6 代理出口已关闭，现有连接已断开'
        )
      }
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const enabled = ipv6.isPending
    ? ipv6.variables
    : pool.data?.config?.ipv6_enabled === true
  return (
    <div className='space-y-3'>
      <p className='text-sm text-muted-foreground'>
        这里只说明出口代理是怎么工作的。添加、删除、给账号绑定代理，请到侧栏的「出口代理」页。每个账号必须绑一条代理；一条代理默认最多给
        5 个账号用。
      </p>
      <Card>
        <CardHeader>
          <CardTitle>IPv6 代理出口</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingRow
            label='启用 IPv6'
            desc='默认关闭。开启后允许探测、绑定和使用 IPv6 地址的 SOCKS5 代理；关闭会断开对应出口的现有连接，但保留槽位、绑定和探测历史。槽位网桥仍为 IPv4，DNS 和路由策略不变。'
          >
            <Switch
              checked={enabled}
              disabled={!pool.data || ipv6.isPending}
              onCheckedChange={(checked) => ipv6.mutate(checked)}
              aria-label='启用 IPv6 代理出口'
            />
          </SettingRow>
          {pool.error ? (
            <p role='alert' className='text-sm text-red-3'>
              {pool.error.message}
            </p>
          ) : null}
          <p className='mt-3 text-sm text-muted-foreground'>
            IPv6 地址请使用 <code>[2001:db8::1]:1080</code> 或完整 SOCKS5
            URL。代理池和槽位网络状态会区分“IPv6 已关闭”与探测失败。
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>远程 SOCKS5 代理</CardTitle>
        </CardHeader>
        <CardContent className='space-y-2 text-sm text-muted-foreground'>
          <p>
            每条 SOCKS5
            代理会配一个中转网关，账号运行环境的所有网络流量都自动从它出去，账号里的程序不需要知道代理的存在。
          </p>
          <p>
            家庭宽带代理通常 15 分钟会掐断空闲连接，所以网关会在连接空闲 7
            分钟时主动断开重连，并每 15 秒发一次保活信号。
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>本地代理</CardTitle>
        </CardHeader>
        <CardContent className='space-y-2 text-sm text-muted-foreground'>
          <p>
            本地代理 = 当前VPS的本地代理，选项里显示为{' '}
            <code>local:&lt;VPS IP&gt;</code>
            。槽位走所在 VPS 的默认路由出网，不经远程 SOCKS5，也不启
            kin-egress： 本机槽从控制面出网，集群节点槽从该节点自身出网。
          </p>
          <p>
            节点槽的换票、刷新、测试与时区地理也经该节点 SSH
            链路从节点出网；节点未连接时这些请求直接失败，不回落控制面。
          </p>
          <p>
            池里只有一条本地代理，可同时绑给不同 VPS
            上的槽位，选项列表固定排第一。探测只看本机 Docker 网是否在。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
