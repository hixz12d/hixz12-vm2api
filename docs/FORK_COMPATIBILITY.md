# Fork 运行兼容性

## CLI 缓存 TTL

当前发行的 CLI / Rust kernel 会添加 5m 缓存断点，且不读取 `kernel.json.cache_ttl`。因此 CLI hop 在 `prepareCliHopBody` 中统一采用 5m，包括官方 Claude Code 请求、显式请求 1h、关闭自动断点时保留的历史标记。缓存断点位置和工具调用内容保留。

`handle-protocol` 同步使用实际的 5m TTL 处理 usage，避免将 5m 写入按 1h 计费。直接 API 上游的 TTL 选择不受此限制。只有发行内核确实支持端到端 1h，并通过真实工具循环与上游 usage 验证后，才能解除 CLI 限制。

## Session 位置

上游 v1.3.6 默认预开 20 个 native session 位置。控制面可用环境变量 `KIN_KERNEL_NATIVE_SLOTS=2` 保留小内存槽位原来的 2 个位置，合法范围为 1–20；不设置时保持上游默认 20。该变量是启动配置，不能替代账号并发限制。线上现有 500 MB 槽位使用 2。

## 流式完整性

合并上游 SSE 组装修复时保留 fork 的真实终止事件校验：只有响应正文和头部中的 stop reason / verified 标志不足以证明流已结束。每个 SSE 事件只能组装一次，避免重复文本或工具 JSON；外层完整性校验与异常槽位回收继续生效。


v1.3.7 的 `mergeAssembledAssistantHop` 保留真实上游错误，不允许空 assistant 覆盖错误正文。最终判定同时保留 transport / terminal 状态：正文存在 stop_reason 不能把 `incomplete`、传输失败或拒绝改成成功。已提交给客户端的流即使失败也保留 committed，避免再次派发。

## 同会话串行

合并 v1.3.7 的同 sticky session 串行行为，并提取为 `SessionQueue`，由 `FailoverRunner` 在账号选择之前排队；不同 session 以及无 session key 的请求保持独立。取消等待者不会提前移除仍有执行中前驱的队列，也不会让后来的请求越过前驱。执行中的任务必须真正结束后才能释放下一轮，失败不会阻塞后续请求；队列空闲后清理对应 key。

串行队列仅作用于当前控制面进程。排队取消通过请求 AbortSignal 处理；既有 failover 重试预算仍在取得 session 执行权后开始计算，不应把它理解为跨进程锁或新增的总请求超时。

## Watchdog 保护

保留 fork 对继承 Rust 配置的运行中 Claude VM 的检查，排除 Codex、KVM 和已停止 VM。默认每 5 秒检查：只有 kernel 无空闲位置、没有实际 hop、最近 hop 已结束至少 10 秒，再连续观察 10 秒后才回收。正常执行中的长请求与健康空闲 kernel 不会因此重启。不能直接用上游旧版 watchdog 覆盖此保护。
