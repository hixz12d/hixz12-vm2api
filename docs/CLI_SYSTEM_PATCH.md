# CLI 调用方 system 修复

## 当前状态

仓内 `share/wrap-cli/cli-node` 和 `cc-node` 已应用 `caller-system-v1` 补丁。对应 Node 转交及控制台预览源码已更新。**尚未部署生产，前端 `web/dist` 尚未重新构建**；上线时需从包含本补丁与现有工作区改动的源码统一生成前端和镜像，再按运行手册切换。

本补丁适用于 `wrap`（cli-node + wrap kernel）、`cc`（cc-node + wrap kernel）、`crag`（cc-node + crag kernel）。没有修改两个 Rust 内核。

## 修复后的契约

- CLI 槽位请求把调用方 system 放在身份段、网关时区段之后，保留文本内容和空白，不再调用 `enhanceSystemPromptWithEnvDetails` 写入槽位 cwd、平台、OS 或 Notes。
- Node 的 cli-hop 模板路径始终把 caller system 留在顶层；`official` / `official_full` 不再将它搬成首条 user 后的 reminder。历史 HTTP 路径仍沿用原有行为。
- Node 和 CLI 只剥离独立的协议归因头、身份句与网关的纯时区块。包含客户端 cwd/platform 的 `# Environment` 整块必须保留，不能按标题整块删除。
- Native 请求读取已投影的 `kernel.json.system_layout` 与 `timezone`；默认路径 `/run/kin/kernel.json`，隔离运维可用 `KIN_KERNEL_CONFIG` 指定路径。缺失配置时才回退既有环境变量。旧 wrap 内核的启动握手保持原契约，不要求替换 Rust 内核。
- cc-node 的 native 和 crag 快捷入口补齐正常的配置初始化；修复其 API 客户端对 workload/debug 函数的失效引用，使用包内已有实现。
- crag 内核把 system 编成首个 user 文本块 `<system>\n…\n</system>`。Node 先统一块分隔符并在空 system 时提供网关占位块，cc-node 只还原这个首块；后续普通 user 内容里的同名标签不提升为 system。工具续轮复用当前槽位的 system，新任务重置。
- 常驻约束的开关仍由 Node 模板控制；关闭后不得因槽位复用而保留上一请求的约束。

客户端自己提供的环境信息不属于“槽位注入”，不会被本补丁清洗。已有会话历史中包含错误目录时，仍需由客户端纠正历史上下文。

## 缓存与预览

以下原始函数在两个 CLI 的补丁前后逐字一致：`splitSysPromptPrefix`、`getCacheControl`、`buildSystemPromptBlocks`、`fillMissingCacheTtl`、`finalizeZeroBilling`、`withCchPlaceholder`。补丁不改变这些函数的 billing、cache scope、TTL 及分段算法。

Node 仍按原有 cli-hop 契约移除入站 cache_control，由 CLI 生成最终断点。模板编辑器里写着 `1h global`，不代表 native CLI 已经把这个标记原样发给上游；本次捕获的普通 zero/identity 请求使用 CLI 生成的 1h 断点，没有 global 标记。不能把模板预览当作真实缓存证据。

控制台「最终 system prompt」现在显示 native CLI 实际合并后的分段：省略 billing，identity 档显示身份段，再显示时区与调用方文本；调用方内容用占位符表示，默认 TTL 来自当前设置。HTTP 遗留模板工具与自定义原始模板编辑数据不变。预览只表示配置层面的请求形状；请求头 TTL 覆盖、显式上游特性和真实调用方正文应以对应请求抓取为准。

**本补丁改变 system 正文，因此切换后的首次请求可能产生冷缓存。重复请求的非 billing system 已验证稳定，但真实 `cache_read_input_tokens` 和长期命中率尚未验证。**

## 已完成验证

验证环境：本地 Linux Docker，外网关闭，CPU 硬上限 1.5 核，根文件系统只读；使用临时模拟 OAuth 凭证与容器内 HTTP 模拟上游。没有访问生产。

