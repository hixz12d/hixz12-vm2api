import type { Vm } from '@/types/panel-vm'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Tabs } from '@/components/ui/tabs'
import { VmOpsTab } from './detail-ops-tab'

function render(vm: Vm) {
  const noop = () => {}
  return renderToStaticMarkup(
    <Tabs defaultValue='ops'>
      <VmOpsTab
        vm={vm}
        proxy={{}}
        officialCc={true}
        credType='oauth'
        canRefresh={true}
        refreshBlocked=''
        savingTimezone={false}
        onAction={noop}
        onTimezoneSave={noop}
        onTimezoneFollowProxy={noop}
        onReset={noop}
        onDelete={noop}
      />
    </Tabs>
  )
}

describe('operations guest collection display', () => {
  it('renders generated hostname with an explicit uncollected status', () => {
    const html = render({
      id: 'vm-02',
      fingerprint: { hostname: 'debian-a3f1', source: 'generated' },
    })
    expect(html).toContain('debian-a3f1')
    expect(html).toContain('已生成，未采集')
    expect(html).not.toContain('<time')
  })

  it('renders actual collected hostname and collection time', () => {
    const html = render({
      id: 'vm-01',
      runtime: {
        guest_hostname: 'actual-guest',
        identity_collected_at: '2026-09-20T00:00:00Z',
      },
    })
    expect(html).toContain('actual-guest')
    expect(html).toContain('已采集')
    expect(html).toContain('dateTime="2026-09-20T00:00:00Z"')
    expect(html).toContain('采集特征')
  })
})
