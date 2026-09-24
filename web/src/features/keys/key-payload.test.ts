import { describe, expect, it } from 'vitest'
import { keyLimitsPayload, type KeyLimitsDraft } from './key-payload'

const draft: KeyLimitsDraft = {
  name: ' ops ',
  category: 'api',
  max_concurrency: 4,
  quota_requests: 12,
  quota_usd: 3.5,
  rpm: 60,
  expires_in_days: 30,
}

describe('API key limit payload', () => {
  it('sends selected OAuth group on create and edit and keeps API keys on the default group', () => {
    for (const mode of ['create', 'edit'] as const) {
      expect(
        keyLimitsPayload({ ...draft, category: 'oauth', group_id: 7 }, mode)
          .group_id
      ).toBe(7)
      expect(
        keyLimitsPayload({ ...draft, category: 'api', group_id: 7 }, mode)
          .group_id
      ).toBe(1)
    }
    expect(() => keyLimitsPayload({ ...draft, group_id: 0 }, 'create')).toThrow(
      '有效分组'
    )
  })
  it('keeps request and USD quotas separate', () => {
    expect(keyLimitsPayload(draft, 'create')).toEqual({
      name: 'ops',
      category: 'api',
      max_concurrency: 4,
      quota_requests: 12,
      quota_usd: 3.5,
      rpm: 60,
      expires_in_days: 30,
    })
  })

  it('omits create-only fields from edits and rejects invalid quotas', () => {
    expect(keyLimitsPayload(draft, 'edit')).not.toHaveProperty('name')
    expect(keyLimitsPayload(draft, 'edit')).not.toHaveProperty(
      'expires_in_days'
    )
    expect(() =>
      keyLimitsPayload({ ...draft, quota_requests: 1.5 }, 'create')
    ).toThrow('请求额度')
    expect(() =>
      keyLimitsPayload({ ...draft, quota_usd: -1 }, 'create')
    ).toThrow('USD 额度')
  })
})
