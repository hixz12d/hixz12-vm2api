# Fork 运行兼容性

## 当前策略：优先采用上游 v1.3.123

融合上游 `4a3e6136`（v1.3.123，含 v1.3.107–v1.3.122）。保留 fork 历史与定制管理台，源码、预编译前端及 CLI 补丁同步维护。生产部署状态以部署仓库 `docs/RUNBOOK.md` 和服务器发布证据为准。

- 采用 v1.3.107–v1.3.123：Claude Code 2.1.293 身份与 Haiku 5.5；内核线协议和环境变量去掉 `kin_` / `KIN_` 前缀（`kin-kernel`、`kin-kernel.bin`、`kin-codex-kernel`、`cli-node` 必须一起上线并 `wrap-cli/sync`）；协议入口前置闸门（蒸馏硬规则、可编辑硬正则、拒答缓存、可选决策模型，决策模型默认关闭）；拒答缓存近似匹配；Usage Policy 拒答永久缓存并返回 503 `refusal_guard`、不冷却账号；Codex `/v1/alpha/search`、OpenAI 独立额度闸门 `codex.quota`；日志记录出站 Session（迁移 `029`）、拒答近似与设备封禁表（迁移 `030`）、拦截记录（迁移 `031`）；Claude 流中途断开补 `max_tokens` 收尾；遥测 sidecar 自愈；实验性 ARM64 控制面（本 fork 不用）。
- 拒答封设备（fork 定制，`refusal-guard.mjs` 的 `refusalGuardPolicy`）：上游默认开启，fork 改为未设置时关闭，管理台「协议 → 拒答缓存 → 封禁 device」可手动打开。原因：一次拒答就永久封掉该用户 Claude Code 的设备 ID，经 Sub2API 转发的用户会被整机拉黑。拒答缓存本身照常生效。
- 号池采用上游设备座位规划（v1.3.109–v1.3.110：按入站 device 计席位、FIFO 排队、`queue_max`、排队超时 529 `pool_overloaded`、balanced / fill 策略），删除 Claude 会话窗口（`max_sessions` / `session_idle_min`）及 fork 的 `windowKey` 根会话窗口计数；旧策略名（WRR / 轮询 / LRU / fill-first）按 balanced 处理。
- 智能评分保留为第三种策略 `smart`（生产在用）：`normalizePoolRouting` 白名单含 `smart`；新设备开席时 `openNewSeat` 先在可开席 VM 中按评分选，排不上分的按 balanced 补位，座位上限、额度预留、排队检查在评分之前；直接选号路径仍走 `smartRank`。活跃会话数改为“已占座位数”和“在途请求数”取大（上游已不记会话窗口）。管理台号池设置的策略卡片加回「智能评分」（`pool-pane.tsx` 的 `strategyOf`），否则保存设置会把 smart 改成平衡；实时态势的下一席预估对 smart 按平衡近似。
- 分组隔离与 `retryAccountId` 贯穿新调度路径：`eligibleCandidates` 按 `groupScope`、`retryAccountId` 过滤，直接选号、座位、排队授予、`peekAccount` 都用过滤后的候选；直接选号预留前再查一次分组；座位 key（`scopedSeatKey`）带分组 ID，不同分组的 Key 不共用座位。合并上游时注意 `selectAndReserve` / `selectSeat` / `eligibleCandidates` 的这两个参数、`scopedSeatKey`、`normalizePoolRouting` 白名单与 `openNewSeat` 的 smart 分支。
- 宿主防火墙 INPUT 放行沿用 fork 规则（只放行本桥接网段到网关监听端口），不叠加上游 v1.3.107 以子网为目的地址的同类规则，避免重复放行。
- Codex 选号沿用上游 `listVms(..., { codex: { quota } })`，再按 API Key 分组过滤。
- 管理台：侧栏采用上游四组（监控 / 资源 / 协议 / 系统），保留 fork `VIEW_TITLES` 白话标题、账号状态灯，「用户」放在系统组；总览保留 fork 交换台布局，按上游去重（费用在用量页、趋势在统计页）；设置页粘性 / 号池 / 配额三页采用上游可视化调度设置（fork 白话文案未保留，只保留分区标题、简介与 13rem 导航宽度）；上游删除凭证调度等级页，等级改在账号详情「调度」块设置；账号列表加上游全局排队与席位标签，保留 fork 按钮和状态筛选；日志详情「会话信息」同时显示账号分组、Key 名称、出站 Session 和客户端 Session（合并时注意 `summary-tab.tsx`、`panel-usage-logs.ts`、`usage-logs-view.mjs` 的 `toUsageLogRow`）；`index.html` 保留 fork 主题用的 Google Fonts；README 保留 fork 精简版。
- cli-hop 出站体：采用上游 `downgradeUngatedThinkingDisplay`，之后仍过 fork 的 `preserveClientToolEnvironment`。
- 仓内 `cli-node` 以上游 v1.3.123 cli-node（`c0edfaef`，Claude Code 2.1.293）为基线打 `caller-system-v3+safeguards-v1` 补丁，并删掉上游新增的无条件 safeguards 转发与 afk-mode beta，成品 SHA-256 `6c8164fc…`（见 [CLI_SYSTEM_PATCH.md](CLI_SYSTEM_PATCH.md)、`share/wrap-cli/PATCH.json`）。

