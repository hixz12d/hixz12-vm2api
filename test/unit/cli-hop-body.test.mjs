import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareCliHopBody, stripCliOwnedSystem } from '../../src/lib/protocol/outbound-attempt.mjs'
import { CRS_OFFICIAL_SYSTEM, CRS_OFFICIAL_CLI_SYSTEM } from '../../src/lib/identity/crs-persona.mjs'
import { CRS_OFFICIAL_AGENT_PROMPT } from '../../src/lib/identity/official-cc-system-2.1.241.mjs'
import { resolveCacheTtl } from '../../src/lib/protocol/cache-ttl.mjs'

test('cli-hop freezes the lifted context budget while preserving the fork cache boundary', () => {
  const budget = (n) => `<system-reminder>\n<total_tokens>${n} tokens left</total_tokens>\n</system-reminder>`
  const stable = budget(15000000)
  const first = prepareCliHopBody({
    model: 'claude-sonnet-5',
    max_tokens: 256,
    system: [{ type: 'text', text: 'persona' }],
    messages: [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'system', content: budget(14955783) },
    ],
  })
  const second = prepareCliHopBody({
    model: 'claude-sonnet-5',
    max_tokens: 256,
    system: [{ type: 'text', text: 'persona' }],
    messages: [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'system', content: budget(14955783) },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'u3' },
      { role: 'system', content: budget(14947383) },
    ],
  })
  assert.equal(first.system.at(-1).text, stable)
  assert.equal(second.system.at(-1).text, stable)
  assert.deepEqual(
    first.system.map((block) => block.text),
    second.system.map((block) => block.text),
  )
  assert.equal(second.messages[3].role, 'system')
  assert.equal(second.messages[3].content[0].text, stable)
  assert.deepEqual(second.messages[2].content[0].cache_control, { type: 'ephemeral', ttl: '5m' })
  assert.deepEqual(
    second.messages.slice(0, 3).map((message) => message.content[0].text),
    first.messages.map((message) => message.content[0].text),
  )
})

test('prepareCliHopBody clamps small max_tokens to 1024 for automated probe tests', () => {
  for (const [requested, expected] of [
    [1, 1024],
    [32, 1024],
    [64, 64],
    [4096, 4096],
  ]) {
    const body = prepareCliHopBody({
      model: 'claude-haiku-4-5',
      max_tokens: requested,
      messages: [{ role: 'user', content: 'ping' }],
    })
    assert.equal(body.max_tokens, expected)
  }
})

test('prepareCliHopBody drops metadata and CLI-owned system but keeps official agent leftover', () => {
  const body = prepareCliHopBody({
    model: 'claude-sonnet-5',
    max_tokens: 256,
    metadata: { user_id: '{"device_id":"abc"}' },
    system: [
      {
        type: 'text',
        text: "x-anthropic-billing-header: cc_version=2.8.4; prompt_version=You are a Claude agent, built on Anthropic's Claude Agent SDK.;",
      },
      { type: 'text', text: CRS_OFFICIAL_SYSTEM },
      { type: 'text', text: CRS_OFFICIAL_AGENT_PROMPT },
      { type: 'text', text: '# Environment\nTime zone: America/New_York' },
    ],
    messages: [{ role: 'user', content: 'hi' }],
  })
  assert.equal(body.metadata, undefined)
  assert.equal(body.system.length, 1)
  assert.equal(body.system[0].text, CRS_OFFICIAL_AGENT_PROMPT)
  assert.equal(body.model, 'claude-sonnet-5')
  assert.deepEqual(body.messages[0].content, [{ type: 'text', text: 'hi' }])
  assert.equal(body.stream, true)
})

test('prepareCliHopBody keeps caller leftover system and tools', () => {
  const body = prepareCliHopBody({
    model: 'claude-opus-5',
    max_tokens: 1024,
    system: [
      { type: 'text', text: CRS_OFFICIAL_CLI_SYSTEM },
      { type: 'text', text: '你是一个高速收费员。' },
    ],
    tools: [{ name: 'get_weather', input_schema: { type: 'object', properties: {} } }],
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: '你好呀。' }],
  })
  assert.equal(body.metadata, undefined)
  assert.equal(body.system.length, 1)
  assert.equal(body.system[0].text, '你是一个高速收费员。')
  assert.equal(body.tools[0].name, 'get_weather')
  assert.equal(body.thinking.type, 'disabled')
})

