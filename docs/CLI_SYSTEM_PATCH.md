# CLI 调用方 system 修复

## 当前状态

源码融合上游 `06f090b`（v1.3.95）。仓内 `cli-node` 基于上游 v1.3.94 新 cli-node（`1b735bf7`，v1.3.95 未再改）重新提取，应用 `caller-system-v3+safeguards-v1` 并用官方 Bun 重建；`cc-node` 保持已验证的 `caller-system-v1` 二进制。`kin-kernel` 采用上游 v1.3.95 原版。生产部署状态以部署仓库 `docs/RUNBOOK.md` 和服务器发布证据为准；下文记录的是本地验证。

唯一补丁实现是 `scripts/patch-cli-system.py`，固定输入源码 SHA-256；未知上游版本拒绝应用。`cli-node` 对应当前上游，`cli-node-v1.3.91`、`cli-node-v1.3.88`、`cli-node-v1.3.85` 可复现前三版，`cc-node` 对应原固定基线，`legacy-cli-node` 可复现旧版补丁。逐文件基线和成品哈希见 [PATCH.json](../share/wrap-cli/PATCH.json)。

## 修复契约

- Node 的 cli-hop 路径保留调用方顶层 system，`zero` / `official` / `official_full` 不将其搬成 user reminder。历史 HTTP 行为保持原样。
- CLI 按 billing、可选身份句、网关时区、调用方文本组装 system，保留调用方文本和空白，不注入槽位 cwd、平台、OS 或 Notes。
- 上游新版已修复 caller system 丢失，但仍整块删除以 `# Environment` 开头的调用方内容。fork 只删除独立 billing、身份句和纯时区块；客户端环境、agent、Notes 原文继续保留。
- 请求阶段读取 `KIN_KERNEL_CONFIG` 或 `/run/kin/kernel.json` 的 `system_layout` 与 `timezone`；缺失配置时才回退环境变量。启动时档位握手沿用旧内核契约。
- cc-node 保留 native/crag 配置初始化、workload/debug 引用修复；crag 仅还原首个传输用 `<system>` 块，普通 user 中的同名标签不提升为 system，工具续轮保留当前槽位 system，新任务重置。
- 常驻约束采用上游默认关闭语义：缺 map/key 为关闭，显式 true 才开启。关闭后不得残留前一请求约束。

## auto mode 分类请求

上游 v1.3.94 起，Node 识别出 Claude Code auto mode 分类请求后，在内核信封里带 `request_context`（`purpose=auto_mode_classifier`），cli-node 按上游分类契约处理：system 直接取请求原文（`classifierSystemBlocks`，只去掉调用方 billing 再前置 CLI billing），不经过 `layoutSystemBlocks` / `leftoverFromSystemPrompt`；保留 cache_control、thinking、max_tokens、temperature、stop_sequences，不加 effort、context_management 和 Kin 缓存断点。

- fork 的 system 过滤只在 `leftoverFromSystemPrompt` 里，分类请求走不到这里，所以补丁保持原样，不需要为分类请求另加跳过逻辑；分类请求的 system 与上游逐字一致。
- safeguards 规则对分类请求同样生效：Node 的分类分支先 `prepareClassifierBody` 再过 fork 的 safeguards 门禁，cli-node 的 `kinSafeguardsFromRequest` 在分类与普通请求上判断相同。
- 新内核只在 CLI 健康信息报告 `classifier_request_context` 时才派发分类请求；旧 fork cli-node 会被拒绝（`classifier_runtime_unsupported`），所以新内核、新 cli-node、新 Node 必须一起上线。

## auto mode 服务端检查（safeguards）

Claude Code auto mode 在请求体带 `safeguards`、在 `anthropic-beta` 带 `dangerous-tool-use-YYYY-MM-DD`，服务端在 `message_delta.delta.safeguard_results` 返回结论。内核不转发信封请求头，所以 Node 把该 beta 放进 hop body 的内部字段 `kin_safeguards_beta`。

- cli-node 只有在 `safeguards` 是数组、且 `kin_safeguards_beta` 匹配 `^dangerous-tool-use-\d{4}-\d{2}-\d{2}$` 时，才把 `safeguards` 原样放进出站请求体，并把该 beta 并入出站 `anthropic-beta`（去重）。任一条件不满足则两者都不发。`kin_safeguards_beta` 从不发给 Anthropic。
- 回复方向不需要补丁：内核与 CLI 原样转出 `message_delta`，`safeguard_results` 保留。
- 补丁只新增 `kinSafeguardsFromRequest` 并在 `runJob` → 出站参数之间传一个 `kinSafeguards` 选项，不改缓存和计费函数。v1.3.94 的补丁锚点与 v1.3.91 相同，改动内容逐行相同。
- 内核会把 job JSON 按键名重新排序后交给 CLI，`safeguards` 的值不变、键顺序会变。

## 缓存与预览

采用上游 v1.3.83 的 Node 消息断点：清洗 caller cache_control 后重建最后消息和符合条件的倒数第二 user 断点，使用会话 pin 的 TTL；native CLI 保留消息标记并处理 system/tools 断点（分类请求除外，见上节）。新 cli-node 的 `applyKinOwnedCacheMarkers`、`capCacheMarkers` 等缓存和计费函数未被 fork 补丁修改，与当前上游源码逐字一致。

cc-node 二进制未更新，其 5m / 1h 双消息断点、总断点数不超过 4 的验证沿用上一次融合结果（git 历史中的证据文件）。这里验证的是隔离模拟请求的出站形状，不代表真实缓存命中、费用或长期稳定性。