- 采用 v1.3.91 的 native 错误与恢复：CLI 的真实 HTTP / 网络错误（code、status、type、message、retry-after）原样返回，不再统一成 `incomplete_response`；请求失败或执行位全忙都不再回收 CLI，恢复由内核（关闭未 ack 的 slot、限次重启 CLI）和 watchdog（限次重启容器）有界执行。Node 每个 hop 带 `request_id`，客户端断开时调内核 `/internal/v1/cancel`。依赖新 `kin-kernel` 与新 `cli-node`，Node、内核、CLI 必须一起上线。
- watchdog 探测放宽（fork 定制，`kernel-watchdog.mjs`）：健康探测等待 `kernel_watchdog.health_timeout_ms`（默认 3000，范围 500–15000），连续 `kernel_watchdog.fail_threshold` 次（默认 3，范围 1–10，约 1 分钟）探测需要重启才进入“递增等待 → 重启容器”流程；中间一次健康就清零，并清掉尚未开始重启的等待状态。原因：上游探测只等 800 毫秒、单次失败就进入重启流程，会误杀正在出结果的槽位。合并上游时 `kernel-watchdog.mjs` 有冲突要保留这两项及连续失败计数。
- 采用 #191（cli-hop 的 `stop_reason=max_tokens` 视为正常截断）：Node 删除旧 `max_tokens<=64 → 1024` 规避分支，`compatibility.min_max_tokens` 下限仍生效。
- auto mode 服务端检查（fork 定制）：cli-hop 上 `prepareCliHopBody` 只在 `compatibility.auto_mode_server` 非 `false`、调用方 `safeguards` 为数组、`anthropic-beta` 含 `dangerous-tool-use-YYYY-MM-DD` 时保留 `safeguards` 并写内部字段 `kin_safeguards_beta`，否则两者都删；`cli-node` 补丁把 beta 并入出站 `anthropic-beta`，不外发内部字段。只放行这一个调用方 beta。
- auto mode 分类请求（上游 v1.3.94）与 fork safeguards 并存：`handle-protocol.mjs` 用 `classifyClaudeRequestPurpose` 得到 `requestContext`，分类请求不走 Node persona、不做 fork 的“调用方 system 快照重建”（cli-hop 重建条件是 `!requestContext && !officialTraffic`），普通请求仍按 fork 重建。cli-hop 调用 `prepareCliHopBody` 时同时传 `safeguardsBeta`、`autoModeServer`、`requestContext`；分类请求在 `prepareCliHopBody` 内走上游 `prepareClassifierBody`，之后仍过 fork 的 `applyCliHopSafeguards`（beta 不合规就删 `safeguards`）。合并上游时用 `git grep -n "requestContext\|safeguardsBeta\|kin_safeguards_beta" -- src` 核对 `handle-protocol.mjs`、`outbound-attempt.mjs` 这两处。
- 采用上游槽位终端（`src/lib/vm/slot-shell.mjs`、`web/src/components/ws-terminal.tsx`、`vm-shell-card.tsx`）：仅管理员，经 30 秒一次性 ticket 打开 WebSocket；反代必须对 `^/api/panel/(cluster/nodes|vms)/[^/]+/shell$` 透传 Upgrade（见 `docs/nginx-shell.md`）。
- 采用上游 Claude 原生限额重置（`src/lib/oauth/claude-reset-credits.mjs`，`/api/panel/vms/:id/claude-reset/query|redeem`）：经槽内 `kin-worker` 出站，槽位需加载新版 `kin-worker`，否则查询返回 worker 不支持。本 fork 只在管理台手动使用，不做自动兑换。
- 采用上游官方 Setup Token 区分：官方 `claude setup-token` 落盘为 `official-setup-token`，与转换后的完整 Setup Token 分开显示和处理。
- 采用上游自定义 DoH（`dns_primary` 可填 HTTPS DoH URL）；本 fork 生产不配置。
- 管理台「运维」tab（`detail-ops-tab.tsx`）保留 fork 的 `OpsGroup` 分组布局，上游槽位终端放在单独的「槽位终端」组；侧栏标题（`app-title.tsx`）保留 fork 样式，不采用上游霓虹品牌外框。
- 采用 #190：新 `bin/kin-egress` 拒绝自转发直连；`egress.mjs` 就绪检查改用 `ss -ltn`，运行环境需有 `ss`。
- 采用上游管理台用户管理（`/api/panel/users`、`#/users`，侧栏「记录与设置」组）。管理员在管理台改过密码后以 SQLite `users` 为准，`.env` 的 `VM2API_ADMIN_PASSWORD` 对该账号不再生效。
- 采用上游集群 SSH / 远程 Docker 与集群 VM 放置（`src/lib/cluster/*`、`slotHost(vm)` 契约、WebSocket 终端、迁移 `026_cluster_nodes.sql`、依赖 `ssh2`、`ws`、`https-proxy-agent`、`@xterm/xterm`）。本 fork 部署保持闲置，不添加远程节点；本机建槽仍先检查槽位镜像（`inspectKernelImage`），节点建槽走上游节点预检。管理台运行环境页对节点槽位禁用官方初装和内核重装/设为模板。
- 采用 v1.3.89 单槽位配额覆盖、v1.3.90 SOCKS5 IPv6 修复与「IPv6 代理出口」开关（默认关闭）。
- Claude Code 带 `x-claude-code-agent-id` 时优先使用上游稳定子会话 ID，父会话仍为原始 root；无此头时保留 fork specialist 指纹隔离。分组候选和 family 检查、智能评分、取消、空响应退避继续保留。
- cc-node 保持原版本。CLI 补丁维护与验证边界以 [CLI_SYSTEM_PATCH.md](CLI_SYSTEM_PATCH.md) 为准。
- 管理台保留定制色板、账号线视图、状态灯及分组删除，融合上游详情卡、操作菜单、统计、平台选项、品牌链接、用户与集群页面。`web/dist` 由合并后源码重建。
- 管理员仅豁免用户级并发限制；API Key、账号额度和分组限制不放开。