test('stripCliOwnedSystem leaves empty inbound system absent', () => {
  assert.equal(stripCliOwnedSystem(undefined), undefined)
  assert.equal(stripCliOwnedSystem(''), undefined)
  assert.equal(stripCliOwnedSystem([{ type: 'text', text: '' }]), undefined)
})

test('prepareCliHopBody fills 2.1.263 thinking effort and context_management', () => {
  const body = prepareCliHopBody({
    model: 'claude-sonnet-5',
    messages: [{ role: 'user', content: 'hello' }],
  })
  assert.deepEqual(body.thinking, { type: 'adaptive', display: 'omitted' })
  assert.equal(body.output_config.effort, 'high')
  assert.equal(body.context_management.edits[0].type, 'clear_thinking_20251015')
  assert.equal(body.metadata, undefined)
  assert.equal(body.system, undefined)
})

test('prepareCliHopBody does not overwrite caller thinking disabled', () => {
  const body = prepareCliHopBody({
    model: 'claude-sonnet-5',
    max_tokens: 256,
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: 'hi' }],
  })
  assert.equal(body.thinking.type, 'disabled')
  assert.equal(body.context_management, undefined)
})

test('prepareCliHopBody strips unsigned empty dummy and short thinking history', () => {
  const body = prepareCliHopBody({
    model: 'claude-sonnet-5',
    max_tokens: 256,
    messages: [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'keep-me', signature: 'sig_real_1234567890abcdef' },
          { type: 'thinking', thinking: 'no-sig' },
          { type: 'thinking', thinking: '', signature: 'sig_empty_text_still_long_enough' },
          { type: 'thinking', thinking: 'dummy', signature: 'skip_thought_signature_validator' },
          { type: 'thinking', thinking: 'short', signature: 'abc' },
          { type: 'text', text: 'hello' },
        ],
      },
      { role: 'user', content: 'again' },
    ],
  })
  assert.deepEqual(body.thinking, { type: 'adaptive', display: 'omitted' })
  assert.equal(body.temperature, 1)
  assert.deepEqual(body.messages[1].content, [
    { type: 'thinking', thinking: 'keep-me', signature: 'sig_real_1234567890abcdef' },
    { type: 'text', text: 'hello' },
  ])
})

test('prepareCliHopBody repaired does not refill thinking after signature downgrade', () => {
  const body = prepareCliHopBody(
    {
      model: 'claude-sonnet-5',
      max_tokens: 256,
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'plan' },
            { type: 'text', text: 'hello' },
          ],
        },
        { role: 'user', content: 'again' },
      ],
    },
    { repaired: true },
  )
  assert.equal(body.thinking, undefined)
  assert.equal(body.context_management, undefined)
  assert.deepEqual(body.messages[1].content, [
    { type: 'text', text: 'plan' },
    { type: 'text', text: 'hello' },
  ])
})

test('prepareCliHopBody disables thinking on Haiku so wrap CLI cannot inherit adaptive', () => {
  const body = prepareCliHopBody({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{ role: 'user', content: 'hello' }],
  })
  assert.equal(body.thinking?.type, 'disabled')
  assert.equal(body.output_config, undefined)
  assert.equal(body.context_management, undefined)
})

test('prepareCliHopBody disables Haiku adaptive thinking', () => {
  const body = prepareCliHopBody({
    model: 'claude-haiku-4-5',
    max_tokens: 256,
    thinking: { type: 'adaptive', display: 'omitted' },
    messages: [{ role: 'user', content: 'hello' }],
  })
  assert.equal(body.thinking.type, 'disabled')
})

test('cli-hop strips tool/system/message cache_control for wrap CLI', () => {
  const body = prepareCliHopBody(
    {
      model: 'claude-sonnet-5',
      max_tokens: 256,
      tools: [
        { name: 'Read', input_schema: { type: 'object', properties: {} } },
        {
          name: 'Write',
          input_schema: { type: 'object', properties: {} },
          cache_control: { type: 'ephemeral', ttl: '5m' },
        },
      ],
      system: [
        {
          type: 'text',
          text: CRS_OFFICIAL_AGENT_PROMPT,
          cache_control: { type: 'ephemeral', ttl: '1h', scope: 'global' },
        },
      ],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral', ttl: '1h' } }] },
      ],
    },
    { cacheTtl: '5m' },
  )
  assert.equal(body.tools[1].cache_control, undefined)
  assert.equal(body.system[0].cache_control, undefined)
  assert.equal(body.messages[0].content[0].cache_control, undefined)
})

