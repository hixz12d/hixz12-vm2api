import { describe, expect, it } from 'vitest'
import { guestIdentityState } from './guest-identity'

describe('guest collection status', () => {
  it('does not present a generated hostname as a successful collection', () => {
    expect(
      guestIdentityState({
        fingerprint: { hostname: 'debian-a3f1', source: 'generated' },
      })
    ).toEqual({
      hostname: 'debian-a3f1',
      status: '已生成，未采集',
      collectedAt: null,
    })
    expect(guestIdentityState({})).toMatchObject({
      hostname: '—',
      status: '未采集',
    })
  })

  it('shows collected guest hostname rather than the configured persona hostname', () => {
    const at = '2026-09-20T00:00:00Z'
    expect(
      guestIdentityState({
        fingerprint: { hostname: 'debian-a3f1', source: 'generated' },
        runtime: { guest_hostname: 'actual-guest', identity_collected_at: at },
      })
    ).toEqual({ hostname: 'actual-guest', status: '已采集', collectedAt: at })
  })

  it('supports previous collection records and rejects invalid timestamps', () => {
    const at = '2026-09-20T00:00:00Z'
    expect(
      guestIdentityState({
        fingerprint: { hostname: 'guest', collected_at: at },
      })
    ).toEqual({
      hostname: 'guest',
      status: '已采集',
      collectedAt: at,
    })
    expect(
      guestIdentityState({
        fingerprint: { hostname: 'guest', collected_at: 'invalid' },
      }).status
    ).toBe('未采集')
  })
})
