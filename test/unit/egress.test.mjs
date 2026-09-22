import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  LOCAL_EGRESS_ID,
  boundProxyUrl,
  bridgeName,
  chainName,
  egressEnabled,
  hasBoundExit,
  inspectEgressNetwork,
  inspectEgressProcess,
  iptablesPlan,
  isLocalEgressProxy,
  localEgressStatus,
  networkName,
  portsForProxy,
  slotNetworkForVm,
} from '../../src/lib/vm/egress.mjs'

test('names stay short and stable per proxy id', () => {
  assert.equal(networkName('px-a1b2c3d4'), 'kin-eg-px-a1b2c3d4')
  assert.ok(bridgeName('px-a1b2c3d4').length <= 15)
  assert.equal(bridgeName('px-a1b2c3d4'), bridgeName('px-a1b2c3d4'))
  assert.ok(chainName('px-a1b2c3d4').startsWith('KEG'))
})

test('ports are even/odd pair in 20000-35999', () => {
  const a = portsForProxy('px-a1b2c3d4')
  const b = portsForProxy('px-ffffffff')
  assert.equal(a.dns, a.tcp + 1)
  assert.ok(a.tcp >= 20000 && a.tcp < 36000)
  assert.notEqual(a.tcp, b.tcp)
})

test('iptables plan redirects tcp and dns, returns subnet, drops the rest', () => {
  const plan = iptablesPlan({
    chain: 'KEGa1b2c3d4',
    bridge: 'kega1b2c3d4',
    subnet: '172.31.0.0/24',
    tcpPort: 20010,
    dnsPort: 20011,
  })
  const joined = plan.add.map((row) => row.join(' '))
  assert.ok(joined.some((s) => s.includes('REDIRECT --to-ports 20010')))
  assert.ok(joined.some((s) => s.includes('--dport 53') && s.includes('20011')))
  assert.ok(joined.some((s) => s.includes('-p tcp --dport 53') && s.includes('20011')))
  assert.ok(joined.some((s) => s.includes('-F KEGa1b2c3d4')))
  assert.ok(joined.some((s) => s.includes('-d 172.31.0.0/24 -j RETURN')))
  assert.ok(joined.some((s) => s.includes('FORWARD') && s.includes('DROP')))
  assert.ok(plan.del.some((row) => row.includes('-X')))
})

test('host firewall admits only the proxy bridge listeners and removes the same rules', () => {
  const plan = iptablesPlan({
    chain: 'KEGtest',
    bridge: 'kegtest',
    subnet: '172.27.0.0/16',
    gateway: '172.27.0.254',
    tcpPort: 25884,
    dnsPort: 25885,
  })
  const inserts = plan.add.filter((row) => row[2] === '-I' && row[3] === 'INPUT')
  assert.equal(inserts.length, 3)
  const destinations = new Set()
  for (const insert of inserts) {
    assert.equal(insert[4], '1', 'accept before UFW/default-deny rules')
    const rule = insert.slice(5)
    const value = (flag) => rule[rule.indexOf(flag) + 1]
    assert.equal(value('-i'), 'kegtest')
    assert.equal(value('-s'), '172.27.0.0/16')
    assert.equal(value('-d'), '172.27.0.254', 'use actual Docker gateway')
    assert.equal(value('-j'), 'ACCEPT')
    destinations.add(`${value('-p')}:${value('--dport')}`)
    const index = plan.add.indexOf(insert)
    assert.deepEqual(plan.add[index - 1], ['-t', 'filter', '-C', 'INPUT', ...rule], 'idempotent check')
    assert.ok(plan.del.some((row) => JSON.stringify(row) === JSON.stringify(['-t', 'filter', '-D', 'INPUT', ...rule])))
    assert.ok(index < plan.add.findIndex((row) => row.includes('REDIRECT')), 'allow listeners before redirect')
  }
  assert.deepEqual([...destinations].sort(), ['tcp:25884', 'tcp:25885', 'udp:25885'])
})

