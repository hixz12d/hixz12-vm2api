# Fork 运行兼容性

## 当前源码：上游 v1.3.218 + 缓存修复，精简调度和 CLI 定制

基于 fork `9d8d6b7b`，以 `593d465a..1af2f77c` 的三方增量融合上游。上游版本为 v1.3.218，额外包含尚未发版的双 user 缓存断点修复。本轮源码已完成本地验证；实际发布提交、镜像、上线状态与回滚依据统一见运维仓库 `docs/RUNBOOK.md`。

- 新增权限作用域收紧、异步健康检查后的冷却重判、最终 worker envelope 日志、槽位特征采集与遥测修复、官方登录自动启动槽位、GPT 生图与模型映射。
- 包含迁移 `042_usage_logs_image_generation`（加列）；本地迁移验证不等于生产迁移验收。依赖与锁文件不变。
- 按用户确认退役 Claude `smart` 智能评分。新设备使用上游 `balanced` / `fill`，设备绑定、已有座位、排队、额度预留及并发保护保留。旧 `pool.strategy=smart` 读取为 `balanced`，归一化时移除旧 `pool.smart` 参数，不主动覆盖持久文件。上游自己的 OpenAI 选号逻辑不属于本次删除范围。
- `cli-node`、`cc-node` 改用 payload 清单固定的原版；Node 的提示词与 CLI 请求组装恢复上游，不再维护补丁脚本。auto mode 能力、行为变化与验证边界见 [CLI_SYSTEM_PATCH.md](CLI_SYSTEM_PATCH.md)。
- `bin/kin-computer` 采用新清单，已有槽位身份不重算；Go worker 从融合源码编译为 Linux amd64，前端从融合源码重新构建。Rust 内核不变。
- 保留原先工作区未提交的调度准入/等待预算及缓存计算优化，未把它们与智能评分一起删除。
- 本轮证据见 [UPSTREAM_1_3_218_EVIDENCE.json](UPSTREAM_1_3_218_EVIDENCE.json)。旧 evidence 文件仅为历史审计。
- 发布合并提交保留 fork 历史并将 `1af2f77c`（完整 SHA 见证据文件）记录为上游父节点。后续 fetch 使用 `--no-tags`，不覆盖重写前的本地标签。

## 调度准入与等待预算

- 分组、Key 范围、设备座位与会话亲和保持不变；不降低 5h / 7d 保护线，不取消临界区单并发或每座位额度预留。
- 新设备在全部候选连第一个座位的额度预留都不足时，立即返回 503 `seat_budget_exhausted`，保留具体原因，不改写成泛化的分组不可用；附 30 秒 Retry-After 作为本地重试退避，不表示官方窗口将在 30 秒后重置。已有座位仍按原保护规则继续，临时座位占满仍正常排队。
- 尚未占座的请求不再坚持等待一个已无首座位预算的旧账号，转入当前分组内的全局候选；已有设备的繁忙绑定不变。
- 从进入 `FailoverRunner.run` 开始共享原有 `total_retry_deadline_ms`（默认 120 秒）：会话等待也计入预算；队列迁移可调整阶段等待时间，但不得延长请求总截止时间。取消或已过期的等待票不再取得新的预留。已经执行中的长回复不被该预算截断；原有搜索历史修复的一次性补救跳及最多 30 秒等待例外保留。
- 本机账号有效并发取账号上限与 `wrapSlotCount` 的较小值，复用内核启动时的 `KIN_KERNEL_NATIVE_SLOTS` 口径；设备座位上限与瞬时 `ready_slots` 不当作执行并发。远程节点不套用控制面本机环境变量上限。
- 这些修复与本轮精简一起发布；是否已进入生产，以运维仓库 `docs/RUNBOOK.md` 的当前版本为准。

## 必须保留的隔离与请求契约

