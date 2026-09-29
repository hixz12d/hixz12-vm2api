import type { Vm } from '@/types/panel-vm'
import { describe, expect, it } from 'vitest'
import { accountLamp } from './account-lines'

const vm = (key: NonNullable<Vm['availability']>['key']): Vm => ({
  id: 'vm-01',
  has_token: key !== 'none',
  availability: { key, usable: key === 'ok' },
})

describe('accountLamp', () => {
  it('keeps healthy, paused and empty accounts dark', () => {
    expect(accountLamp(vm('ok'))).toMatchObject({ lamp: null, idle: false })
    expect(accountLamp(vm('off'))).toMatchObject({
      lamp: null,
      idle: true,
      text: '已暂停调度',
    })
    expect(accountLamp(vm('none'))).toMatchObject({
      lamp: null,
      idle: true,
      text: '还没导入凭证',
    })
  })

  it('lights amber for quota/cooldown, red for broken credentials', () => {
    expect(accountLamp(vm('quota')).lamp).toBe('amber')
    expect(accountLamp(vm('sessions')).lamp).toBe('amber')
    expect(accountLamp(vm('cool')).lamp).toBe('amber')
    expect(accountLamp(vm('bad')).lamp).toBe('red')
  })
})