test('cli-hop default 5m leaves last user unmarked for wrap', () => {
  const body = prepareCliHopBody(
    {
      model: 'claude-sonnet-5',
      max_tokens: 256,
      tools: [
        {
          name: 'Write',
          input_schema: { type: 'object', properties: {} },
          cache_control: { type: 'ephemeral', ttl: '5m' },
        },
      ],
      system: [{ type: 'text', text: CRS_OFFICIAL_AGENT_PROMPT, cache_control: { type: 'ephemeral', ttl: '1h' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    },
    { cacheTtl: '5m' },
  )
  assert.equal(body.tools[0].cache_control, undefined)
  assert.equal(body.system[0].cache_control, undefined)
  assert.equal(body.messages[0].content[0].cache_control, undefined)
})

test('cli-hop disabled preserves breakpoint positions but clamps their TTL to 5m', () => {
  const body = prepareCliHopBody(
    {
      model: 'claude-sonnet-5',
      max_tokens: 256,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'u1', cache_control: { type: 'ephemeral', ttl: '1h' } }] },
        { role: 'assistant', content: [{ type: 'text', text: 'a1' }] },
        { role: 'user', content: [{ type: 'text', text: 'u2', cache_control: { type: 'ephemeral', ttl: '1h' } }] },
        { role: 'assistant', content: [{ type: 'text', text: 'a2' }] },
        { role: 'user', content: [{ type: 'text', text: 'u3', cache_control: { type: 'ephemeral', ttl: '1h' } }] },
      ],
    },
    { cacheBreakpoints: { enabled: false } },
  )
  assert.equal(body.messages[0].content[0].cache_control.ttl, '5m')
  assert.equal(body.messages[2].content[0].cache_control.ttl, '5m')
  assert.equal(body.messages[4].content[0].cache_control, undefined)
})

test('cli-hop rewrite wins over routing fill when inbound already stamped last user', () => {
  const body = prepareCliHopBody(
    {
      model: 'claude-sonnet-5',
      max_tokens: 256,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'u1' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'a1' }] },
        { role: 'user', content: [{ type: 'text', text: 'u2' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'a2' }] },
        {
          role: 'user',
          content: [{ type: 'text', text: 'u3', cache_control: { type: 'ephemeral', ttl: '5m' } }],
        },
      ],
    },
    {
      cacheBreakpoints: {
        enabled: true,
        preserve_client: true,
        system_tail: true,
        tools_tail: true,
        messages: 'fill',
      },
    },
  )
  assert.equal(body.messages[0].content[0].cache_control, undefined)
  assert.deepEqual(body.messages[2].content[0].cache_control, { type: 'ephemeral', ttl: '5m' })
  assert.equal(body.messages[4].content[0].cache_control, undefined)
})

test('cli-hop rewrite clamps requested 1h to the kernel-compatible 5m TTL', () => {
  const body = prepareCliHopBody(
    {
      model: 'claude-sonnet-5',
      max_tokens: 256,
      messages: [
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u2' },
        { role: 'assistant', content: 'a2' },
        { role: 'user', content: 'u3' },
      ],
    },
    { cacheTtl: '1h' },
  )
  assert.deepEqual(body.messages[2].content[0].cache_control, { type: 'ephemeral', ttl: '5m' })
  assert.equal(body.messages[4].content[0].cache_control, undefined)
})

test('cli-hop rewrites a console 1h boundary to 5m so it cannot follow wrap tools', () => {
  const body = prepareCliHopBody(
    {
      model: 'claude-sonnet-5',
      max_tokens: 256,
      tools: [{ name: 'Read', cache_control: { type: 'ephemeral', ttl: '5m' } }],
      system: [{ type: 'text', text: 'caller system', cache_control: { type: 'ephemeral', ttl: '5m' } }],
      messages: [
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u2' },
        { role: 'assistant', content: 'a2' },
        { role: 'user', content: 'u3' },
      ],
    },
    { cacheTtl: '1h' },
  )
  assert.equal(body.tools[0].cache_control, undefined)
  assert.equal(body.system[0].cache_control, undefined)
  assert.deepEqual(body.messages[2].content[0].cache_control, { type: 'ephemeral', ttl: '5m' })
  assert.equal(body.messages[4].content[0].cache_control, undefined)
})

