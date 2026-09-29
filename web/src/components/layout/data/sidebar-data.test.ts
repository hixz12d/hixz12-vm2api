import { describe, expect, it } from 'vitest'
import { navGroupsFor } from './sidebar-data'

describe('sidebar permissions', () => {
  it('does not treat an explicit empty view list as unrestricted', () => {
    expect(navGroupsFor([])).toEqual([])
  })

  it('shows only routes named by the panel capability list', () => {
    const groups = navGroupsFor(['overview', 'logs'])
    const urls = groups.flatMap((group) => group.items.map((item) => item.url))

    expect(urls).toEqual(['/overview', '/logs'])
  })

  it('keeps every page reachable after regrouping', () => {
    const urls = navGroupsFor(null)
      .flatMap((group) => group.items.map((item) => item.url))
      .sort()

    expect(urls).toEqual(
      [
        '/cluster',
        '/database',
        '/import',
        '/keys',
        '/loadtest',
        '/logs',
        '/models',
        '/overview',
        '/protocol',
        '/proxies',
        '/settings',
        '/usage',
        '/vm',
        '/wrap',
      ].sort()
    )
  })

  it('puts the three daily jobs first and low-level pages under 高级', () => {
    const groups = navGroupsFor(null)
    const daily = groups[0].items.map((item) => item.url)
    const advanced = groups.find((group) => group.title === '高级')

    expect(daily).toEqual(
      expect.arrayContaining(['/overview', '/vm', '/keys', '/import'])
    )
    expect(advanced?.items.map((item) => item.url)).toEqual(
      expect.arrayContaining(['/wrap', '/protocol', '/database'])
    )
  })
})
