# CLI 调用方 system 修复

## 当前状态

源码融合上游 `0f7008c6`（v1.3.158），原版二进制来自 `deploy/payload.json` 固定的 `payload-2026.10.12-effort`。仓内 `cli-node` 采用该 payload 的 Claude Code 2.1.293，应用 `caller-system-v3+safeguards-v1` 后用官方 Bun 重建；`cc-node` 保持已验证的 `caller-system-v1`。wrap 内核和 OAuth helper 同步新版 payload，Go worker / egress 从融合后的源码编译。下文记录本地融合验证；生产状态以部署仓库 `docs/RUNBOOK.md` 和服务器发布证据为准。

唯一补丁实现是 `scripts/patch-cli-system.py`，固定输入源码 SHA-256，未知基线拒绝应用。`cli-node` 对应当前 payload；`cli-node-v1.3.144` 及脚本中其它版本名可复现旧基线；`cc-node` 对应原固定基线。逐文件来源和成品哈希见 [PATCH.json](../share/wrap-cli/PATCH.json)。

## 修复契约

- Node 的 cli-hop 路径保留调用方顶层 system，`zero` / `official` / `official_full` 不将其搬成 user reminder。历史 HTTP 行为保持原样。
- CLI 按 billing、可选身份句、网关时区、调用方文本组装 system，保留调用方文本和空白，不注入槽位 cwd、平台、OS 或 Notes。
- fork 只删除独立 billing、身份句和纯时区块，不整块删除以 `# Environment` 开头的调用方内容。
- 请求阶段读取 `KIN_KERNEL_CONFIG` 或 `/run/kin/kernel.json` 的 `system_layout` 与 `timezone`；缺失配置时回退环境变量。启动档位握手保持上游契约。上游面板缓存 TTL 读取 `KERNEL_CONFIG` 或 `/run/guest/kernel.json`，当前 `/run/kin` 挂载下读不到时回落 1h；本次不改变该行为。
- cc-node 保留 native/crag 配置初始化、workload/debug 引用修复；crag 只还原首个传输用 `<system>` 块，不提升普通 user 同名标签，工具续轮保留当前槽位 system，新任务重置。
- 常驻约束采用上游默认关闭语义：缺 map/key 为关闭，显式 true 才开启。

## auto mode 分类请求与 safeguards

Node 识别 auto mode 分类请求后，在内核信封里带 `request_context`（`purpose=auto_mode_classifier`）。CLI 直接采用 `classifierSystemBlocks` 处理调用方 system，不经过普通 system 过滤。保留上游分类的缓存、thinking、max_tokens、temperature、stop_sequences 与模型适配；内核要求 CLI 报告 `classifier_request_context` 能力。

调用方同时传入数组 `safeguards` 与合法 `dangerous-tool-use-YYYY-MM-DD` beta，且 `compatibility.auto_mode_server` 未关闭时，Node 才把 beta 放入内部字段 `kin_safeguards_beta`；CLI 校验后只把 safeguards 和该 beta 发给上游，内部字段不得外发。

当前 `patch_wire_safeguards(..., assembled=True)` 适配 `assembleMessageRequest`：

- 沿 native 调用链传递 `kinSafeguards`，把内部 beta 加入 `NATIVE_OWNED_FIELDS`，阻止原始 `wireBody` 透传。
- 上游 `CALLER_OPTIONAL_FIELDS` 会从原始请求回填 safeguards，因此补丁在组装结束后先删除 `params.safeguards`，只有门禁通过才恢复。直接调用内核同样不能绕过。
- 其它字段沿用上游组装规则；推导 beta 时排除 safeguards 的固定日期推导，清除旧 dangerous-tool-use 项后只加入合法的调用方 beta，去重，不恢复 afk-mode beta。
- 保留逐消息 effort、空 system 控制消息和新版可选字段；不改回复方向。

