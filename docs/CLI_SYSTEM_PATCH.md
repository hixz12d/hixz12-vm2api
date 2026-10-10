# CLI 调用方 system 修复

## 当前状态

源码融合上游 `e1a91e46`（v1.3.135）。仓内 `cli-node` 基于上游 `cc438892`（Claude Code 2.1.293）提取，应用 `caller-system-v3+safeguards-v1` 并用官方 Bun 重建；`cc-node` 保持已验证的 `caller-system-v1` 二进制。`bin/kin-kernel` 与槽位 `kin-kernel.bin` 已采用上游相同内容，新 Node、内核和 CLI 应一起上线。下文仅记录本地验证，生产状态以部署仓库 `docs/RUNBOOK.md` 为准。

唯一补丁实现是 `scripts/patch-cli-system.py`，固定输入源码 SHA-256；未知上游版本拒绝应用。`cli-node` 对应当前上游；`cli-node-v1.3.123`、`cli-node-v1.3.103`、`cli-node-v1.3.94`、`cli-node-v1.3.91`、`cli-node-v1.3.88`、`cli-node-v1.3.85` 可复现旧版；`cc-node` 对应原固定基线，`legacy-cli-node` 对应早期补丁。逐文件基线和成品哈希见 [PATCH.json](../share/wrap-cli/PATCH.json)。

## 修复契约

- Node 的 cli-hop 路径保留调用方顶层 system，`zero` / `official` / `official_full` 不将其搬成 user reminder。历史 HTTP 行为保持原样。
- CLI 按 billing、可选身份句、网关时区、调用方文本组装 system，保留调用方文本和空白，不注入槽位 cwd、平台、OS 或 Notes。
- fork 只删除独立 billing、身份句和纯时区块，不整块删除以 `# Environment` 开头的调用方内容。
- 请求阶段读取 `KIN_KERNEL_CONFIG` 或 `/run/kin/kernel.json` 的 `system_layout` 与 `timezone`；缺失配置时回退环境变量。启动档位握手保持上游契约。上游面板缓存 TTL 读取 `KERNEL_CONFIG` 或 `/run/guest/kernel.json`，当前 `/run/kin` 挂载下读不到时回落 1h；生产全局 TTL 本就是 1h，本次未改变此行为。
- cc-node 保留 native/crag 配置初始化、workload/debug 引用修复；crag 只还原首个传输用 `<system>` 块，不提升普通 user 同名标签，工具续轮保留当前槽位 system，新任务重置。
- 常驻约束采用上游默认关闭语义：缺 map/key 为关闭，显式 true 才开启。

## auto mode 分类请求

Node 识别 Claude Code auto mode 分类请求后，在内核信封里带 `request_context`（`purpose=auto_mode_classifier`）。CLI 直接采用 `classifierSystemBlocks` 处理调用方 system，不经过 `layoutSystemBlocks` / `leftoverFromSystemPrompt`，所以 fork 普通 system 过滤不影响分类原文。

保留上游分类的 cache_control、thinking、max_tokens、temperature、stop_sequences 与模型适配规则，不加普通请求的 effort、context_management 和缓存断点。`prepareCliHopBody` 分类分支之后仍执行 fork safeguards 门禁。内核要求 CLI 报告 `classifier_request_context` 能力。

## auto mode 服务端检查（safeguards）

调用方需同时传入数组 `safeguards` 与合法 `dangerous-tool-use-YYYY-MM-DD` beta，且 `compatibility.auto_mode_server` 未关闭。Node 将 beta 放入内部字段 `kin_safeguards_beta`，CLI 将 safeguards 与该 beta 一起发给上游；任一条件不满足则两者均不发。内部字段不得发给 Anthropic。

当前 CLI 使用上游 `wireBody` / `nativeExtras` 传递请求字段，并由 `withRequestProtocolBetas` 推导协议 beta。补丁的 `patch_wire_safeguards`：

- 由 `kinSafeguardsFromRequest` 校验数组与日期格式，沿 native 调用链传 `kinSafeguards`。
- 把 `kin_safeguards_beta` 加入 `NATIVE_OWNED_FIELDS`，避免 `nativeExtras` 原样外发内部字段。
- 移除未经门禁的 safeguards 转发；仅在校验通过时写出 safeguards。
- 推导其他协议 beta 时排除 safeguards 的固定日期自动推导，清除旧 dangerous-tool-use 项后只加入通过门禁的调用方 beta，去重；不恢复旧版 afk-mode beta。
- 不改回复方向，内核与 CLI 继续转出 `message_delta`。

