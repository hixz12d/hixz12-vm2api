import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CLIENT_TOOL_ENVIRONMENT_NOTE,
  preserveClientToolEnvironment,
} from '../../src/lib/identity/client-tool-environment.mjs'
import { finalizeWorkerPayload } from '../../src/lib/transport/go-worker-client.mjs'

const tools = [{ name: 'Bash', input_schema: { type: 'object', properties: {} } }]

for (const cwd of [String.raw`C:\Projects\demo`, '/mnt/c/Projects/demo', '/home/user/project']) {
  test(`preserves client path and runtime metadata without translating ${cwd}`, () => {
    const runtime = {
      type: 'text',
      text: '# Environment\n - Platform: linux\n - Primary working directory: /home/kincli\nMemory: /home/kincli/.claude/projects/memory/',
      cache_control: { type: 'ephemeral', ttl: '1h' },
    }
    const client = { type: 'text', text: `Client working directory: ${cwd}` }
    const body = {
      system: [runtime, client],
      messages: [{ role: 'user', content: 'inspect the project' }],
      tools,
      metadata: { user_id: 'caller' },
    }
    const before = structuredClone(body)
    const out = preserveClientToolEnvironment(body)
    assert.deepEqual(body, before)
    assert.deepEqual(out.system.slice(0, 2), before.system)
    assert.equal(out.system[2].text, CLIENT_TOOL_ENVIRONMENT_NOTE)
    assert.equal(out.messages, body.messages)
    assert.equal(out.tools, body.tools)
    assert.equal(out.metadata, body.metadata)
    assert.equal(preserveClientToolEnvironment(out), out)
    assert.doesNotMatch(CLIENT_TOOL_ENVIRONMENT_NOTE, /Windows|win32|powershell|\/mnt|\/home\/kincli/)
  })
}

test('does not add environment guidance to chat or web-only requests', () => {
  for (const body of [{ messages: [] }, { tools: [] }, { tools: [{ name: 'web_search' }] }]) {
    assert.equal(preserveClientToolEnvironment(body), body)
  }
})

test('keeps string system instructions byte-for-byte before the boundary note', () => {
  const body = {
    system: 'User explicitly requested the remote Linux server.',
    tools: [{ name: 'functions.exec_command' }],
  }
  const out = preserveClientToolEnvironment(body)
  assert.equal(out.system, body.system + '\n\n' + CLIENT_TOOL_ENVIRONMENT_NOTE)
  assert.equal(preserveClientToolEnvironment(out), out)
})

test('supports a namespaced file tool without inventing missing workspace facts', () => {
  const out = preserveClientToolEnvironment({ tools: [{ name: 'mcp__filesystem__read_file' }] })
  assert.deepEqual(out.system, [{ type: 'text', text: CLIENT_TOOL_ENVIRONMENT_NOTE }])
})

for (const cliHop of [false, true]) {
  test(`final outbound payload retains the boundary and original cache block (cliHop=${cliHop})`, () => {
    const block = {
      type: 'text',
      text: '# Environment\n - Platform: linux\n - Primary working directory: /home/kincli',
      cache_control: { type: 'ephemeral', ttl: '1h' },
    }
    const body = { model: 'claude-sonnet-5', system: [block], tools, messages: [{ role: 'user', content: 'pwd' }] }
    const out = finalizeWorkerPayload({ body, reqHeaders: {}, exec: { vm: {} }, identity: null, cliHop })
    assert.deepEqual(out.body.system[0], block)
    assert.equal(out.body.system.at(-1).text, CLIENT_TOOL_ENVIRONMENT_NOTE)
    assert.deepEqual(body.system, [block])
  })
}