test('cli-hop writes the Node-owned boundary at 5m when the console asks for 5m', () => {
  const body = prepareCliHopBody(
    {
      model: 'claude-sonnet-5',
      max_tokens: 256,
      messages: [
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u2' },
        { role: 'assistant', content: 'a2' },
        { role: 'user', content: 'u3' },
      ],
    },
    { cacheTtl: '5m' },
  )
  assert.deepEqual(body.messages[2].content[0].cache_control, { type: 'ephemeral', ttl: '5m' })
  assert.equal(body.messages[4].content[0].cache_control, undefined)
})

test('official short cli-hop removes client markers owned by the kernel', () => {
  const body = prepareCliHopBody(
    {
      model: 'claude-sonnet-5',
      max_tokens: 256,
      system: [{ type: 'text', text: CRS_OFFICIAL_AGENT_PROMPT, cache_control: { type: 'ephemeral', ttl: '1h' } }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'u1', cache_control: { type: 'ephemeral', ttl: '1h' } }] },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: [{ type: 'text', text: 'u2', cache_control: { type: 'ephemeral', ttl: '5m' } }] },
      ],
    },
    { cacheTtl: null },
  )
  assert.equal(body.system[0].cache_control, undefined)
  assert.equal(body.messages[0].content[0].cache_control, undefined)
  assert.equal(body.messages[2].content[0].cache_control, undefined)
  assert.equal(JSON.stringify(body).includes('"ttl":"1h"'), false)
})

test('cli-hop rewrite keeps sub2api penultimate user after dropping CLI last-user stamp', () => {
  const body = prepareCliHopBody({
    model: 'claude-sonnet-5',
    max_tokens: 256,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'u1' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a1' }] },
      { role: 'user', content: [{ type: 'text', text: 'u2', cache_control: { type: 'ephemeral', ttl: '5m' } }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a2' }] },
    ],
  })
  assert.deepEqual(body.messages[0].content[0].cache_control, { type: 'ephemeral', ttl: '5m' })
  assert.equal(body.messages[2].content[0].cache_control, undefined)
  assert.equal(body.messages[3].content[0].cache_control, undefined)
})

test('unofficial cli-hop rewrite matches official penultimate-user leftover', () => {
  const inbound = {
    model: 'claude-sonnet-5',
    max_tokens: 256,
    messages: [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'u3' },
    ],
  }
  const unofficial = prepareCliHopBody(inbound, { unofficial: true })
  const official = prepareCliHopBody(structuredClone(inbound), { unofficial: false })
  assert.equal(unofficial.messages[0].content[0].cache_control, undefined)
  assert.deepEqual(unofficial.messages[2].content[0].cache_control, { type: 'ephemeral', ttl: '5m' })
  assert.equal(unofficial.messages[4].content[0].cache_control, undefined)
  assert.deepEqual(
    unofficial.messages.map((message) => message.content?.[0]?.cache_control),
    official.messages.map((message) => message.content?.[0]?.cache_control),
  )
})

test('cli-hop lifts trailing system constraints so the hop ends with a user turn', () => {
  const leftover = {
    model: 'claude-sonnet-5',
    max_tokens: 256,
    system: [{ type: 'text', text: 'persona system prefix' }],
    messages: [
      { role: 'user', content: 'u1' },
      { role: 'system', content: 'caller constraint after current user' },
    ],
  }
  const firstTurn = prepareCliHopBody(leftover, { unofficial: true })
  assert.equal(firstTurn.messages.length, 1)
  assert.equal(firstTurn.messages[0].role, 'user')
  assert.equal(firstTurn.messages[0].content[0].text, 'u1')
  assert.equal(firstTurn.system.at(-1).text, 'caller constraint after current user')
  assert.equal(firstTurn.messages[0].content[0].cache_control, undefined)
  assert.ok(firstTurn.system.every((block) => block.cache_control == null))

  const later = prepareCliHopBody({
    ...leftover,
    messages: [
      { role: 'user', content: 'u1' },
      { role: 'system', content: 'historical constraint' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'system', content: 'current constraint' },
    ],
  })
  assert.equal(later.messages[1].role, 'system')
  assert.equal(later.messages.at(-1).role, 'user')
  assert.equal(later.messages.at(-1).content[0].text, 'u2')
  assert.equal(later.system.at(-1).text, 'current constraint')
  assert.deepEqual(later.messages[0].content[0].cache_control, { type: 'ephemeral', ttl: '5m' })
  assert.equal(later.messages[1].content[0].cache_control, undefined)
  assert.equal(later.messages.at(-1).content[0].cache_control, undefined)
  assert.ok(later.system.every((block) => block.cache_control == null))
})