## 账号同步

- 新增 `POST /api/panel/vms/:id/sync`（`panel-api.mjs` 的 `buildSyncOne`，`user` 角色与 `/probe` 同样放行，见 `panel-acl.mjs`）：官方 profile 定套餐 → 强制查额度 → 官方确认 5h / 7d 都有额度时只解除额度类冷却。"查一遍额度"和后台探测不解除冷却。
- 官方 profile 套餐优先于额度推断（`account_tier_source: profile`）：`persistAccountTier` 只让新 profile 改写 profile 套餐，`usage` 只刷新 `account_tier_checked_at`；`inferClaudeTier` 不再用 `usage_has_fable` 覆盖 profile；`buildProbeOne` 查完额度把号池套餐写回 profile。列表/详情新增 `account_tier_source`、`account_tier_checked_at`、`tier_confirmed`、`account_issue`（`account-issue.mjs`）。
- 主 Key `x-kin-vm` 指定账号的请求（含管理台测试）跳过额度类本地冷却，成功后解除额度类冷却并重判 5h / 7d 安全线；模型级、RPM、过载、认证类冷却和并发上限不变，不跨组回退。额度类口径为 `availability.isQuotaClassCooldownReason`，`AccountRuntimeRepo.QUOTA_CLASS_COOLDOWN` 复制同一正则，改口径需两处同步。
- 合并上游时注意冲突点：`pool-scheduler.mjs` 的 `account_cooldown` 等待与 `clearQuotaCooldownAfterPinSuccess`、`failover-runner.mjs` pin 成功收尾、`claude-tier.mjs`、`vm-registry.mjs` 的 `persistAccountTier`、`vm-test-chat.mjs` 的 `extractError`（本地拦截返回 `code: pool_overloaded`、`local: true`）。

