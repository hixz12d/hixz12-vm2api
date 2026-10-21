import { useState } from 'react'
import type { Vm, VmProxySnap } from '@/types/panel-vm'
import { type CredType, credTypeLabel } from '@/lib/cred-type'
import { guestIdentityState } from '@/lib/guest-identity'
import { isCodexVm } from '@/lib/vm-kind'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { TabsContent } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ChoiceTiles } from '@/components/choice-tiles'
import { Field } from '@/features/vm/detail-section-primitives'
import { VmEnvironmentCard } from '@/features/vm/environment-card'
import { NodeChip } from '@/features/vm/node-chip'
import { VmPhysicalFeaturesCard } from '@/features/vm/physical-features-card'
import { isRemoteVm, REMOTE_UNSUPPORTED_TEXT } from '@/features/vm/placement'
import { VmOwnerAdminCard } from '@/features/vm/vm-owner-admin-card'
import { VmShellCard } from '@/features/vm/vm-shell-card'

type VmOpsTabProps = {
  vm: Vm
  proxy: VmProxySnap
  officialCc: boolean
  credType: CredType
  canRefresh: boolean
  refreshBlocked: string
  savingTimezone: boolean
  onAction: (path: string, body?: unknown) => void
  /** 该路径的操作正在进行。 */
  busy: (path: string) => boolean
  /** 终端快捷指令执行后刷新详情。 */
  onRefresh: () => void
  onTimezoneSave: (timezone: string) => void
  onTimezoneFollowProxy: () => void
  onReset: () => void
  onDelete: () => void
}

