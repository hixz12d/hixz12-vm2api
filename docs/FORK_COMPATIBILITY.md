# Fork 运行兼容性

## 当前策略：优先采用上游 v1.3.51

以 `dofastted/vm2api` 的 `ee4cfc7`（已包含 v1.3.51）为基线。此前 `f4ba59e` 合并时保留的整套缓存、标题会话、流式检查、会话队列和 watchdog 定制已重新评估。当前以本节为准，后续合并不再默认保留这些旧补丁。

### CLI 缓存

采用上游 `prepareCliHopBody` 和请求处理路径：Node 清除旧 `cache_control`，由 native CLI 管理最终断点和 TTL，不再强制 5m 或由 Node 重建历史 user 断点。TTL 按上游的请求头、显式断点、配置优先级解析，并按会话固定。仓内 `routing.json` 默认值恢复为 1h；已有部署的持久化配置仍按其保存值生效，选择 5m 也会被尊重。

沿用上游末尾 `role=system` 提醒原位保留、Haiku 兼容搬移和缓存前缀诊断。v1.3.32、v1.3.39 已更新 CLI 二进制，不再用旧二进制的缺陷作为强制 5m 的依据。此次为源码对齐，真实 1h 缓存命中和多轮工具调用仍需要部署后验证。

### 标题请求与会话队列

采用上游调用方 session 提取方式，标题请求不再派生独立子会话；同一 caller session 的标题与主任务使用相同调度 key。因此标题可能等待主任务结束。删除 fork 的标题识别模块和独立 `SessionQueue`，采用上游 `FailoverRunner.sessionTails` 队列。

队列仅保留一处有回归测试的修复：清理 session key 必须等待整个 tail（含全部前序任务）完成。上游在取消最后一个等待者时立即删 key，会让新请求越过仍在执行的前序任务。修复只移动清理时机，不改变上游选号、重试和会话绑定策略。

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

空响应或不完整响应仍按上游预算重试和切换账号，但用尽预算后不再为所有调用方冷却共享账号。同会话、同 API Key、同分组的相同请求默认退避 60 秒（`failover.empty_response_backoff_ms`），返回 `request_empty_response_backoff` 和 `retry_after_ms`；新会话、改变后的请求或不同分组不继承退避。真实额度、鉴权、过载及熔断保护保持原有语义。

debug 日志增加 `session_queue_ms`、`stream_progress` 和脱敏后的 `upstream_error`。流式进度只记录思考/正文/工具输入字符计数、首内容时间、末内容时间、最长内容间隔和结束时间，不保存额外输出内容。现有 `first_token_ms` 是首个 SSE data 时间，可能只是消息元信息；不能单独用它或平均 TPS 证明持续正常输出。

## v1.3.51 合并范围

同步 v1.3.48–v1.3.51 的设备级父会话匹配、粘性别名释放、槽位席位调度与熔断、Codex 流式计费及工具调用清洗、计费档展示和三种内核搭配。采用数据库迁移 023–025，增加设备、粘性 generation/slot、熔断和计费档字段；生产升级前需备份数据库。本次不运行生产迁移或部署。

保留 fork 的 API Key 账号分组、实时成员复核和健康缓存分组校验。分组参数继续贯穿新调度流程；不完整响应导致组内账号耗尽时返回 `group_no_eligible_accounts`（503），不被上一跳覆盖成 502，也不跨组回退。保留取消排队请求时的 session tail 清理修复、响应收尾一致性、配置属主、native slot 数量和槽位镜像部署适配。

## 同步历史

- `ee4cfc7`：同步至 v1.3.51，解决分组调度、空池错误和 Release 同步测试的合并冲突；新增真实分组调度器回归，验证不完整响应重试、组内耗尽和席位释放。

- `081289c`：同步 v1.3.47，采用上游长上下文及 OpenAI Flex/Fast、Anthropic Fast 计费和请求策略；Haiku 短子请求优先复用同 API Key 最近父会话槽位。未修改数据库结构、依赖、槽位二进制或现有 fork 兼容补丁。

- `be318b3`：同步 v1.3.26 发布后的缓存回退与调度变更，当时保留 CLI 5m 和 Node 历史 user 断点。
- `95cf884`：同步 v1.3.27、v1.3.28，包括 Opus 5.5、Claude Code 2.1.280 身份和槽位旧进程定位修复。
- `e6a8137`：同步 v1.3.29、v1.3.30，包括 TTL 优先级、会话 TTL 固定与本地出口直连。当时 CLI blob 未变化，因此继续保留旧兼容策略。
- `2d7c16f` / `f4ba59e`：同步 v1.3.31–v1.3.39，包括粘性槽位、429/529 硬冷却、缓存修复和 kernel/CLI 更新；随后按用户要求改为本文件顶部的上游优先策略。
- `2e9d7d0`：同步 v1.3.40–v1.3.46，沿用上游优先策略，补齐 crag 的 Docker 打包与持久化安装。

以上历史中的“强制 5m、标题子会话、自定义队列、严格结束事件和自定义 watchdog”不再代表当前实现。本次仅更新源码 fork，未部署生产服务。