## v1.3.79 基线

同步上游 `291dee4`（v1.3.79）。上游重写了历史，本次以此前已合入的 v1.3.73 文件树作为三方合并基线，保留 fork 历史并将当前上游提交作为合并父节点；未重写 fork 的已发布提交。

- 采用上游空闲账号优先、每请求每账号最多三次实际执行、会话窗口引用计数及额度探测修复。family 现在是亲和偏好，已取得的组内空闲位置不会因并发 family 绑定而被丢弃。所有候选和执行前仍校验 API Key 分组，不跨组回退。
- 保留智能评分、排队取消后的 session tail 清理、请求级空响应退避和日志扫描修复。评分统计不会把仍在执行的长会话当作过期会话删除。
- 保留定制深色管理台；接入上游代理池与 system 页面更新。上游 Dockerfile 改为直接复制 `web/dist`，因此仓内构建产物已由本 fork 的合并源码重新生成，不能直接沿用上游产物。
- 修复上游 Opus 5.5 computer tool 转换引用缺失常量的问题，恢复原有 `computer_toolset_20260801` 映射。
- 客户端工作环境保护保留最小工具作用域说明，不硬编码 Windows、不转换 `/mnt` 路径、不推断缺失字段。cli-hop 的调用方 system 与槽位环境修复由 [CLI_SYSTEM_PATCH.md](CLI_SYSTEM_PATCH.md) 定义：保留调用方顶层 system，只追加网关时区；HTTP 遗留环境行为保持原样。已有会话中的错误环境假设仍可能需要客户端纠正。
- 无新增数据库迁移；wrap/crag Rust 内核不变，仓内 cli-node 与 cc-node 已应用 caller-system-v1 补丁，校验值见 `share/wrap-cli/PATCH.json`。本地源码和二进制修复不代表已部署；生产更新仍需独立备份、运行配置检查、前端构建及请求级验证。

## 历史策略：v1.3.73

以 `dofastted/vm2api` 的 `upstream/main`（`7b77454`，版本 v1.3.73）为基线。此前 `f4ba59e` 合并时保留的整套缓存、标题会话、流式检查、会话队列和 watchdog 定制已重新评估。当前以本节为准，后续合并不再默认保留这些旧补丁。

### v1.3.73 合并与上线边界

同步 v1.3.66–v1.3.73 的出站 session 重建、family 不可用时解除绑定、GPT 型号/RPM 队列、短探测不占会话席位、预热拦截修正及 system 提示词独立页。

- family 锁定检查保留 fork 的绑定前位置、分组成员检查及重选前释放。上游 v1.3.69 的重复检查不再叠加；显式 VM pin 继续优先。不可用 family 的重选仍经过分组过滤。
- 健康缓存采用上游新增的 protocol 参数，并继续经过 `healthDecisionForGroup` 检查，不能返回其它分组的缓存快照。
- 保留智能评分、组内同账号空响应重试、响应断开取消、session tail 清理和槽位部署兼容。
- 采用上游默认 `sticky.outbound_session: rebuild`；可通过 `passthrough` 恢复旧行为。已有部署缺少此字段时也会进入新默认，因此不能把这次合并当作纯界面升级。
- 本次上游 Git 提交未更新 kernel/CLI 二进制。v1.3.66 发布说明另行要求带 hop session 支持的 `cli-node`；源码合并通过不代表运行中的旧 CLI 已完成出站 session 适配。上线前需核对二进制能力并做真实请求级验证。
- 仅合并源码；不覆盖生产 `routing.json`，不重启控制面或槽位，不切换现有模型、effort 和权限模式。

