# 账号分组与 API Key

在控制台 **密钥 → 账号分组** 创建分组，勾选现有槽位账号。一个槽位可以属于多个分组。创建或编辑 OAuth 密钥时选择账号分组；密钥列表显示组名，请求日志详情显示账号分组和密钥名称。

例如建立 `Claude Pro` 和 `Claude Max`，分别选择 Pro 与 Max 槽位，再创建 `sub2api-pro`、`sub2api-max` 两把密钥。Sub2API 使用相同 Base URL 和不同 Key 即可区分上游账号池。

## 路由约束

- 所有受管 OAuth Key 只使用所属分组内的槽位；模型权限、账号状态、并发和额度检查继续生效。
- 调度、排队后预留、重试、故障回退和旧粘性会话均重新检查成员。组内无账号可用时返回 503，不会回退到全池。
- Key 改组、停用、删除，或账号从组内移除后，后续调度不能继续使用原绑定。已开始的推理可正常结束。
- 覆盖 Claude Messages / Chat Completions、GPT Responses 及 token/usage 的账号选择。Haiku 子请求继承的父会话也必须位于本 Key 当前分组内。
- 普通 Key 的 `x-kin-vm` 不能绕过分组；Master 的诊断固定槽位能力保持原行为。
- 不存在或停用的分组拒绝 Key 调用。API 直连端点不属于槽位账号分组，因此 API 分类 Key 只允许绑定默认 coding 分组。

## 管理与兼容

复用 `groups`、`account_groups` 和 `api_keys.group_id`，没有新增数据库迁移。默认 coding 分组保留原有成员，新导入账号仍按原有逻辑加入 coding。新增分组不会自动移除其他分组的成员，也不会自动改变旧 Key。

分组创建、编辑和账号成员修改仅对管理员开放；普通面板用户不能更改 Key 的组归属，也看不到分组的账号成员列表。保存支持 `expected_updated_at`，检测并发编辑后返回 409。

回滚到尚未实施组内调度的旧版本前，必须先停用新建的分组专用 Key；旧版本会忽略组内路由约束，不能在保持这些 Key 有效的情况下直接回退。

管理 API：

- `GET /api/panel/groups`：列出分组；管理员同时获取成员和可选槽位。
- `POST /api/panel/groups`：创建分组，字段包括 `name`、`description`、`status`、`vm_ids`。
- `PATCH /api/panel/groups/:id`：编辑分组；`vm_ids` 为完整成员集合，空数组表示空组。
- `POST /api/panel/api-keys` / `PATCH /api/panel/api-keys/:id`：通过 `group_id` 绑定分组。

## 验证

`test/unit/group-routing.test.mjs` 覆盖实际 SQLite 成员关系、旧粘性绑定、跨组固定槽位、账号耗尽回退、异步健康检查期间改组、Key 撤销、Codex 候选和管理员权限。

`test/e2e/group-routing.e2e.test.mjs` 用实际 HTTP 网关验证管理接口和空组拒绝，不依赖 native kernel。原有 `api-keys.e2e.test.mjs` 的成功推理 mock 在 v1.3.47 基线已返回 `rust kernel is not available`；真实正向推理需在有 native kernel 的环境验证。
