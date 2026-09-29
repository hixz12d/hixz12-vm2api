import { useEffect, useState, type ReactNode } from 'react'
import type { ApiKeyItem } from '@/types/panel-keys'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AccountGroup } from './groups-query'
import type { KeyLimitsDraft } from './key-payload'

const CONC = [0, 1, 2, 4, 8, 16, 20, 32, 64]
const QUOTA_CREATE = [0, 1000, 5000, 10000, 50000]
const QUOTA_EDIT = [0, 1000, 5000, 10000, 50000, 100000]
const RPM_CREATE = [0, 30, 60, 120, 600]
const RPM_EDIT = [0, 30, 60, 120, 300, 600]
const DAYS = [0, 7, 30, 90, 365]

export type { KeyLimitsDraft } from './key-payload'

function withCurrent(opts: number[], current: number): number[] {
  if (opts.includes(current)) return opts
  return [...opts, current].sort((a, b) => a - b)
}

function optLabel(kind: 'conc' | 'quota' | 'rpm' | 'days', n: number): string {
  if (n === 0) {
    if (kind === 'days') return '永久'
    return '不限'
  }
  if (kind === 'quota') {
    if (n >= 1000) return `${n / 1000}k`
    return String(n)
  }
  if (kind === 'days') return n === 365 ? '一年' : `${n} 天`
  return String(n)
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className='space-y-1'>
      <Label>{label}</Label>
      {children}
      {hint ? (
        <p className='text-[11px] text-muted-foreground'>{hint}</p>
      ) : null}
    </div>
  )
}

function NumSelect({
  value,
  options,
  onChange,
  kind,
}: {
  value: number
  options: number[]
  onChange: (n: number) => void
  kind: 'conc' | 'quota' | 'rpm' | 'days'
}) {
  const opts = withCurrent(options, value)
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {opts.map((n) => (
          <SelectItem key={n} value={String(n)}>
            {optLabel(kind, n)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function KeyLimitsDialog({
  mode,
  open,
  onOpenChange,
  initial,
  pending,
  onSubmit,
  groups,
  canAssignGroup = false,
}: {
  mode: 'create' | 'edit'
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: ApiKeyItem | null
  pending: boolean
  onSubmit: (draft: KeyLimitsDraft) => void
  groups: AccountGroup[]
  canAssignGroup?: boolean
}) {
  const [draft, setDraft] = useState<KeyLimitsDraft>({
    name: '',
    category: 'oauth',
    group_id: 1,
    max_concurrency: 20,
    quota_requests: 0,
    quota_usd: 0,
    rpm: 0,
    expires_in_days: 30,
  })

  useEffect(() => {
    if (!open) return
    if (mode === 'edit' && initial) {
      setDraft({
        name: initial.name || '',
        category: initial.category === 'api' ? 'api' : 'oauth',
        group_id: initial.group_id ?? 1,
        max_concurrency: Number(initial.max_concurrency ?? 20),
        quota_requests: Number(initial.quota_requests ?? 0),
        quota_usd: Number(initial.quota_usd ?? 0),
        rpm: Number(initial.rpm ?? 0),
        expires_in_days: 0,
      })
      return
    }
    setDraft({
      name: '',
      category: 'oauth',
      group_id: 1,
      max_concurrency: 20,
      quota_requests: 0,
      quota_usd: 0,
      rpm: 0,
      expires_in_days: 30,
    })
  }, [open, mode, initial])

  const quotaOpts = mode === 'edit' ? QUOTA_EDIT : QUOTA_CREATE
  const rpmOpts = mode === 'edit' ? RPM_EDIT : RPM_CREATE

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === 'create'
              ? '新建 Key'
              : `Key 设置 · ${initial?.name || initial?.id || ''}`}
          </DialogTitle>
        </DialogHeader>
        {mode === 'edit' && initial ? (
          <p className='text-xs text-muted-foreground'>
            <span className='font-mono'>
              {initial.key_prefix || initial.prefix || initial.id}
            </span>
            {initial.inflight ? ` · ${initial.inflight} 个请求进行中` : ''}
          </p>
        ) : null}
        <div className='grid gap-3 sm:grid-cols-2'>
          {mode === 'create' ? (
            <Field label='名称' hint='自己认得出就行，例如 sub2api-max'>
              <Input
                value={draft.name}
                placeholder='sub2api-max'
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
              />
            </Field>
          ) : null}
          <Field label='类型' hint='一般选「走账号分组」'>
            <Select
              value={draft.category}
              onValueChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  category: v === 'api' ? 'api' : 'oauth',
                  group_id: v === 'api' ? 1 : d.group_id,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='oauth'>走账号分组</SelectItem>
                <SelectItem value='api'>API 直连（不走分组）</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label='账号分组' hint='这个 Key 只会用这个分组里的账号'>
            <Select
              value={String(draft.group_id ?? 1)}
              disabled={!canAssignGroup || draft.category === 'api'}
              onValueChange={(v) =>
                setDraft((d) => ({ ...d, group_id: Number(v) }))
              }
            >
              <SelectTrigger aria-label='账号分组'>
                <SelectValue placeholder='请选择分组' />
              </SelectTrigger>
              <SelectContent>
                {groups
                  .filter(
                    (g) => g.status === 'active' || g.id === draft.group_id
                  )
                  .map((g) => (
                    <SelectItem
                      key={g.id}
                      value={String(g.id)}
                      disabled={g.status !== 'active'}
                    >
                      {g.name}
                      {g.status !== 'active' ? '（已停用）' : ''}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label='同时请求数' hint='最多同时处理几个请求'>
            <NumSelect
              kind='conc'
              value={draft.max_concurrency}
              options={CONC}
              onChange={(n) => setDraft((d) => ({ ...d, max_concurrency: n }))}
            />
          </Field>
          <Field label='次数上限' hint='总共最多调用多少次'>
            <NumSelect
              kind='quota'
              value={draft.quota_requests}
              options={quotaOpts}
              onChange={(n) => setDraft((d) => ({ ...d, quota_requests: n }))}
            />
          </Field>
          <Field label='金额上限（美元）' hint='0 表示不限'>
            <Input
              type='number'
              min={0}
              step='0.01'
              value={draft.quota_usd}
              onChange={(e) =>
                setDraft((d) => ({ ...d, quota_usd: Number(e.target.value) }))
              }
            />
          </Field>
          <Field label='每分钟请求数' hint='每分钟最多几个请求'>
            <NumSelect
              kind='rpm'
              value={draft.rpm}
              options={rpmOpts}
              onChange={(n) => setDraft((d) => ({ ...d, rpm: n }))}
            />
          </Field>
          {mode === 'create' ? (
            <Field label='有效期' hint='到期后自动失效'>
              <NumSelect
                kind='days'
                value={draft.expires_in_days}
                options={DAYS}
                onChange={(n) =>
                  setDraft((d) => ({ ...d, expires_in_days: n }))
                }
              />
            </Field>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            取消
          </Button>
          <Button
            onClick={() => onSubmit(draft)}
            disabled={
              pending ||
              !groups.some(
                (g) => g.id === draft.group_id && g.status === 'active'
              ) ||
              (mode === 'create' && !draft.name.trim())
            }
            loading={pending}
          >
            {mode === 'create' ? '生成 Key' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
