import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type RevealedKey = {
  title: string
  name?: string
  id?: string
  key: string
}

export function KeyRevealDialog({
  value,
  onClose,
}: {
  value: RevealedKey | null
  onClose: () => void
}) {
  const plain = value?.key || ''

  function copy() {
    if (!plain) {
      toast.error('没有可复制的 Key')
      return
    }
    void navigator.clipboard
      .writeText(plain)
      .then(() => toast.success('Key 已复制，注意不要泄露'))
      .catch(() => toast.error('复制失败'))
  }

  return (
    <Dialog open={!!value} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {value?.title || 'Key'}
            {value?.name ? ` · ${value.name}` : ''}
          </DialogTitle>
        </DialogHeader>
        <p className='text-xs text-muted-foreground'>
          {value?.id ? (
            <span className='font-mono'>{value.id}</span>
          ) : (
            '完整的 Key 只在这里显示'
          )}
        </p>
        <button
          type='button'
          className='w-full cursor-pointer rounded-md border bg-muted/40 p-3 text-left font-mono text-sm break-all'
          onClick={copy}
        >
          {plain}
        </button>
        <p className='text-sm text-destructive'>
          点上面的文字或「复制」按钮就能复制。关闭后列表里只显示开头和结尾几位；以后还能在列表里点「查看」或「复制」再拿到它。
        </p>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            关闭
          </Button>
          <Button onClick={copy}>复制</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
