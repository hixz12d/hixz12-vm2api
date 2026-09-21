import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const moduleUrl = new URL('../../src/lib/transport/rust-kernel-supervisor.mjs', import.meta.url).href
for (const [value, expected] of [
  ['2', 2],
  ['20', 20],
  ['100', 20],
  ['0', 20],
  ['invalid', 20],
]) {
  test(`native slot startup override ${value} resolves to ${expected}`, () => {
    const result = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const { wrapSlotCount } = await import(${JSON.stringify(moduleUrl)}); console.log(wrapSlotCount());`,
      ],
      { env: { ...process.env, KIN_KERNEL_NATIVE_SLOTS: value }, encoding: 'utf8' },
    )
    assert.equal(Number(result.trim()), expected)
  })
}