test('legacy plan callers derive a gateway and missing network cleanup never allows all sources', () => {
  const opts = { chain: 'KEGtest', bridge: 'kegtest', tcpPort: 20010, dnsPort: 20011 }
  const plan = iptablesPlan({ ...opts, subnet: '172.31.0.0/24' })
  const input = plan.add.filter((row) => row.includes('INPUT'))
  assert.equal(input.length, 6)
  assert.ok(input.every((row) => row[row.indexOf('-d') + 1] === '172.31.0.1'))
  const missing = iptablesPlan({ ...opts, subnet: '0.0.0.0/0', gateway: '' })
  assert.ok(!missing.add.some((row) => row.includes('INPUT')))
  assert.ok(!missing.del.some((row) => row.includes('INPUT')))
})
test('slot network is bound proxy net and never host', () => {
  const vm = { proxy: { id: 'px-a1b2c3d4' } }
  assert.equal(slotNetworkForVm(vm, { KIN_VM_NETWORK: 'host' }), 'kin-eg-px-a1b2c3d4')
  assert.equal(slotNetworkForVm({}, { KIN_VM_NETWORK: 'host' }), '')
  assert.equal(egressEnabled({}), true)
  assert.equal(egressEnabled({ KIN_EGRESS: '0' }), true)
})

test('local egress is identified and has no SOCKS url', () => {
  assert.equal(isLocalEgressProxy({ id: LOCAL_EGRESS_ID }), true)
  assert.equal(isLocalEgressProxy({ scheme: 'local', host: 'local' }), true)
  assert.equal(isLocalEgressProxy({ host: '1.2.3.4', port: 1080 }), false)
  assert.equal(boundProxyUrl({ id: LOCAL_EGRESS_ID, host: 'local', port: 0 }), '')
  assert.equal(slotNetworkForVm({ proxy: { id: LOCAL_EGRESS_ID } }), 'kin-eg-px-local')
})

test('inspectEgressNetwork exposes name and network for slot start', () => {
  const info = inspectEgressNetwork('px-local', () => ({
    ok: true,
    stdout: '192.168.144.0/20|192.168.144.1',
  }))
  assert.equal(info.name, 'kin-eg-px-local')
  assert.equal(info.network, 'kin-eg-px-local')
  assert.equal(info.subnet, '192.168.144.0/20')
  assert.equal(info.gateway, '192.168.144.1')
})

test('inspectEgressProcess reports missing pid as not_running', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-eg-inspect-'))
  const st = inspectEgressProcess(root, 'px-deadbeef')
  assert.equal(st.ok, false)
  assert.equal(st.reason, 'not_running')
  fs.rmSync(root, { recursive: true, force: true })
})

test('local egress is a bound exit even when the SOCKS url is empty', () => {
  assert.equal(hasBoundExit({ id: LOCAL_EGRESS_ID, host: 'local', port: 0, url: null }), true)
  assert.equal(hasBoundExit({ scheme: 'local', host: '10.0.0.8', port: 1080 }), true)
  assert.equal(hasBoundExit({ host: '10.0.0.1', port: 1080 }), true)
  assert.equal(hasBoundExit({ host: '10.0.0.1' }), false)
  assert.equal(hasBoundExit(null), false)
})

test('local egress health follows the masquerade net for any local row', () => {
  const hit = localEgressStatus({ id: 'px-other', scheme: 'local' }, () => ({
    ok: true,
    stdout: '192.168.144.0/20|192.168.144.1',
  }))
  assert.equal(hit.ok, true)
  assert.equal(hit.mode, 'local')
  assert.equal(hit.name, 'kin-eg-px-other')
  const miss = localEgressStatus({ id: LOCAL_EGRESS_ID }, () => ({ ok: false, stderr: 'not found' }))
  assert.equal(miss.ok, false)
  assert.equal(miss.reason, 'local_network_missing')
  assert.equal(localEgressStatus({ id: 'px-socks', host: '10.0.0.1', port: 1080 }), null)
})