### CLI 缓存

当前采用 v1.3.83 的 `prepareCliHopBody`：Node 清除旧 `cache_control`，按会话 pin 的 TTL 重建最后消息与符合条件的倒数第二 user 断点；native CLI 保留消息标记并管理 system/tools 标记。TTL 仍按请求头、显式断点、配置优先级解析；已有部署的持久配置不变，5m 和 1h 均保留。v1.3.73 的“Node 不重建历史 user 断点”策略已被这次上游实现取代。

沿用上游末尾 `role=system` 提醒原位保留、Haiku 兼容搬移和缓存前缀诊断。v1.3.32、v1.3.39 已更新 CLI 二进制，不再用旧二进制的缺陷作为强制 5m 的依据。此次为源码对齐，真实 1h 缓存命中和多轮工具调用仍需要部署后验证。

### 标题请求与会话队列

采用上游调用方 session 提取方式，标题请求不再派生独立子会话；同一 caller session 的标题与主任务使用相同调度 key。删除 fork 的标题识别模块和独立 `SessionQueue`，采用上游 `FailoverRunner.sessionTails` 队列。

队列保留两处 fork 修复：
- 清理 session key 必须等待整个 tail（含全部前序任务）完成。上游在取消最后一个等待者时立即删 key，会让新请求越过仍在执行的前序任务。
- 排队设上限 `failover.session_queue_max_wait_ms`（缺省 15000，0 为不限）：超时后本次请求与前序并行执行，日志打 `[session-queue]`，绑定与选号策略不变。原因：中间层（如 Sub2API）丢掉 `x-claude-code-agent-id` 时，并行子代理都落到主会话 key 上，会排在几分钟的长回合后面，超过 Nginx 600 秒被 504。合并上游时注意 `failover-runner.mjs` 的 `waitForSessionTurn`。

### 执行位全忙时的 CLI 回收

上游 v1.3.91 起请求路径不再回收槽位 CLI：`slot_busy` 只让本次请求换槽位，内核自己关闭未 ack 的 slot 并限次重启 CLI，用完次数才由 watchdog 限次重启容器。fork 此前“有在途请求时不回收”的补丁随之取消；回归测试 `slot_busy never recycles the CLI; the watchdog owns recovery` 保证请求路径不回收。合并上游时不要恢复请求路径上的回收。

### 流式响应

传输层、SSE 组装和 kernel router 采用上游实现。按可见输出与 stop reason 判断完整性，不再额外强制收到 `message_stop`；保留上游额度错误还原、空响应重试和回收行为。

最终响应收尾仅保留状态一致性修复：显式传输失败或失败 terminal state 不能被看似完整的正文改成成功；不完整响应已经发送给客户端时保留 `committed=true`，避免后续按未发送响应处理或重试。现有回归测试能够在未修复的上游实现上复现这些问题。

### Watchdog

采用上游目标选择、默认 20 秒检查间隔和健康判断。删除 fork 的默认 5 秒检查、继承引擎目标扩展及“无实际 hop 但槽位全忙”定时回收逻辑。上游 v1.3.31 的 native slot 生命周期与粘性修复已包含在仓内 kernel 二进制中。v1.3.41 的静默 job 取消、取消确认超时及 wedged slot 健康判断也按上游实现同步。

## 继续保留的部署兼容性

### 槽位镜像与部署

沿用本地 `kin-os/*` 标签，`os-catalog.mjs` 是构建、检查与运行的共同来源。显式设置 `KIN_OS_REGISTRY` 可选用上游 registry 标签，通过 `build.mjs --pull` 预拉取；构建兜底仍使用指定 builder/cgroup。`--pull-only` 不构建，`--check` 不拉取或构建，建槽/开机请求也不自动构建。生产保留预构建后 `VM2API_SLOT_IMAGE_MODE=check`。