- `groupScope`、上游 `ownerScope`、`keyScope` 取交集。直接选号、设备座位、排队授予、只读额度/token 查询、Codex（含搜索和生图）不得跨分组或属主。不同分组的 Key 不共用座位。
- 分组成员与启用状态按请求复核；健康缓存经 `healthDecisionForGroup` 校验。family 绑定在分组外时解除，改选前释放预留；`retryAccountId` 只缩小候选，不绕过额度与并发。Responses WebSocket 转 HTTP 时保留 `groupScope`。
- 额度保护、临界区单并发与大请求限制、每账号工作时段、风险规则和拒答缓存沿用上游。fork 的拒答后封设备默认关闭仍保留，避免经 Sub2API 转发的一次拒答永久拉黑整台用户设备。
- 客户端断开后传播取消并释放请求预留；正常响应完成不误取消。会话队列 tail 等待前序链完成才清理。`session_queue_max_wait_ms` 保留默认 15000ms 的并行兜底，与硬会话超时和总请求预算取先到者。
- 保留会话级空回复退避、重试候选约束及显式失败/已发送状态的一致性；真实错误不能被看似完整的正文改成成功。`slot_busy` 不在请求路径回收 CLI，恢复由内核和 watchdog 负责。
- watchdog 默认 3000ms、连续三次失败后才进入有界恢复；中间恢复健康时清零。不恢复早期的激进回收补丁。
- Claude Code agent ID 优先生成子会话；缺少该头时保留 specialist 指纹隔离。蒸馏检测继续排除工具输出，直接用户和 system/developer 指令仍检查。
- 管理员只豁免用户级并发，不放开 Key、账号额度或分组限制。API 直连与删槽采用上游管理员权限规则，非管理员不能通过提交 category/group_id 绕过。

## 账号同步

- `POST /api/panel/vms/:id/sync`：官方 profile 定套餐，再强制查额度；官方确认 5h / 7d 都有额度时只解除额度类冷却。普通“查一遍额度”和后台探测不解除冷却。
- profile 套餐优先于额度推断，保留 `account_tier_source`、`account_tier_checked_at`、`tier_confirmed`、`account_issue`。
- 主 Key 指定账号的诊断请求可跳过本地额度类冷却，成功后解除该类冷却并重判安全线；模型、RPM、过载、认证冷却与并发限制不变，不跨组。
- 额度类口径由 `availability.isQuotaClassCooldownReason` 与 `AccountRuntimeRepo.QUOTA_CLASS_COOLDOWN` 共同维护。限额重置只手动兑换，不自动使用。

## 性能与管理台

- 用量统计保留 60 秒缓存与只读 SQLite 工作线程，过期快照先返回再后台刷新；仅网关单例启用，独立连接仍同步。重定价沿用新版 image_cost 字段。
- 查额度最多 3 个账号并行；已确认 Max 的 Fable 补测为 24 小时，Pro 为 1 小时。槽位与用量轮询 30 秒，席位通过 stream 实时推送。
- 既有本地缓存优化保留：同一请求体候选预估复用前缀快照；完整 cache_continuity 仅在 debug 日志计算。不宣称真实缓存命中已验证。
- 管理台保留定制主题、白话叫法、账号线视图、Key/分组、用量入口、用户管理、槽位终端与编辑确认。接入上游新增页面和窄屏修复，不重做视觉设计。
- 前端产物 `web/dist` 必须由融合源码生成；不能直接采用官方产物覆盖分组管理。

## 部署契约

- 本 fork 的 Dockerfile 打包仓内已校验 payload 和 web/dist。槽位系统镜像保持 `kin-os/*` 与 `VM2API_SLOT_IMAGE_MODE=check`；请求路径不现场拉取或构建。
- 本机账号继续使用 Docker，不因新版本转成 KVM；远程节点能力保持闲置，不触发旧槽迁移或重建。
- 全局/账号内存规格优先，未设置时兼容 `KIN_VM_MEMORY`，支持 `1536m`。`KIN_KERNEL_NATIVE_SLOTS` 支持 1–20，不替代账号并发限制。
- 保留 kernel 配置原子替换与非 root 属主、trixie glibc、OAuth JSON 启动检查、crag 安装、停止槽位的 payload 同步、有限宿主桥接网段防火墙放行。
- 本地 Docker 特征采集保持 fork 的 guest 采集器和结构校验；KVM/远程节点使用上游 reader。KVM SMBIOS 参数只接受合法参数对，不执行文件内容。
- 发布只重建控制面，不连带重建账号或其它服务；本轮从补丁 CLI 切回原版，必须同步槽位 CLI。先做一次新鲜备份并演练回滚提取，再执行受限构建、切换、出口恢复和请求级验证。
- 不覆盖生产 `.env`、`routing.json`、`vms/`、`data/`，不改账号分组、调度启停或现有引擎选择。本地源码、模拟联调和编译通过不等于生产验收。