`assembled=False` 仅用于复现 v1.3.144 的 `nativeExtras` 结构。

## 缓存与本地验证

采用上游消息断点、system/tools 标记与请求字段 beta。8 个缓存 / 计费函数和 2 个分类函数在原版与补丁源码中逐字一致；补丁不改这些函数。管理台预览不代表真实缓存命中或费用。

- CLI 成品 SHA-256 `b921c7c1…`，48,561,620 字节；Linux `--version` 为 `2.1.293 (Claude Code)`。官方 Bun `.text` / `.rodata` 一致，单入口 `/$bunfs/root/cli.js`，graph flags=7。
- 现有 `test/e2e/auto-mode.e2e.test.mjs`：4 项通过、0 失败，未指定旧 CLI 的拒绝用例跳过 1 项。覆盖 zero/identity 分类、错误、取消、并发及逐消息 effort。
- 复用现有 harness 做 9 次普通请求：Node 下合法双字段、缺 beta、缺 safeguards、非法 beta；直接内核下非数组、缺 beta、beta 单独存在、非法 beta、合法双字段。全部符合门禁，不外发内部字段或 afk-mode beta，均保留调用方 Windows 环境段及尾部空白。
- 环境为本地 `node:22-trixie-slim` Docker，CPU 1.5 核、内存 3 GiB、无外网、虚构凭据；实际内核与 CLI 只访问容器内 HTTP 模拟上游。未访问生产。
- 35 个相关后端测试文件共 667 项通过；前端 7 个相关测试文件共 72 项通过，类型检查和构建通过；102 个变更 `.mjs` 语法检查通过，Python 补丁语法通过；Go egress / telemetry / config 检查及 worker / egress 编译通过。

当前证据见 [CLI_UPSTREAM_MERGE_EVIDENCE.json](CLI_UPSTREAM_MERGE_EVIDENCE.json)。[CLI_SYSTEM_PATCH_EVIDENCE.json](CLI_SYSTEM_PATCH_EVIDENCE.json) 是旧版证据，不代表本次重新验证。未验证真实 Anthropic、生产请求、Windows 客户端 auto mode、真实缓存命中、TTL 热切换、长期运行和管理台浏览器渲染。

## 维护与复现

先执行 `node scripts/fetch-payload.mjs --dest <临时目录>` 下载并校验原版，不能直接下载到 fork 根目录覆盖定制 CLI。当前 CLI 原版 SHA-256 为 `c1316b7d…`；cc-node 原版仍来自 `336729010c6040236bdcd507923737eb4abb1178:share/wrap-cli/cc-node`。

固定使用官方 **Bun 1.3.14+0d9b296af linux-x64-baseline**，压缩包 SHA-256 `a063908ae08b7852ca10939bbdc6ceed3ddabce8fb9402dce83d65d73b36e6c7`；UPX 5.2.1。不使用嵌入 CLI 的 `BUN_BE_BUN` 替代官方编译器。

```bash
upx -d -o cli-node.unpacked cli-node.original
python /repo/scripts/patch-cli-system.py cli-node cli-node.unpacked cli-node.patched.mjs
/path/to/official/bun build cli-node.patched.mjs --compile \
  --target=bun-linux-x64-baseline \
  --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
  --compile-autoload-package-json --outfile=build/cli.js
upx -1 -o cli-node.fixed build/cli.js
```

保留输出名 `cli.js`。重建后核对源码、graph flags、官方运行时与请求形状。现有联调支持 `KIN_AUTOMODE_CLI` / `KIN_AUTOMODE_KERNEL` 指向验证产物。

发布通过 fork 镜像统一安装控制面、内核、CLI 和 worker，再同步槽位；不能只替换某个运行槽位。管理端下载上游 Release 会覆盖 fork CLI，使用后必须核对 PATCH.json。生产上线仍按 RUNBOOK 做一次备份、构建隔离、出口恢复和请求级路由验证。
