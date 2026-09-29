import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  groupsQueryOptions,
  type AccountGroup,
  type GroupsPayload,
} from './groups-query'
import { apiKeysQueryOptions } from './queries'

/** Group 1 is the fallback for keys created without a group. */
const DEFAULT_GROUP_ID = 1

export function GroupsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
}) {
  const qc = useQueryClient()
  const q = useQuery(groupsQueryOptions())
  const keysQ = useQuery(apiKeysQueryOptions())
  const [editing, setEditing] = useState<AccountGroup | 'new' | null>(null)
  const [deleting, setDeleting] = useState<AccountGroup | null>(null)
  const keyCount = (id: number) =>
    (keysQ.data?.keys || []).filter((k) => k.group_id === id).length
  const remove = useMutation({
    mutationFn: (id: number) =>
      api(`/api/panel/groups/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: groupsQueryOptions().queryKey }),
        qc.invalidateQueries({ queryKey: ['panel', 'api-keys'] }),
      ])
      toast.success('分组已删除')
      setDeleting(null)
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const deletingKeys = deleting ? keyCount(deleting.id) : 0
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setEditing(null)
        onOpenChange(value)
      }}
    >
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>账号分组</DialogTitle>
        </DialogHeader>
        <p className='text-sm text-muted-foreground'>
          每个 Key
          只会用它所接分组里的账号；组里没有能用的账号时直接报错，不会借用别的分组。同一个账号可以同时放进多个分组。
        </p>
        {q.isLoading && <p>正在加载分组…</p>}
        {q.error && <p role='alert'>{q.error.message}</p>}
        {q.data &&
          (editing ? (
            <GroupEditor
              key={editing === 'new' ? 'new' : editing.id}
              initial={editing === 'new' ? undefined : editing}
              slots={q.data.slots}
              onDone={() => setEditing(null)}
            />
          ) : (
            <>
              <Button className='self-start' onClick={() => setEditing('new')}>
                新建分组
              </Button>
              <div className='space-y-3'>
                {q.data.items.map((group) => (
                  <div
                    key={group.id}
                    className='flex items-start justify-between gap-3 rounded-md border p-3'
                  >
                    <div className='space-y-1'>
                      <div className='font-medium'>
                        {group.name}{' '}
                        <span className='text-xs text-muted-foreground'>
                          {group.status === 'active' ? '已启用' : '已停用'}
                        </span>
                      </div>
                      {group.description && (
                        <p className='text-sm text-muted-foreground'>
                          {group.description}
                        </p>
                      )}
                      <p className='text-sm'>
                        {group.vm_ids
                          ?.map(
                            (id) =>
                              q.data.slots.find((slot) => slot.id === id)
                                ?.name || id
                          )
                          .join('、') || '组里还没有账号'}
                      </p>
                    </div>
                    <div className='flex shrink-0 gap-2'>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => setEditing(group)}
                      >
                        编辑
                      </Button>
                      {group.id !== DEFAULT_GROUP_ID && (
                        <Button
                          variant='outline'
                          size='sm'
                          className='text-destructive'
                          onClick={() => setDeleting(group)}
                        >
                          删除
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ))}
      </DialogContent>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(value) => {
          if (!value) setDeleting(null)
        }}
        title={deletingKeys ? '这个分组还在用' : '删除这个分组？'}
        desc={
          <div className='grid gap-1.5 text-sm'>
            <p>「{deleting?.name}」</p>
            {deletingKeys ? (
              <p className='text-destructive'>
                还有 {deletingKeys} 个 Key 接在这个分组上。先在 Key
                列表里把它们换到别的分组，再来删除。
              </p>
            ) : (
              <p>
                组里的账号不会被删除，只是不再属于这个分组。以前的请求记录保留。删除后无法恢复，需要时可以重新建一个。
              </p>
            )}
          </div>
        }
        confirmText='删除分组'
        cancelBtnText={deletingKeys ? '知道了' : '取消'}
        destructive
        disabled={deletingKeys > 0 || keysQ.isLoading}
        isLoading={remove.isPending}
        handleConfirm={() => {
          if (deleting) remove.mutate(deleting.id)
        }}
      />
    </Dialog>
  )
}

function GroupEditor({
  initial,
  slots,
  onDone,
}: {
  initial?: AccountGroup
  slots: GroupsPayload['slots']
  onDone: () => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState(initial?.name || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [enabled, setEnabled] = useState(initial?.status !== 'disabled')
  const [members, setMembers] = useState(initial?.vm_ids || [])
  const save = useMutation({
    mutationFn: () =>
      api(initial ? `/api/panel/groups/${initial.id}` : '/api/panel/groups', {
        method: initial ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description,
          status: enabled ? 'active' : 'disabled',
          vm_ids: members,
          expected_updated_at: initial?.updated_at,
        }),
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: groupsQueryOptions().queryKey }),
        qc.invalidateQueries({ queryKey: ['panel', 'api-keys'] }),
      ])
      toast.success('分组已保存')
      onDone()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  return (
    <div className='space-y-4'>
      <div className='space-y-1'>
        <Label htmlFor='group-name'>分组名称</Label>
        <Input
          id='group-name'
          maxLength={80}
          value={name}
          placeholder='例如 Claude Pro'
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className='space-y-1'>
        <Label htmlFor='group-description'>说明</Label>
        <Input
          id='group-description'
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <label className='flex items-center gap-2'>
        <Checkbox
          checked={enabled}
          onCheckedChange={(v) => setEnabled(v === true)}
        />
        启用分组
      </label>
      <fieldset className='space-y-2 rounded-md border p-3'>
        <legend className='px-1 text-sm font-medium'>组里的账号</legend>
        {slots.map((slot) => (
          <label key={slot.id} className='flex items-center gap-2'>
            <Checkbox
              checked={members.includes(slot.id)}
              onCheckedChange={(checked) =>
                setMembers((prev) =>
                  checked === true
                    ? [...new Set([...prev, slot.id])]
                    : prev.filter((id) => id !== slot.id)
                )
              }
            />
            <span>{slot.name}</span>
            <span className='text-xs text-muted-foreground'>
              {slot.status === 'running' ? '运行中' : '已停止'}
            </span>
          </label>
        ))}
        {!slots.length && (
          <p className='text-sm text-muted-foreground'>还没有账号，先去导入</p>
        )}
      </fieldset>
      {!members.length && (
        <p className='text-sm text-muted-foreground'>
          组里没有账号，接到这个分组的 Key 会调用失败。
        </p>
      )}
      {initial && (
        <p className='text-xs text-muted-foreground'>
          保存后马上生效：之后的新请求按新的账号名单分配，已经在处理的请求不受影响。停用分组会让接到它的
          Key 全部调用失败。
        </p>
      )}
      <div className='flex justify-end gap-2'>
        <Button variant='outline' disabled={save.isPending} onClick={onDone}>
          返回
        </Button>
        <Button
          disabled={save.isPending || !name.trim()}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          保存
        </Button>
      </div>
    </div>
  )
}