保留上游宿主路径自动换算。控制面默认镜像为本 fork 的 `hixz12-vm2api:local`，使用 `docker-compose.build.yml` 构建；官方预构建控制面镜像不含这些 fork 定制。

v1.3.42 新增的 `share/crag/kin-kernel` 纳入 Docker 构建上下文和镜像；入口脚本原子安装到持久化的 `share/crag`，内容变化时沿用现有自动同步开关。crag ELF 标记为二进制，避免换行转换。仅提供上游的切换能力，不主动修改已保存的 wrap/crag 选择。

v1.3.49–v1.3.51 沿用上游 baseline x64 `cli-node`、新增 `cc-node` 及移除写死提示词的 crag kernel。入口脚本按内容原子更新 `cli-node`、`cc-node`，继续安装 crag；支持 `wrap`（cli-node + wrap kernel）、`cc`（cc-node + wrap kernel）、`crag`（cc-node + crag kernel）三种搭配，不覆盖持久化的引擎选择。

### 槽位资源与配置属主

`KIN_KERNEL_NATIVE_SLOTS` 仍可设置 1–20 个 native session 位置，以匹配现有槽位资源；不设置时沿用上游默认 20。此环境变量不替代账号并发限制，也不会因本次源码对齐修改线上配置。

`kernel.json` 原子替换继续保留已有非 root 属主，新文件或旧 root 属主文件采用槽位 uid/gid；内容未变化时也修复 root 属主。设置属主失败发生在替换正式配置之前，保留旧配置并清理临时文件。

### 特征采集、工具输出和面板

特征采集继续使用 Docker guest 采集器与结构校验，上游 shell 读取器及测试保留。保留出口防火墙兼容与面板配置保存响应。内核/CLI Release 下载 mock 与上游统一，额外保留 CLI 同步到停止槽位的内容断言。

蒸馏检测继续排除 Anthropic `tool_result` 和 OpenAI 工具输出，直接用户及 system/developer 指令仍按原规则检查。此项独立于已删除的标题子会话逻辑。

## v1.3.46 合并范围

采用上游 v1.3.40–v1.3.46 的槽内 OAuth worker、额度查询与刷新、wrap/crag 切换、出口 DNS 备用切换、手动并发/RPM 保护、遥测和探测状态修复。未增加数据库迁移，未覆盖生产 `routing.json`；线上全局 1h 缓存仍需部署后的真实请求验证。本次只合并源码，不部署服务。

## 会话取消与失败隔离

已完整接收的 POST 在响应阶段断开时，不一定触发 `req.aborted`。补充监听未正常结束的 `res.close`，把取消传到上游并释放当前预留及会话队列；正常响应结束不误取消。取消返回 `request_cancelled`，不作为传输错误重试或回收共享 kernel。

空响应或不完整响应按 v1.3.52 的预算在原账号重试，用尽预算后返回 502 `incomplete_response`，不遍历账号池。重试通过 `retryAccountId` 限定候选，仍执行分组、额度和并发检查；不能使用会跳过额度检查的诊断 `pinVmId`。保留 fork 的共享账号保护，不调用上游 `noteDistinctEmptyHop` 将多个会话的失败累计为账号全局冷却。同会话、同 API Key、同分组的相同请求默认退避 60 秒（`failover.empty_response_backoff_ms`），返回 `request_empty_response_backoff` 和 `retry_after_ms`；新会话、改变后的请求或不同分组不继承退避。真实额度、鉴权、过载及熔断保护保持原有语义。

debug 日志增加 `session_queue_ms`、`stream_progress` 和脱敏后的 `upstream_error`。流式进度只记录思考/正文/工具输入字符计数、首内容时间、末内容时间、最长内容间隔和结束时间，不保存额外输出内容。现有 `first_token_ms` 是首个 SSE data 时间，可能只是消息元信息；不能单独用它或平均 TPS 证明持续正常输出。

## v1.3.51 合并范围

同步 v1.3.48–v1.3.51 的设备级父会话匹配、粘性别名释放、槽位席位调度与熔断、Codex 流式计费及工具调用清洗、计费档展示和三种内核搭配。采用数据库迁移 023–025，增加设备、粘性 generation/slot、熔断和计费档字段；生产升级前需备份数据库。本次不运行生产迁移或部署。