v1.3.123 的旧 `patch_upstream_safeguards` 仅供复现旧基线；它不能应用到当前 wireBody 结构。

## 缓存与预览

采用上游 Node 消息断点与新版请求字段 beta；native CLI 保留消息标记并管理 system/tools 断点，分类请求除外。8 个缓存和计费函数及两个分类函数在当前上游源码与补丁源码之间逐字一致。cc-node 未更新。

管理台 system 预览沿用 fork 分段逻辑。预览和模拟请求不代表真实缓存命中或费用；system 或断点变化可能产生首次冷缓存。

## 本地验证

- 成品 SHA-256 `8d0b8ef1…`，48,549,616 字节；Linux `--version` 为 `2.1.293 (Claude Code)`。官方 Bun `.text` / `.rodata` 一致，单入口 `/$bunfs/root/cli.js`，graph flags=7。
- `cli-node-v1.3.123` 模式复现上一版补丁源码 SHA-256 `83ecc3a8…`。
- 现有 auto mode 联调：合并后 fork Node → 实际上游内核 → 新 CLI → 容器内 HTTP 模拟上游，3 项通过，旧 CLI 拒绝用例因未指定旧 CLI 跳过 1 项。覆盖 zero/identity、分类正文、错误、取消和并发。首次冷启动超过原用例 5 秒等待上限，将测试等待改为 20 秒后通过；生产超时未变。
- 复用现有模拟服务验证 8 种 safeguards 输入：两项齐全、缺 beta、缺 safeguards、非法 beta，以及绕过 Node 直接向内核提交非数组 / 缺 beta / beta 单独存在 / 非法 beta。均符合门禁；上游没有内部字段与 afk-mode beta。
- 环境：本地 `node:22-trixie-slim` Docker，CPU 1.5 核、内存 3 GiB、无外网、源码只读挂载、虚构凭据。二进制复制到容器临时目录执行，未访问生产。

证据摘要见 [CLI_UPSTREAM_MERGE_EVIDENCE.json](CLI_UPSTREAM_MERGE_EVIDENCE.json)。早期完整系统/缓存联调见 [CLI_SYSTEM_PATCH_EVIDENCE.json](CLI_SYSTEM_PATCH_EVIDENCE.json)，不可当作当前版本重新验证的结果。

未验证：真实 Anthropic、生产请求、Windows Claude Code auto mode、真实缓存命中和长期运行；本次 safeguards 抓取复用分类路径，普通请求 system/TTL 热切换未重跑。上线后仍需按 RUNBOOK 验证请求级路由。

## 维护与复现

当前原始 CLI 从 `cc438892e8c4f20837c56c8d13ec58619b97fc1d:share/wrap-cli/cli-node` 导出（SHA-256 `643f5523…`）；cc-node 从 `336729010c6040236bdcd507923737eb4abb1178:share/wrap-cli/cc-node` 导出。用 Git Bash 或 Linux 的 `git show <commit>:<path> > file` 二进制安全导出，不通过 PowerShell 文本重定向。

提取工具为部署仓库 `scripts/research/extract-cli-bundle.py`。固定使用官方 **Bun 1.3.14+0d9b296af linux-x64-baseline**，压缩包 SHA-256 `a063908ae08b7852ca10939bbdc6ceed3ddabce8fb9402dce83d65d73b36e6c7`；UPX 5.2.1（`upx-5.2.1-amd64_linux.tar.xz`）。不要用嵌入 CLI 的 `BUN_BE_BUN` 替代官方编译器。

```bash
upx -d -o cli-node.unpacked cli-node.original
python /repo/scripts/patch-cli-system.py cli-node cli-node.unpacked cli-node.patched.mjs
/path/to/official/bun build cli-node.patched.mjs --compile \
  --target=bun-linux-x64-baseline \
  --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
  --compile-autoload-package-json --outfile=build/cli.js
upx -1 -o cli-node.fixed build/cli.js
```

保留输出名 `cli.js`。重建可能改变整体 ELF 哈希，需核对源码、graph flags、官方运行时与请求形状；现有 `test/e2e/auto-mode.e2e.test.mjs` 支持 `KIN_AUTOMODE_CLI` / `KIN_AUTOMODE_KERNEL` 指向验证产物。

发布通过 fork 镜像安装二进制，不能只改某个运行槽位。管理端下载上游 Release 会覆盖 fork CLI，使用后必须重新核对 PATCH.json。生产上线仍按部署 RUNBOOK 做一次备份、构建隔离、出口恢复和请求级验证。
