import { Skeleton } from '@/components/ui/skeleton'

/**
 * 总览页首屏骨架，对应实际结构：状态句 → 账号线（左）+ Key 面板（右）→ 折叠的详细数据。
 */
export function OverviewSkeleton() {
  return (
    <div className='space-y-4'>
      <Skeleton className='h-[54px] rounded-md' />
      <div className='grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]'>
        <div className='overflow-hidden rounded-md border'>
          <Skeleton className='h-10 rounded-none' />
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className='grid gap-5 border-t px-4 py-4 md:grid-cols-[1.1fr_1fr_1fr]'
            >
              <div className='space-y-2'>
                <Skeleton className='h-5 w-32' />
                <Skeleton className='h-3 w-24' />
              </div>
              <Skeleton className='h-8' />
              <Skeleton className='h-8' />
            </div>
          ))}
        </div>
        <Skeleton className='h-[220px] rounded-md' />
      </div>
      <Skeleton className='h-8 rounded-md' />
    </div>
  )
}
