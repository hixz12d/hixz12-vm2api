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
        '/logs',
        '/models',
        '/overview',
        '/protocol',
        '/proxies',
        '/settings',
        '/statistics',
        '/system',
        '/usage',
        '/users',
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
      expect.arrayContaining(['/wrap', '/protocol', '/database', '/system'])
    )
  })

  it('shows statistics next to usage, ahead of logs', () => {
    const groups = navGroupsFor(['usage', 'statistics', 'logs'])
    const items = groups.flatMap((group) => group.items)

    expect(items.map((item) => item.url)).toEqual([
      '/usage',
      '/statistics',
      '/logs',
    ])
    expect(items[1].title).toBe('统计')
  })
})
