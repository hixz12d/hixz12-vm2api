import { Link } from '@tanstack/react-router'
import type { Vm, VmProxySnap } from '@/types/panel-vm'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TabsContent } from '@/components/ui/tabs'
import { StatusMark } from '@/components/status-mark'
import {
  proxyFieldClass,
  proxyLatencyTone,
} from '@/features/proxies/proxy-tone'
import { Field } from '@/features/vm/detail-section-primitives'

type VmProxyTabProps = {
  vm: Vm
  proxy: VmProxySnap
  boundId: string
  free: VmProxySnap[]
  bindId: string
  onBindIdChange: (id: string) => void
  onUnbind: () => void
  onAllocate: () => void
  onBind: () => void
}

export function VmProxyTab(props: VmProxyTabProps) {
  const {
    vm,
    proxy,
    boundId,
    free,
    bindId,
    onBindIdChange,
    onUnbind,
    onAllocate,
    onBind,
  } = props

  return (
    <TabsContent value='proxy' className='space-y-3 pt-4'>
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-sm'>出口代理</CardTitle>
        </CardHeader>
        <p className='px-6 pb-2 text-xs text-muted-foreground'>
          这个账号发往官方的请求都从这条 SOCKS5
          代理出去，官方看到的就是这条代理的 IP
          和地区。没有绑定代理的账号不会发请求。
        </p>
        <CardContent className='divide-y pt-0'>
          <Field label='代理编号'>
            <span className='field-host text-xs'>{boundId || '—'}</span>
          </Field>
          <Field label='地址'>
            <span className='field-host text-xs'>
              {String(proxy.host || '—')}
              {proxy.port != null ? `:${proxy.port}` : ''}
            </span>
          </Field>
          <Field label='状态'>
            <span className='flex items-center gap-2'>
              {String(proxy.status || '—')}
              {vm.has_token && !proxy.host && !vm.proxy_id ? (
                <StatusMark
                  variant='pill'
                  tone={{
                    key: 'bad',
                    text: '没有代理',
                    cls: 'bad',
                    label: '没有代理，不会发请求',
                  }}
                />
              ) : null}
            </span>
          </Field>
          <Field label='延迟'>
            <span
              className={cn(
                'field-metric text-sm',
                proxyFieldClass(proxyLatencyTone(proxy))
              )}
            >
              {proxy.latency_ms != null ? `${proxy.latency_ms}ms` : '—'}
            </span>
          </Field>
          <Field label='账号密码'>{proxy.has_auth ? '已设置' : '无'}</Field>
          <Field label='出口地区'>
            <span className='text-xs'>
              {[proxy.geo?.country, proxy.geo?.region, proxy.geo?.city]
                .filter(Boolean)
                .join(' · ') || (proxy.geo?.error ? '检测失败' : '未检测')}
            </span>
          </Field>
          <Field label='出口时区'>
            <span className='flex items-center gap-2 text-xs'>
              <span className='field-host'>{proxy.geo?.timezone || '—'}</span>
              {proxy.geo?.timezone && proxy.geo.timezone !== vm.timezone ? (
                <span className='text-muted-foreground'>
                  账号时区是 {vm.timezone || '—'}
                  ，可以在「运行环境」页签改成跟随代理
                </span>
              ) : null}
            </span>
          </Field>
        </CardContent>
      </Card>
      <div className='flex flex-wrap gap-2'>
        {boundId ? (
          <Button size='sm' variant='outline' onClick={onUnbind}>
            解除绑定
          </Button>
        ) : null}
        <Button size='sm' variant='outline' onClick={onAllocate}>
          自动分一条空闲代理
        </Button>
        <Button size='sm' variant='ghost' asChild>
          <Link to='/settings/$tab' params={{ tab: 'socks5' }}>
            管理所有出口代理
          </Link>
        </Button>
      </div>
      {free.length ? (
        <div className='flex gap-2'>
          <Select
            value={bindId || free[0].id || ''}
            onValueChange={onBindIdChange}
          >
            <SelectTrigger className='w-64'>
              <SelectValue placeholder='选一条代理' />
            </SelectTrigger>
            <SelectContent>
              {free.map((p) => (
                <SelectItem key={p.id} value={p.id || ''}>
                  {p.host}:{p.port}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size='sm' onClick={onBind}>
            绑定这条
          </Button>
        </div>
      ) : (
        <p className='text-sm text-muted-foreground'>
          没有空闲的代理可以绑定，先去「出口代理」页添加。
        </p>
      )}
    </TabsContent>
  )
}