保留 fork 的 API Key 账号分组、实时成员复核和健康缓存分组校验。分组参数继续贯穿新调度流程；不完整响应导致组内账号耗尽时返回 `group_no_eligible_accounts`（503），不被上一跳覆盖成 502，也不跨组回退。保留取消排队请求时的 session tail 清理修复、响应收尾一致性、配置属主、native slot 数量和槽位镜像部署适配。

## v1.3.52 合并范围

同步 Haiku 关闭 thinking 时的 `context_management` 清理、蒸馏否定句识别、128 MiB 入站限制、GPT 目录更新与多账号同步，以及空响应终止策略。保留工具输出蒸馏豁免、分组隔离、断连取消、会话队列清理和 specialist 子任务身份修复。

真实双账号调度回归发现：空响应清除粘性绑定后，上游的“同账号重试”仍可能被轮询调度到另一个账号。补充仅缩小候选范围的 `retryAccountId`，确保重试原账号且保留所有正常保护。新增分组/额度/并发回归，保留多个失败会话不影响健康会话的测试。旧版“不完整响应耗尽分组返回 503”描述仅适用于历史版本；新版空响应在原账号结束并返回 502，真正组内无可用账号仍为 503。

未修改 Go、前端、数据库迁移、原生二进制或生产配置。本次只合并源码，未部署。

## v1.3.55 合并范围

同步 v1.3.53–v1.3.55：空跳不再 SIGKILL CLI、`message_stop` 作为流终止事件、`tool_choice.name` 顶层化、流式缓存计费、VM 计费窗口展示，以及 Claude family（父/子会话同 VM、各占独立席位）。原生 `kin-kernel`、`cli-node` 随上游更新；未新增数据库迁移。

取消统一采用上游 `clientCancelledResult`（`client_cancelled`，499），删除 fork 的 `cancelledHop`/`request_cancelled` 返回；判定只看请求自己的 AbortSignal，不再把 `ABORT_ERR`、`ECONNRESET` 文本当作取消。保留 fork 的 `createClientAbort`（`res.close` 仅在未正常结束时取消，已断开的响应立即取消），不采用上游 `bindClientAbort`。保留 session tail 清理修复、响应收尾一致性（显式传输失败或非 verified terminal 不被正文改成成功）和 debug `stream_progress`/`upstream_error`。

空跳采用上游独立分支（`emptyHopReleased` 检查后同号重试一次，否则 502），在其中继续设置 `retryAccountId`，保证重试仍落在原账号并走分组、额度和并发检查。上游已删除 `noteDistinctEmptyHop`，与 fork 的共享账号保护一致。

family 与分组隔离的补充：
- 请求入口发现 family 绑定的 VM 不在当前 API Key 分组内时解除该 family 绑定，本次按分组正常选号。
- 调度后检查 family 锁定时，仅当锁定 VM 属于分组才改到该 VM；诊断 `pinVmId` 不受 family 影响。
- 修复上游在 family 锁定改选前未释放已预留席位与 native slot 的泄漏；同一 family VM 重选后仍冲突时返回 `family_vm_unavailable`，不再循环消耗尝试次数。
- 组内耗尽仍返回 `group_no_eligible_accounts`（503），不被上一跳不完整结果改写成 502；取消结果优先。

v1.3.56（Fable 权益探测标记 Max）只在上游分支 `cursor/fix-supervisor-sigkill`，尚未进入上游 `main`，本次未合并。本次只合并源码，未部署。

## v1.3.60 合并范围

同步 v1.3.56–v1.3.60：Fable 探测判定 Max、组织权限拒绝恢复为 403、Claude 选槽按入站 `metadata.user_id` 识别（session/family/设备 key 不再带 API Key，旧 key 行按需复制）、默认后端地址不再指向 `ccmax20.cc`、换票回填账号信息、按 Extra `reset` 切计费窗、缓存命中率口径和面板空 VM 修复。wrap-kernel 分发流水线已被上游回滚，未进入本次合并。未新增数据库迁移，原生二进制未变。

