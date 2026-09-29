import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function Socks5Pane() {
  return (
    <div className='space-y-3'>
      <p className='text-sm text-muted-foreground'>
        这里只说明出口代理是怎么工作的。添加、删除、给账号绑定代理，请到侧栏的「出口代理」页。每个账号必须绑一条代理；一条代理默认最多给
        5 个账号用。
      </p>
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
          <CardTitle>本机直连</CardTitle>
        </CardHeader>
        <CardContent className='space-y-2 text-sm text-muted-foreground'>
          <p>
            在「出口代理」页也可以添加「本地出口」：账号直接用这台服务器的网络出去，不经过远程代理。适合本机调试，或者这台服务器本身的
            IP 就是你想要的出口。
          </p>
          <p>检查时只看本机网络是否正常。绑定方法和 SOCKS5 代理一样。</p>
        </CardContent>
      </Card>
    </div>
  )
}
