import { useEffect } from 'react'
import { Check, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/context/theme-provider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/** 浏览器地址栏颜色，跟主题底色一致。 */
const THEME_COLOR = { dark: '#15120f', light: '#f6f1e6' } as const

const THEME_OPTIONS = [
  { value: 'dark', label: '深色（夜间）' },
  { value: 'light', label: '浅色' },
  { value: 'system', label: '跟随系统' },
] as const

export function ThemeSwitch() {
  const { theme, resolvedTheme, setTheme } = useTheme()

  useEffect(() => {
    const metaThemeColor = document.querySelector("meta[name='theme-color']")
    if (metaThemeColor)
      metaThemeColor.setAttribute('content', THEME_COLOR[resolvedTheme])
  }, [resolvedTheme])

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='icon' className='size-8'>
          <Sun className='size-[1.1rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90' />
          <Moon className='absolute size-[1.1rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0' />
          <span className='sr-only'>切换深色 / 浅色</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {THEME_OPTIONS.map((opt) => (
          <DropdownMenuItem key={opt.value} onClick={() => setTheme(opt.value)}>
            {opt.label}
            <Check
              size={14}
              className={cn('ms-auto', theme !== opt.value && 'hidden')}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
