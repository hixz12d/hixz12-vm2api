import { useRef } from 'react'
import { toast } from 'sonner'
import { copyText } from '@/lib/clipboard'
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
  const fieldRef = useRef<HTMLTextAreaElement>(null)

  function selectKey() {
    fieldRef.current?.focus()
    fieldRef.current?.select()
  }

  async function copy() {
    if (!plain) {
      toast.error('没有可复制的 Key')
      return
    }
    if (await copyText(plain)) {
      toast.success('Key 已复制，注意不要泄露')
      return
    }
    // Last resort works everywhere: leave the key selected for Ctrl/⌘+C.
    selectKey()
    toast.error('浏览器不让写剪贴板，已帮你选中 Key，请按 Ctrl+C（Mac 为 ⌘+C）复制')
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
        <textarea
          ref={fieldRef}
          readOnly
          rows={2}
          aria-label='完整 Key'
          spellCheck={false}
          value={plain}
          onFocus={(e) => e.currentTarget.select()}
          className='w-full resize-none rounded-md border bg-muted/40 p-3 font-mono text-sm break-all outline-none focus-visible:ring-2 focus-visible:ring-ring'
        />
        <p className='text-sm text-destructive'>
          点上面的文字或「复制」按钮就能复制。关闭后列表里只显示开头和结尾几位；以后还能在列表里点「查看」或「复制」再拿到它。
        </p>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            关闭
          </Button>
          <Button onClick={() => void copy()}>复制</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