与 fork 的衔接：
- 分组检查不受 key 去 API Key 化影响：候选仍先按 API Key 分组过滤；分组外的 session 绑定按原逻辑解除，family 绑定在入口检查分组，设备亲和只在组内候选里生效，不会把请求带出分组，也不会把分组外的设备主 VM 改写到组内 VM（新增回归测试）。
- 智能评分与设备亲和同时存在时，采用上游顺序：设备主 VM 可预留时优先，否则再按号池策略（含 `smart`）选号。

## 同步历史

- `upstream/main 6735621b`：同步至 v1.3.106（宿主独占换票、新日志页与统计页、代理名称、下线压测页），`cli-node` 在 v1.3.103 上重打补丁。

- `upstream/main 06f090b1`：同步至 v1.3.95（槽位终端、Claude 原生限额重置、auto mode 分类请求与 fork safeguards 并存、官方 Setup Token 区分、自定义 DoH），`cli-node` 在 v1.3.94 上重打补丁。

- `upstream/main 6a32923`：同步至 v1.3.91（native 取消与有界恢复、真实错误码、集群 VM 放置、单槽位配额、SOCKS5 IPv6），`cli-node` 在 v1.3.91 上重打补丁；fork 的 `slot_busy` 回收条件由上游行为取代。

- `upstream/main 259dbbd`：同步至 v1.3.88（#191、#190、用户管理、集群 SSH / 远程 Docker），保留分组隔离、账号同步与定制管理台。

- `v1.3.64 cd76b57`：同步 v1.3.61–v1.3.64 的内核异常恢复、凭证调度、套餐与额度判定、GPT 用量展示及 OAuth 换票服务。保留分组隔离、智能评分、原子安装与槽位资源限制。镜像改为检查 `kin-oauth-auth` 的 JSON 错误协议；OAuth 测试改为覆盖生产子进程接口，不依赖上游未发布的 `auth.js`。控制面与 wrap kernel 需要更新，槽位须依次同步；不新增数据库迁移。

- `upstream/main 729006f`：同步至 v1.3.60；保留分组隔离、智能评分，设备亲和限定在分组内。

- `c4ee5bb`：同步至 v1.3.55；取消统一为 `client_cancelled`，family 限定在分组内并修复锁定改选的席位泄漏。

- `5b4af18`：同步至 v1.3.52；空响应在原账号结束，保留会话级退避及共享账号隔离，补齐真实调度器重试账号约束。

- `ee4cfc7`：同步至 v1.3.51，解决分组调度、空池错误和 Release 同步测试的合并冲突；新增真实分组调度器回归，验证不完整响应重试、组内耗尽和席位释放。

- `081289c`：同步 v1.3.47，采用上游长上下文及 OpenAI Flex/Fast、Anthropic Fast 计费和请求策略；Haiku 短子请求优先复用同 API Key 最近父会话槽位。未修改数据库结构、依赖、槽位二进制或现有 fork 兼容补丁。

- `be318b3`：同步 v1.3.26 发布后的缓存回退与调度变更，当时保留 CLI 5m 和 Node 历史 user 断点。
- `95cf884`：同步 v1.3.27、v1.3.28，包括 Opus 5.5、Claude Code 2.1.280 身份和槽位旧进程定位修复。
- `e6a8137`：同步 v1.3.29、v1.3.30，包括 TTL 优先级、会话 TTL 固定与本地出口直连。当时 CLI blob 未变化，因此继续保留旧兼容策略。
- `2d7c16f` / `f4ba59e`：同步 v1.3.31–v1.3.39，包括粘性槽位、429/529 硬冷却、缓存修复和 kernel/CLI 更新；随后按用户要求改为本文件顶部的上游优先策略。
- `2e9d7d0`：同步 v1.3.40–v1.3.46，沿用上游优先策略，补齐 crag 的 Docker 打包与持久化安装。

以上历史中的“强制 5m、标题子会话、自定义队列、严格结束事件和自定义 watchdog”不再代表当前实现。本次仅更新源码 fork，未部署生产服务。
