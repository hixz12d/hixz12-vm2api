# Fork 运行兼容性

## CLI 缓存 TTL

当前发行的 CLI / Rust kernel 会添加 5m 缓存断点，且不读取 `kernel.json.cache_ttl`。因此 CLI hop 在 `prepareCliHopBody` 中统一采用 5m，包括官方 Claude Code 请求、显式请求 1h、关闭自动断点时保留的历史标记。缓存断点位置和工具调用内容保留。

`handle-protocol` 同步使用实际的 5m TTL 处理 usage，避免将 5m 写入按 1h 计费。直接 API 上游的 TTL 选择不受此限制。只有发行内核确实支持端到端 1h，并通过真实工具循环与上游 usage 验证后，才能解除 CLI 限制。

## Session 位置

上游 v1.3.6 默认预开 20 个 native session 位置。控制面可用环境变量 `KIN_KERNEL_NATIVE_SLOTS=2` 保留小内存槽位原来的 2 个位置，合法范围为 1–20；不设置时保持上游默认 20。该变量是启动配置，不能替代账号并发限制。线上现有 500 MB 槽位使用 2。

## 流式完整性

合并上游 SSE 组装修复时保留 fork 的真实终止事件校验：只有响应正文和头部中的 stop reason / verified 标志不足以证明流已结束。每个 SSE 事件只能组装一次，避免重复文本或工具 JSON；外层完整性校验与异常槽位回收继续生效。
