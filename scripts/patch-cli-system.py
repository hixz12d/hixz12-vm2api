#!/usr/bin/env python3
"""Apply the pinned native-slot system fix to an extracted CLI bundle.

Input is the original UTF-8 cli.js or its UPX-unpacked ELF, never a patched
bundle. Hashes and unique replacement counts deliberately reject new upstream
versions. Build the output with Bun 1.3.14+0d9b296af; see docs/CLI_SYSTEM_PATCH.md.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

BASELINES = {
    "cli-node": "7d5366daf48ae71c96dce3ede9151ddf332056006f0d57e9ad9e188923083a10",
    "cc-node": "6fef71bdda7ad0929681711efee472552635f88b0a6ead51f711d10e03f55ca5",
}


def replace_once(source, before, after):
    count = source.count(before)
    if count != 1:
        raise ValueError(f"expected one patch location, found {count}: {before[:90]!r}")
    return source.replace(before, after, 1)


def patch(source, name):
    prompt = "systemPrompt2" if name == "cli-node" else "systemPrompt"
    if name == "cli-node":
        source = replace_once(source, '''    const persona = layoutSystemBlocks({
      attribution: billingFromSystemPrompt(systemPrompt2) || getAttributionHeader()
    });
    systemPrompt2 = asSystemPrompt(await enhanceSystemPromptWithEnvDetails(persona, options.model));''', '''    const persona = layoutSystemBlocks({
      attribution: billingFromSystemPrompt(systemPrompt2) || getAttributionHeader(),
      leftover: leftoverFromSystemPrompt(systemPrompt2)
    });
    systemPrompt2 = asSystemPrompt(persona);''')
    else:
        source = replace_once(source, '''        turnOrigin: resolveTurnOrigin(options2.querySource)
      })
    });
    systemPrompt = asSystemPrompt(await enhanceSystemPromptWithEnvDetails(persona, options2.model));''', '''        turnOrigin: resolveTurnOrigin(options2.querySource)
      }),
      leftover: leftoverFromSystemPrompt(systemPrompt)
    });
    systemPrompt = asSystemPrompt(persona);''')
    # Preserve caller bytes. Only remove standalone CLI-owned headers, never an
    # entire caller environment/instruction block because it contains a keyword.
    start = source.index(f"function leftoverFromSystemPrompt({prompt}) {{")
    end = source.index("\nvar IDENTITY =", start)
    original = source[start:end]
    replacement = f'''function leftoverFromSystemPrompt({prompt}) {{
  const parts = [];
  for (const block of {prompt}) {{
    const text = (block || "").trim();
    if (!text)
      continue;
    if (/^x-anthropic-billing-header:[^\\r\\n]*$/i.test(text))
      continue;
    if (text === IDENTITY)
      continue;
    if (/^# Environment\\r?\\n[ \\t]*(?:-[ \\t]*)?Time ?zone:[^\\r\\n]+$/i.test(text))
      continue;
    parts.push(block);
  }}
  return parts.length ? parts.join("\\n\\n") : undefined;
}}'''
    source = replace_once(source, original, replacement)
    source = replace_once(source, '  const leftover = opts.leftover?.trim();', '  const leftover = opts.leftover;')
    # Older wrap kernels negotiate the startup layout from environment variables.
    # Use the projected kernel.json for requests without changing their handshake.
    source = replace_once(source, 'function getSystemLayout() {', '''function readKinRequestConfig() {
  try {
    return JSON.parse(__require("fs").readFileSync(process.env.KIN_KERNEL_CONFIG || "/run/kin/kernel.json", "utf8"));
  } catch {
    return {};
  }
}
function getKinRequestLayout() {
  const layout = readKinRequestConfig().system_layout;
  return layout === "zero" || layout === "identity" ? layout : getSystemLayout();
}
function getSystemLayout() {''')
    source = replace_once(source, '  const layout = getSystemLayout();', '  const layout = getKinRequestLayout();')
    source = replace_once(source, '  const kinSystemLayout = getSystemLayout();', '  const kinSystemLayout = getKinRequestLayout();')
    source = replace_once(source, 'function getKinTimezone() {', '''function getKinTimezone() {
  const configured = readKinRequestConfig().timezone;
  if (typeof configured === "string" && configured.trim())
    return configured.trim();''')
    if name == "cc-node":
        # Crag's kernel encodes the top-level system as the first user block.
        # Only unwrap that leading transport block, never scan later user text.
        source = replace_once(source, 'async function runSingleProcessSlots() {', '''function splitCragSystem(content) {
  const first = Array.isArray(content) ? content[0] : undefined;
  const text = first?.type === "text" ? first.text : undefined;
  if (typeof text === "string" && text.startsWith("<system>\\n") && text.endsWith("\\n</system>")) {
    return { system: [text.slice(9, -10)], content: content.slice(1) };
  }
  return { system: undefined, content };
}
async function runSingleProcessSlots() {''')
        source = replace_once(source, '    const content = userContent(frame);',
                              '    const incoming = splitCragSystem(userContent(frame));\n    const content = incoming.content;')
        source = replace_once(source, '    slot.phase = "running";\n    slot.sessionId = sessionId;',
                              '    if (!resume2 || incoming.system !== undefined)\n      slot.system = incoming.system || [];\n    slot.phase = "running";\n    slot.sessionId = sessionId;')
        source = replace_once(source, '      system: prompt ? [prompt] : [],',
                              '      system: slot.system?.length ? slot.system : prompt ? [prompt] : [],')
        # The upstream user-agent patch references an unbound import; use the
        # workload context that is actually bundled, retaining workload tags.
        source = replace_once(source, '  const workload = getWorkload();',
                              '  init_workloadContext();\n  const workload = getWorkload2();')
        if source.count('logForDebugging(') != 4:
            raise ValueError('unexpected API-client debug binding count')
        source = source.replace('logForDebugging(', 'logForDebugging2(')
        if source.count('isDebugToStdErr()') != 4:
            raise ValueError('unexpected API-client stderr binding count')
        source = source.replace('isDebugToStdErr()', 'isDebugToStdErr2()')
        source = replace_once(source, 'var init_client2 = __esm(() => {',
                              'var init_client2 = __esm(() => {\n  init_debug();')
        # Both fast paths skip the regular entrypoint's config initialization.
        source = replace_once(source, '''    await runNativeMessagesLoop2({
      options: {''', '''    init_config();
    enableConfigs();
    await runNativeMessagesLoop2({
      options: {''')
        source = replace_once(source, '''    await runSingleProcessSlots2();''', '''    init_config();
    enableConfigs();
    await runSingleProcessSlots2();''')
    return source


def read_bundle(path):
    data = path.read_bytes()
    if not data.startswith(b"\x7fELF"):
        return data
    if data[:6] != b"\x7fELF\x02\x01":
        raise ValueError("expected an ELF64 little-endian file")
    offset = struct.unpack_from("<Q", data, 40)[0]
    size, count, names_index = struct.unpack_from("<HHH", data, 58)
    if not offset or size != 64 or not count or names_index >= count or offset + size * count > len(data):
        raise ValueError("unpack the input with UPX first; ELF section table is unavailable")
    headers = [struct.unpack_from("<IIQQQQIIQQ", data, offset + i * size) for i in range(count)]
    names_header = headers[names_index]
    names = data[names_header[4]:names_header[4] + names_header[5]]
    for header in headers:
        if names[header[0]:].split(b"\0", 1)[0] != b".bun":
            continue
        section = data[header[4]:header[4] + header[5]]
        trailer = b"\n---- Bun! ----\n"
        if not section.endswith(trailer) or struct.unpack_from("<Q", section)[0] != len(section) - 8:
            raise ValueError("unexpected Bun module graph")
        raw = section[8:]
        _, table, length, entry, _, _, _ = struct.unpack_from("<QIIIIII", raw, len(raw) - len(trailer) - 32)
        if length != 52 or entry != 0:
            raise ValueError("expected the pinned single-module Bun bundle")
        record = struct.unpack_from("<12I4B", raw, table)
        return raw[record[2]:record[2] + record[3]]
    raise ValueError("ELF has no .bun section")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("name", choices=BASELINES)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    raw = read_bundle(args.input)
    digest = hashlib.sha256(raw).hexdigest()
    if digest != BASELINES[args.name]:
        parser.error("upstream bundle hash changed; review the patch instead of applying it blindly")
    if args.output.exists():
        parser.error("output already exists; choose a fresh destination")
    result = patch(raw.decode("utf-8"), args.name).encode("utf-8")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("xb") as output:
        output.write(result)
    print(json.dumps({"name": args.name, "baseline_sha256": digest, "patched_source_sha256": hashlib.sha256(result).hexdigest(), "output": str(args.output)}))


if __name__ == "__main__":
    main()