test('official multi-turn traffic with a null resolved TTL never creates an hour marker', () => {
  const inbound = {
    model: 'claude-opus-5',
    messages: [
      { role: 'user', content: 'Read the public example.' },
      { role: 'system', content: 'Use tools to inspect files.' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'read_1', name: 'Read', input: { file_path: '/tmp/example.txt' } }],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read_1', content: 'Example contents.' }] },
    ],
  }
  const cacheTtl = resolveCacheTtl({
    body: inbound,
    routing: { compatibility: { cache_ttl: '5m' } },
    officialTraffic: true,
  })
  assert.equal(cacheTtl, null)
  const out = prepareCliHopBody(inbound, { cacheTtl, unofficial: false })
  assert.deepEqual(out.messages[0].content[0].cache_control, { type: 'ephemeral', ttl: '5m' })
  assert.equal(out.messages[1].content[0].cache_control, undefined)
  assert.equal(out.messages.at(-1).content[0].tool_use_id, 'read_1')
  assert.equal(out.messages.at(-1).content[0].cache_control, undefined)
  assert.equal(JSON.stringify(out).includes('"ttl":"1h"'), false)
})

test('cli-hop strips Claude Code last tool_use/tool_result markers', () => {
  const body = prepareCliHopBody({
    model: 'claude-sonnet-5',
    max_tokens: 256,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'u1' }] },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'x', signature: 'sig' },
          { type: 'tool_use', id: 't1', name: 'Read', input: {}, cache_control: { type: 'ephemeral' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok', cache_control: { type: 'ephemeral' } }],
      },
    ],
  })
  const asstBlocks = body.messages[1].content
  const userBlocks = body.messages[2].content
  assert.equal(asstBlocks.find((b) => b.type === 'tool_use')?.cache_control, undefined)
  assert.equal(userBlocks.find((b) => b.type === 'tool_result')?.cache_control, undefined)
})

test('cli-hop makes Opus 5.5 acceptable to Claude Code 2.1.280', () => {
  const body = prepareCliHopBody({
    model: 'claude-opus-5.5',
    thinking: { type: 'enabled', budget_tokens: 8000, display: 'summarized' },
    output_config: { effort: 'high' },
    tool_choice: { type: 'tool', name: 'get_weather' },
    tools: [
      { name: 'get_weather', input_schema: { type: 'object' } },
      { type: 'computer_20251124', name: 'computer' },
    ],
    messages: [{ role: 'user', content: 'hi' }],
  })
  assert.equal(body.model, 'claude-opus-5-5')
  assert.deepEqual(body.thinking, { type: 'adaptive', display: 'summarized' })
  assert.equal(body.thinking.budget_tokens, undefined)
  assert.equal(body.output_config.effort, 'high')
  assert.deepEqual(body.tool_choice, { type: 'auto' })
  assert.equal(body.tools.find((tool) => tool.name === 'get_weather').strict, true)
  assert.equal(body.tools.find((tool) => tool.name === 'computer').type, 'computer_toolset_20260801')

  const filled = prepareCliHopBody({
    model: 'claude-opus-5-5',
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: 'hi' }],
  })
  assert.equal(filled.thinking.type, 'adaptive')
  assert.equal(filled.thinking.budget_tokens, undefined)
  assert.equal(filled.output_config.effort, 'medium')

  const opus5 = prepareCliHopBody({
    model: 'claude-opus-5',
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: 'hi' }],
  })
  assert.equal(opus5.thinking.type, 'disabled')
  assert.equal(opus5.output_config.effort, 'high')
})