export function VmOpsTab(props: VmOpsTabProps) {
  const [kernelOpen, setKernelOpen] = useState(false)
  const [kernelMode, setKernelMode] = useState<'keep' | 'traits'>('keep')
  const {
    vm,
    proxy,
    officialCc,
    credType,
    canRefresh,
    refreshBlocked,
    savingTimezone,
    onAction,
    busy,
    onRefresh,
    onTimezoneSave,
    onTimezoneFollowProxy,
    onReset,
    onDelete,
  } = props

  const gpt = isCodexVm(vm)
  const guest = guestIdentityState(vm)
  const remote = isRemoteVm(vm)
  return (
    <TabsContent value='ops' className='space-y-3 pt-4'>
      <VmOwnerAdminCard vm={vm} />
      <Card>
        <CardHeader className='pb-2'>
          <CardTitle className='text-sm'>运行环境</CardTitle>
        </CardHeader>
        <CardContent className='divide-y pt-0'>
          <Field label='服务器'>
            <NodeChip nodeId={vm.node_id} className='text-[11px]' />
          </Field>
          <Field label='环境编号'>
            <span className='font-mono text-xs'>
              {String(
                (vm.runtime as Record<string, unknown> | undefined)
                  ?.container ||
                  vm.container ||
                  '—'
              )}
            </span>
          </Field>
          {(vm.runtime as Record<string, unknown> | undefined)
            ?.egress_container ? (
            <Field label='出口容器'>
              <span className='font-mono text-xs'>
                {String(
                  (vm.runtime as Record<string, unknown>).egress_container
                )}
              </span>
            </Field>
          ) : null}
          <Field label='机器名'>
            <span className='font-mono text-xs'>{guest.hostname}</span>
          </Field>
          <Field label='设备特征'>
            <span>{guest.status}</span>
            {guest.collectedAt ? (
              <time
                className='ml-2 text-xs text-muted-foreground'
                dateTime={guest.collectedAt}
              >
                {new Date(guest.collectedAt).toLocaleString('zh-CN')}
              </time>
            ) : null}
          </Field>
        </CardContent>
      </Card>
      <VmPhysicalFeaturesCard
        vm={vm}
        collecting={busy('/collect-identity')}
        onCollect={() => onAction('/collect-identity')}
      />
      <VmEnvironmentCard
        vm={vm}
        proxy={proxy}
        saving={savingTimezone}
        onSave={onTimezoneSave}
        onFollowProxy={onTimezoneFollowProxy}
      />
      <OpsGroup title='常用' desc='账号出问题时先试这里，都不会删除数据。'>
        <OpsButton
          label='刷新凭证'
          hint={
            refreshBlocked ||
            '用刷新令牌换一张新的访问凭证。凭证快过期或刚报错时用。'
          }
          disabled={!canRefresh}
          loading={busy('/oauth/refresh')}
          onClick={() => onAction('/oauth/refresh', {})}
        />
        <OpsButton
          label={gpt ? '重新加载 Codex 程序' : '重新加载程序'}
          hint='让这个账号换上最新版本的程序。加载的几秒里，它正在处理的请求可能失败。'
          loading={busy('/reload')}
          onClick={() => onAction('/reload')}
        />
        <OpsButton
          label='设为当前调度账号'
          hint='手动指定下一批请求优先用这个账号。'
          loading={busy('/activate')}
          onClick={() => onAction('/activate')}
        />
      </OpsGroup>

      <OpsGroup
        title='设备特征'
        desc='让这台机器看起来和官方客户端一致。一般导入凭证时会自动做好，只有提示特征缺失时才需要手动点。'
      >
        <OpsButton
          label='重新读取机器特征'
          hint='重新读取这台机器的语言、时区、机器编号等信息。'
          loading={busy('/collect-identity')}
          onClick={() => onAction('/collect-identity')}
        />
        {gpt ? null : (
          <>
            <OpsButton
              label='重跑官方初装'
              hint={
                remote
                  ? REMOTE_UNSUPPORTED_TEXT
                  : officialCc
                    ? '在运行环境里重新装一遍官方 Claude Code。'
                    : `官方初装只支持完整 OAuth 凭证，这个账号是 ${credTypeLabel(credType)}。`
              }
              disabled={!officialCc || remote}
              loading={busy('/official-cc-bootstrap')}
              onClick={() =>
                onAction('/official-cc-bootstrap', {
                  force: true,
                  manual: true,
                })
              }
            />
            <OpsButton
              label='按官方配置对齐特征'
              hint='用官方客户端生成的配置文件校准设备特征。'
              loading={busy('/reconcile-fingerprint')}
              onClick={() => onAction('/reconcile-fingerprint', {})}
            />
          </>
        )}
      </OpsGroup>

      {gpt ? null : (
        <OpsGroup
          title='内核'
          desc='内核是账号里真正发请求的程序。只在内核报错或你要换版本时用。'
        >
          <OpsButton
            label='重装这个账号的内核…'
            hint={
              remote
                ? '集群节点上的账号会用同一份内核、cli-node 和统计上报程序重建镜像再换容器，凭证和指纹保留。'
                : '重新装一遍这个账号的内核、cli-node 和统计上报程序，可选择保留原数据或重建新特征。'
            }
            loading={busy('/wrap-cli/repair')}
            onClick={() => setKernelOpen(true)}
          />
          <OpsButton
            label='把这个账号的内核设为模板'
            hint={
              remote
                ? REMOTE_UNSUPPORTED_TEXT
                : '以后给其他账号安装内核时，照这个账号的版本来装。不会复制凭证和出口代理。'
            }
            disabled={remote}
            loading={busy('/wrap-cli/promote')}
            onClick={() => onAction('/wrap-cli/promote')}
          />
        </OpsGroup>
      )}

      {gpt ? null : (
        <OpsGroup
          title='槽位终端'
          desc='在网页里进入该账号的容器，带用量、重载等快捷指令。'
        >
          <div className='w-full'>
            <VmShellCard vm={vm} onChanged={onRefresh} />
          </div>
        </OpsGroup>
      )}

      <OpsGroup
        title='危险操作'
        desc='重建会中断请求，可选择保留数据或清空凭证；删除无法恢复。操作前会再次确认。'
        danger
      >
        <Button size='sm' variant='outline' onClick={onReset}>
          重建运行环境…
        </Button>
        <Button size='sm' variant='destructive' onClick={onDelete}>
          删除这个账号…
        </Button>
      </OpsGroup>
      <Dialog open={kernelOpen} onOpenChange={setKernelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重装这个账号的内核</DialogTitle>
          </DialogHeader>
          <ChoiceTiles
            label='更新方式'
            value={kernelMode}
            onChange={setKernelMode}
            choices={[
              {
                value: 'keep',
                title: '保留原数据重建',
                detail:
                  '留下凭证、设备指纹和统计，只换内核、cli-node 和统计上报程序。',
              },
              {
                value: 'traits',
                title: '重建新特征',
                detail: remote
                  ? '集群节点上的账号只换镜像，不在这里清远程家目录。'
                  : '清空家目录并重新生成机器身份（设备指纹会变）。',
              },
            ]}
          />
          <DialogFooter>
            <Button variant='outline' onClick={() => setKernelOpen(false)}>
              取消
            </Button>
            <Button
              variant={kernelMode === 'traits' ? 'destructive' : 'default'}
              onClick={() => {
                setKernelOpen(false)
                onAction('/wrap-cli/repair', { mode: kernelMode })
              }}
            >
              {kernelMode === 'keep' ? '保留原数据重建' : '重建新特征'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TabsContent>
  )
}

function OpsGroup({
  title,
  desc,
  danger,
  children,
}: {
  title: string
  desc: string
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      className={
        danger
          ? 'rounded-md border border-destructive/40 px-4 py-3'
          : 'rounded-md border border-brass-dim px-4 py-3'
      }
    >
      <h3 className='text-sm font-semibold'>{title}</h3>
      <p className='mt-0.5 text-xs text-muted-foreground'>{desc}</p>
      <div className='mt-3 flex flex-wrap gap-2'>{children}</div>
    </section>
  )
}

/** 带说明的操作按钮：悬停或聚焦时说清楚点了会怎样。 */
function OpsButton({
  label,
  hint,
  disabled,
  loading,
  onClick,
}: {
  label: string
  hint: string
  disabled?: boolean
  loading?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Button
            size='sm'
            variant='outline'
            disabled={disabled}
            loading={loading}
            onClick={onClick}
          >
            {label}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent className='max-w-72'>{hint}</TooltipContent>
    </Tooltip>
  )
}
