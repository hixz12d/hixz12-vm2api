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
import {
  groupsQueryOptions,
  type AccountGroup,
  type GroupsPayload,
} from './groups-query'

export function GroupsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
}) {
  const q = useQuery(groupsQueryOptions())
  const [editing, setEditing] = useState<AccountGroup | 'new' | null>(null)
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
          密钥只使用绑定分组内的槽位账号。组内无可用账号时返回错误，不会跨组回退。一个账号可以加入多个分组。
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
                          .join('、') || '暂无账号'}
                      </p>
                    </div>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => setEditing(group)}
                    >
                      编辑
                    </Button>
                  </div>
                ))}
              </div>
            </>
          ))}
      </DialogContent>
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
        <legend className='px-1 text-sm font-medium'>账号成员</legend>
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
              {slot.status === 'running' ? '运行中' : '未运行'}
            </span>
          </label>
        ))}
        {!slots.length && (
          <p className='text-sm text-muted-foreground'>暂无槽位账号</p>
        )}
      </fieldset>
      {!members.length && (
        <p className='text-sm text-muted-foreground'>
          该分组为空，绑定它的密钥将无法调用任何槽位。
        </p>
      )}
      {initial && (
        <p className='text-xs text-muted-foreground'>
          更改成员或停用分组后，已绑定密钥的后续请求立即按新配置调度；已开始的请求正常完成。
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