| 验证 | 结果 |
|---|---|
| 三种数据面 × zero / official × Sonnet / Haiku | 共 168 次请求检查通过 |
| `<cwd>D:/SYS_MARKER_7Q3Z</cwd> SYSTOKEN_K9P2` | 顶层 system 包含两个标记，前后空白保留 |
| 客户端 `# Environment`、Windows cwd 与 platform | 保留；无新增槽位 Linux 环境和固定 Notes |
| 官方 Claude Code 请求形状 | 保留调用方环境，未追加第二套槽位环境 |
| 常驻约束开启再关闭 | 当前请求跟随开关，无上次请求残留 |
| user 中形似 `<system>` 的普通文本 | 保持在 user，未被提升 |
| 相同请求重复发送 | 非 billing system 内容与断点稳定 |
| 预览函数 | 正文与 TTL 对应实际出站一致，共 24 次对照 |
| UPX 打包后的最终二进制 | 三种组合共 24 次冒烟通过 |
| 原有后端相关检查 | 136 项通过 |
| 原有前端模板/草稿检查 | 14 项通过；类型检查通过 |
| 可复现补丁 | 从原始 cc-node ELF 提取并重打补丁，源码结果逐字一致 |

详细结果见 [CLI_SYSTEM_PATCH_EVIDENCE.json](CLI_SYSTEM_PATCH_EVIDENCE.json)。模拟 usage 只用于协议返回，不作为真实缓存或计费证据。

尚未完成：生产 `/v1/messages` 实测、真实 Windows `claude -p` 端到端调用、真实 Haiku/Sonnet 推理、真实缓存命中率对比、长时间运行观察、浏览器页面交互验收。当前已验证的是 Node 请求准备函数 → 实际 Rust 内核 → 实际 CLI → 本地模拟上游。

## 维护与复现

唯一补丁实现：`scripts/patch-cli-system.py`。输入必须是固定上游的完整 UTF-8 bundle 或 UPX 解压后的 ELF；脚本校验提取源码 SHA-256 和替换次数，遇到新的上游版本主动停止。不会对未知版本盲打补丁。

原始二进制来自 Git 提交 `336729010c6040236bdcd507923737eb4abb1178` 的 `share/wrap-cli/`。基线与最终文件哈希都在 [share/wrap-cli/PATCH.json](../share/wrap-cli/PATCH.json)。恢复原始二进制到临时目录时，使用二进制安全的文件导出方式，避免旧 PowerShell 把重定向结果按文本重编码。

在 Linux 临时工作目录内，使用 Bun `1.3.14+0d9b296af`（linux-x64-baseline）和 UPX 5.2.1。Bun 官方压缩包 SHA-256 为 `a063908ae08b7852ca10939bbdc6ceed3ddabce8fb9402dce83d65d73b36e6c7`。

```bash
# 以下在仓库根目录执行；原版文件预先导出到 .tmp/cli-system/。
upx -d -o .tmp/cli-system/cli-node.unpacked .tmp/cli-system/cli-node.original
upx -d -o .tmp/cli-system/cc-node.unpacked .tmp/cli-system/cc-node.original

python scripts/patch-cli-system.py cli-node \
  .tmp/cli-system/cli-node.unpacked .tmp/cli-system/cli-node.patched.mjs
python scripts/patch-cli-system.py cc-node \
  .tmp/cli-system/cc-node.unpacked .tmp/cli-system/cc-node.patched.mjs

# 两个输入分别执行。保留输出名 cli.js，随后再重命名。
bun build .tmp/cli-system/cli-node.patched.mjs --compile \
  --target=bun-linux-x64-baseline \
  --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
  --compile-autoload-package-json --outfile=.tmp/cli-system/wrap/cli.js
bun build .tmp/cli-system/cc-node.patched.mjs --compile \
  --target=bun-linux-x64-baseline \
  --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
  --compile-autoload-package-json --outfile=.tmp/cli-system/cc/cli.js

upx -1 -o .tmp/cli-system/cli-node.fixed .tmp/cli-system/wrap/cli.js
upx -1 -o .tmp/cli-system/cc-node.fixed .tmp/cli-system/cc/cli.js
```

构建必须核对内嵌路径 `/$bunfs/root/cli.js` 与 graph flags=7（关闭 dotenv/bunfig/tsconfig 自动加载，开启 package.json 自动加载）。实际 Bun 命令、源码哈希、成品哈希用于审计；重新构建的文件可能因输入路径等打包信息而改变整体哈希，不能因此省略源码与出站验证。

发布时把已验证的二进制纳入自己的镜像。入口脚本会将镜像内版本安装到持久目录，不能只手工改某个运行槽位。管理端从上游 Release 下载 CLI 可能覆盖本补丁，使用该入口后必须重新核对 PATCH.json 和二进制哈希。
