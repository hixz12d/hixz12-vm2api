# CLI 调用方 system 修复

## 当前状态

源码融合上游 `76f6a1e`（v1.3.85 + main 后续修复）。仓内 `cli-node` 基于新版上游重新提取、应用 `caller-system-v2` 并用官方 Bun 重建；`cc-node` 保持已验证的 `caller-system-v1` 二进制。两个 Rust 内核未变。生产部署状态以部署仓库 `docs/RUNBOOK.md` 和服务器发布证据为准；下文记录的是本地融合验证。

唯一补丁实现是 `scripts/patch-cli-system.py`，固定输入源码 SHA-256；未知上游版本拒绝应用。`cli-node` 对应当前上游，`cc-node` 对应原固定基线，`legacy-cli-node` 可复现旧版补丁。逐文件基线和成品哈希见 [PATCH.json](../share/wrap-cli/PATCH.json)。

## 修复契约

- Node 的 cli-hop 路径保留调用方顶层 system，`zero` / `official` / `official_full` 不将其搬成 user reminder。历史 HTTP 行为保持原样。
- CLI 按 billing、可选身份句、网关时区、调用方文本组装 system，保留调用方文本和空白，不注入槽位 cwd、平台、OS 或 Notes。
- 上游新版已修复 caller system 丢失，但仍整块删除以 `# Environment` 开头的调用方内容。fork 只删除独立 billing、身份句和纯时区块；客户端环境、agent、Notes 原文继续保留。
- 请求阶段读取 `KIN_KERNEL_CONFIG` 或 `/run/kin/kernel.json` 的 `system_layout` 与 `timezone`；缺失配置时才回退环境变量。启动时档位握手沿用旧内核契约。
- cc-node 保留 native/crag 配置初始化、workload/debug 引用修复；crag 仅还原首个传输用 `<system>` 块，普通 user 中的同名标签不提升为 system，工具续轮保留当前槽位 system，新任务重置。
- 常驻约束采用上游默认关闭语义：缺 map/key 为关闭，显式 true 才开启。关闭后不得残留前一请求约束。

## 缓存与预览

采用上游 v1.3.83 的 Node 消息断点：清洗 caller cache_control 后重建最后消息和符合条件的倒数第二 user 断点，使用会话 pin 的 TTL；native CLI 保留消息标记并处理 system/tools 断点。新 cli-node 的 `applyKinOwnedCacheMarkers`、`capCacheMarkers` 等缓存和计费函数未被 fork 补丁修改，与当前上游源码逐字一致。

cc-node 二进制未更新；已用合并后的 Node 请求准备路径复核其 5m / 1h 双消息断点、总断点数不超过 4。这里验证的是隔离模拟请求的出站形状，不代表真实缓存命中、费用或长期稳定性。

管理台最终 system 预览继续采用 fork 的 CLI 分段逻辑；调用方内容用占位符表示。请求头覆盖、真实正文与最终 wire 应以请求抓取为准，不能把预览当作缓存证据。system 或断点变化可能导致首次冷缓存。

## 本次验证

验证环境为本地 Linux Docker，无外网，根文件系统只读，CPU 硬上限实读 `150000 100000`（1.5 核），使用虚构 API Key 与容器内 HTTP 模拟上游。

- 新 cli-node 与原 cc-node 各 8 组请求，共 16 组：zero / identity × 5m / 1h × Sonnet 5.5 / Haiku。
- 使用合并后的真实 `prepareCliHopBody`，经 CLI native 协议发请求；检查调用方 Windows 环境及首尾空白、配置热读、无槽位环境注入、缓存标记、完整 SSE 至 `message_stop`。
- 新产物与官方 Bun 的 `.text` / `.rodata` 一致；单入口 `/$bunfs/root/cli.js`、graph flags=7 已核对。
- 后端相关既有检查 366 项通过；前端相关既有检查 30 项通过。前端产物从融合后的源码生成。

本次证据见 [CLI_UPSTREAM_MERGE_EVIDENCE.json](CLI_UPSTREAM_MERGE_EVIDENCE.json)。旧版实际 Rust 内核联调证据保留在 [CLI_SYSTEM_PATCH_EVIDENCE.json](CLI_SYSTEM_PATCH_EVIDENCE.json)，不能当作本次新二进制的验证结果。

未验证：新二进制经实际 Rust 内核的完整调用、生产 `/v1/messages`、真实 Windows Claude Code、真实缓存命中率和长时间观察。

## 维护与复现

当前 cli-node 原始文件从 `76f6a1e91fa3d776356fdb0d268c46bb0f00edfd:share/wrap-cli/cli-node` 导出；cc-node 原始文件从 `336729010c6040236bdcd507923737eb4abb1178:share/wrap-cli/cc-node` 导出。使用二进制安全导出，不通过旧 PowerShell 文本重定向。

提取工具 `../scripts/research/extract-cli-bundle.py` 支持同一 Bun 格式的带/不带 shebang 两种入口；正式旧研究产物 `../artifacts/cli-node-rebuild/` 保持原样。

固定使用 **官方 Bun 1.3.14+0d9b296af linux-x64-baseline**，压缩包 SHA-256：`a063908ae08b7852ca10939bbdc6ceed3ddabce8fb9402dce83d65d73b36e6c7`。不要用嵌入式 CLI 的 `BUN_BE_BUN` 编译替代官方构建器；本次该方式生成的 ELF 启动崩溃，已弃用。

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

cc-node 仍使用脚本的 `cc-node` 模式及其固定基线；旧 cli-node 使用 `legacy-cli-node`。保留输出名 `cli.js`，重命名成品不影响内嵌入口。重新构建可能改变 ELF 整体哈希，必须同时核对源码、graph flags 和请求形状。

发布时通过 fork 镜像安装已验证二进制，不能只改某个运行槽位。管理端下载上游 Release 会覆盖 fork CLI；使用后需重新核对 PATCH.json。生产上线仍按部署 RUNBOOK 执行备份、空闲确认、构建隔离、出口恢复及请求级验证。