管理台最终 system 预览继续采用 fork 的 CLI 分段逻辑；调用方内容用占位符表示。请求头覆盖、真实正文与最终 wire 应以请求抓取为准，不能把预览当作缓存证据。system 或断点变化可能导致首次冷缓存。

## 本次验证

验证环境为本地 Linux Docker，无外网，根文件系统只读，CPU 限制 1.5 核，使用虚构凭据与容器内 HTTP 模拟上游。

- 经上游 v1.3.95 实际 Rust 内核（`kin-kernel --gateway-worker`，随附 glibc239，local_cli / 2 槽位）调用新 cli-node；请求体由合并后的真实 `prepareCliHopBody` 生成，经 `go-worker-client` 信封送入内核。
- 返回给调用方的 SSE 保留 `safeguard_results`，到 `message_stop` 结束。
- 错误透传：上游 400、529（带 `retry-after`）、只有 `message_start` 的空流分别返回 `upstream_invalid_request`、`upstream_overloaded`（`retry_after` 7）、`upstream_empty_stream`，带原始 status 和 message；之后的正常请求不受影响，内核 `closed_slots` 0、`cli_restarts` 0。
- safeguards：两者都有时上游收到相同的 `safeguards` 和一次该 beta；Node 开关关闭、缺 beta、缺 safeguards，以及直接构造的只有一个字段、beta 不带日期、safeguards 非数组，上游都没有这两项；任何情况下上游都看不到 `kin_safeguards_beta`。
- auto mode 分类请求：system 中混入身份句和纯时区块时也原样外发（fork 过滤未作用），cache_control、`thinking: disabled`、temperature 0、max_tokens、`stop_sequences` 与输入一致，无 effort / context_management；带 safeguards 时按 fork 规则放行或删除；tool 格式和 adaptive 模型的 2048 余量按上游契约。上游 `test/e2e/auto-mode.e2e.test.mjs` 与两个 `auto-mode*` 单测在合并后源码上用新 cli-node 全部通过（20/20），其中新内核会拒绝把分类请求派给上一版 fork cli-node。
- 回归：调用方 Windows 环境及首尾空白原样保留、无槽位环境注入、5m / 1h 缓存标记、`kernel.json` 热读（档位与时区，不重启）；#191：上游 `stop_reason=max_tokens` 正常结束，无错误事件。
- 新产物与官方 Bun 的 `.text` / `.rodata` 一致；单入口 `/$bunfs/root/cli.js`、graph flags=7 已核对；上述缓存和计费函数及上游两个分类函数在补丁前后与上游 v1.3.94 源码逐字一致；`cli-node-v1.3.91` 模式复现出上一版相同的补丁源码哈希。

本次证据见 [CLI_UPSTREAM_MERGE_EVIDENCE.json](CLI_UPSTREAM_MERGE_EVIDENCE.json)。旧版实际 Rust 内核联调证据保留在 [CLI_SYSTEM_PATCH_EVIDENCE.json](CLI_SYSTEM_PATCH_EVIDENCE.json)。

未验证：生产 `/v1/messages`、真实 Anthropic 对该 beta、`safeguards` 及分类请求的响应、真实 Windows Claude Code auto mode、真实缓存命中率和长时间观察。

## 维护与复现

当前 cli-node 原始文件从 `1b735bf7ea65d562cfaeb4c4deaf3ff520e908ed:share/wrap-cli/cli-node` 导出（SHA-256 `c711a966…`）；cc-node 原始文件从 `336729010c6040236bdcd507923737eb4abb1178:share/wrap-cli/cc-node` 导出。用 Git Bash 或 Linux 的 `git show <commit>:<path> > file` 二进制安全导出，不通过 PowerShell 文本重定向。

提取工具在部署仓库 `scripts/research/extract-cli-bundle.py` 支持同一 Bun 格式的带/不带 shebang 两种入口；正式旧研究产物 `../artifacts/cli-node-rebuild/` 保持原样。

固定使用 **官方 Bun 1.3.14+0d9b296af linux-x64-baseline**，压缩包 SHA-256：`a063908ae08b7852ca10939bbdc6ceed3ddabce8fb9402dce83d65d73b36e6c7`；UPX 5.2.1（`upx-5.2.1-amd64_linux.tar.xz`）。不要用嵌入式 CLI 的 `BUN_BE_BUN` 编译替代官方构建器；该方式生成的 ELF 启动崩溃，已弃用。

在 Linux 临时目录执行（Bun、UPX 使用已核对工具路径）：

```bash
upx -d -o cli-node.unpacked cli-node.original
python /repo/scripts/patch-cli-system.py cli-node cli-node.unpacked cli-node.patched.mjs
/path/to/official/bun build cli-node.patched.mjs --compile \
  --target=bun-linux-x64-baseline \
  --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
  --compile-autoload-package-json --outfile=build/cli.js
upx -1 -o cli-node.fixed build/cli.js
```

cc-node 仍使用脚本的 `cc-node` 模式及其固定基线；旧 cli-node 使用 `legacy-cli-node`。保留输出名 `cli.js`，重命名成品不影响内嵌入口。重新构建可能改变 ELF 整体哈希，必须同时核对源码、graph flags 和请求形状；分类请求可用上游 `test/e2e/auto-mode.e2e.test.mjs`（`KIN_AUTOMODE_CLI` 指向新成品）在 Linux 下核对。

发布时通过 fork 镜像安装已验证二进制，不能只改某个运行槽位。管理端下载上游 Release 会覆盖 fork CLI；使用后需重新核对 PATCH.json。生产上线仍按部署 RUNBOOK 执行备份、空闲确认、构建隔离、出口恢复及请求级验证。
