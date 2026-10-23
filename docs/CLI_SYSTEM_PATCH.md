# CLI：采用上游原版

## 当前源码状态

源码融合上游 `1af2f77c`（v1.3.218 加未发布的双 user 缓存断点修复）。按用户确认，`caller-system` 和 `safeguards` 二进制补丁已退役；不再提取、修改和重编 CLI。本轮源码已完成本地验证，实际发布与生产状态以运维仓库 `docs/RUNBOOK.md` 为准。

- `cli-node` 与 `cc-node` 都采用 `deploy/payload.json` 固定的上游原版。来源为 `payload-2026.10.22-computer-linux`，大小和 SHA-256 均已校验。
- `scripts/patch-cli-system.py`、`share/wrap-cli/PATCH.json` 已删除。旧 evidence 文件只是历史审计，不是当前 payload 清单。
- Node 的 `outbound-attempt.mjs`、`crs-persona.mjs` 与上游一致；取消调用方 system 快照重建、crag system 打包、额外客户端工具环境说明及 `kin_safeguards_beta` 注入。
- 管理台不再提供 fork 的 auto mode 服务端检查开关。旧持久配置中的 `compatibility.auto_mode_server` 不再生效；不主动改写生产配置。
- system/persona、环境过滤、缓存布局和 auto mode 都跟随上游，不能再承诺旧版的调用方提示词逐字保留行为。

## auto mode 核实结果

使用哈希校验过的原版 CLI、真实 Rust 内核和本地模拟上游，未连接真实 Anthropic：

- 独立分类请求走上游 `request_context=auto_mode_classifier`，无需 fork 补丁。
- 普通请求带 `safeguards: [{ type: 'dangerous_tool_use' }]` 时，实际出站保留该字段，并生成 `dangerous-tool-use-2026-09-03` beta。
- 原版使用内置 beta 版本，不是任意调用方日期原样透传；未来协议版本变化应更新上游，而不是恢复旧补丁。
- 融合后复用已有真实内核/CLI 联调：5 项通过，未提供旧 CLI 的兼容场景跳过 1 项。旧普通请求断言已对齐原版：thinking 默认 `display=summarized`，检查调用方正文而不是强制出现 fork 的 `# Environment`。

这些证据只证明请求识别、传递、响应与取消等本地链路，**不证明真实账号具备 auto mode 资格**，也不证明不会出现 `session isn't eligible`。真实 Claude Code、真实 Anthropic、缓存命中与长期运行仍需上线验收。

## 维护与上线

- payload 的唯一版本与哈希来源是 `deploy/payload.json`。更新时校验所有文件；Go worker 从融合后的源码另行编译。
- Dockerfile 仍打包仓内已校验二进制与本地构建的 `web/dist`，不改为在生产构建中临时下载 CLI。
- 这次虽然上游 v1.3.218 的普通升级说明不要求同步 CLI，但本 fork 从补丁版切换原版，**将来上线必须同步槽位 CLI**，不能只换控制面。按运维 RUNBOOK 做单次备份、构建隔离、出口恢复及请求级路由验证。
- 不覆盖 `.env`、`routing.json`、`vms/`、`data/`，不重建账号容器，不改变账号分组或引擎选择。
