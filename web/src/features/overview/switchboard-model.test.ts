import type { ApiKeyItem } from '@/types/panel-keys'
import type { Vm } from '@/types/panel-vm'
import { describe, expect, it } from 'vitest'
import {
  buildLines,
  cordOf,
  lampOf,
  reachableVmIds,
  summarize,
} from './switchboard-model'

const vm = (id: string, key: NonNullable<Vm['availability']>['key']): Vm => ({
  id,
  has_token: key !== 'none',
  availability: { key, usable: key === 'ok' },
})

const groups = [
  { id: 1, name: 'Claude Pro', vm_ids: ['vm-01'] },
  { id: 2, name: 'Claude Max', vm_ids: ['vm-02', 'vm-03'] },
  { id: 3, name: '停用组', status: 'disabled', vm_ids: ['vm-01'] },
]

describe('switchboard lamps', () => {
  it('keeps healthy and operator-paused lines dark', () => {
    expect(lampOf(vm('a', 'ok')).lamp).toBeNull()
    expect(lampOf(vm('a', 'off')).lamp).toBeNull()
    expect(lampOf(vm('a', 'off')).idle).toBe(true)
    expect(lampOf(vm('a', 'none')).lamp).toBeNull()
  })

  it('lights amber for quota/cooldown and red for broken credentials', () => {
    expect(lampOf(vm('a', 'quota')).lamp).toBe('amber')
    expect(lampOf(vm('a', 'cool')).lamp).toBe('amber')
    expect(lampOf(vm('a', 'bad')).lamp).toBe('red')
  })

  it('puts lit lines first, red before amber', () => {
    const lines = buildLines(
      [vm('vm-01', 'ok'), vm('vm-02', 'quota'), vm('vm-03', 'bad')],
      groups
    )
    expect(lines.map((l) => l.vm.id)).toEqual(['vm-03', 'vm-02', 'vm-01'])
    expect(lines[0].groupName).toBe('Claude Max')
    expect(lines[0].cord).toBe('max')
  })
})

describe('status sentence', () => {
  it('says nothing needs attention when all lines are dark', () => {
    const s = summarize(
      buildLines([vm('vm-01', 'ok'), vm('vm-02', 'ok')], groups),
      0
    )
    expect(s.tone).toBeNull()
    expect(s.sentence).toBe('2 个账号都正常，没有需要处理的事')
  })

  it('does not count paused accounts as problems', () => {
    const s = summarize(
      buildLines([vm('vm-01', 'ok'), vm('vm-02', 'off')], groups),
      0
    )
    expect(s.lit).toHaveLength(0)
    expect(s.idleCount).toBe(1)
    expect(s.sentence).toBe('1 个在用的账号都正常，没有需要处理的事')
  })

  it('names broken and attention counts', () => {
    const s = summarize(
      buildLines(
        [vm('vm-01', 'bad'), vm('vm-02', 'quota'), vm('vm-03', 'ok')],
        groups
      ),
      0
    )
    expect(s.tone).toBe('red')
    expect(s.sentence).toBe('1 个账号出了问题，1 个账号需要留意，其余 1 个正常')
  })

  it('turns amber on recent request errors even if accounts are fine', () => {
    const s = summarize(buildLines([vm('vm-01', 'ok')], groups), 3)
    expect(s.tone).toBe('amber')
    expect(s.sentence).toContain('3 个请求出错')
  })
})

describe('key reach', () => {
  const key = (group_id?: number): ApiKeyItem => ({ id: 'k', group_id })
  it('lights the accounts in the key group', () => {
    expect([...reachableVmIds(key(2), groups)]).toEqual(['vm-02', 'vm-03'])
  })
  it('reaches nothing without a group or with a disabled group', () => {
    expect(reachableVmIds(key(), groups).size).toBe(0)
    expect(reachableVmIds(key(3), groups).size).toBe(0)
  })
  it('picks cord color from the group name', () => {
    expect(cordOf('sub2api Max')).toBe('max')
    expect(cordOf('Claude Pro')).toBe('pro')
    expect(cordOf('没绑分组')).toBe('other')
  })
})
