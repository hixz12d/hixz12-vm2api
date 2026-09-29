# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

唯一使用者是站长本人：自建并运维这台 vm2api，技术上懂一些，但不是专业开发者，不熟悉 kernel、native 位、hop、透传、蒸馏这类实现层术语。管理台是个人运维工具，不对外开放，也不给不懂技术的人用。

打开管理台最常做的三件事（已确认）：

1. **看服务是否正常**：各账号是否在线、5 小时 / 7 天额度还剩多少、最近请求有没有异常。
2. **管理 Key 和分组**：给 Sub2API 等下游发调用 Key，把 Key 绑到 Claude Pro / Claude Max 等账号分组，调整并发和限额。
3. **导入账号、管理账号运行环境**：导入凭证（Setup Token / Console Key / 完整 OAuth）、启动或停止、换出口代理。

看日志排错不在最常用之列，但出问题时要能快速找到原因。

## Product Purpose

vm2api 把 Claude（以及 GPT / Codex）账号分别放进独立的机器环境（Docker 容器或真虚拟机）中运行，对外提供 Anthropic `/v1/messages` 以及 OpenAI Chat / Completions / Responses 兼容接口。管理台 `GET /console` 用于管理这些账号、出口代理、调用 Key、分组和调度策略。

成功的标准：站长打开任一页面，不查文档就能看懂"现在是什么状态、这个开关开了会怎样"，并能在几步之内完成上面三件常用事。

## Positioning

每个账号独占一台独立机器（独立家目录、出口、设备特征），并且不注入提示词，而是以官方 Claude Code 的形态发出请求。这是本项目区别于普通 API 中转的核心机制。

## Operating Context

- 部署在一台美国 VPS（Debian 12），经 Nginx 暴露。Sub2API 以 Anthropic / API Key 上游的方式调用本服务。
- 当前有四个 Claude 账号：Claude Pro 分组为 vm-04；Claude Max 分组为 Debian 槽位 vm-02 和 Ubuntu 槽位 vm-03（vm-03 已关闭调度）；vm-01 未分入这两组且已关闭调度。Key 有 `sub2api-pro`（Claude Pro）、`sub2api-max` 和旧的"连接Sub"（Claude Max）。成员以管理台为准。
- 本仓库是 fork（origin `hixz12d/hixz12-vm2api`，upstream `dofastted/vm2api`），上游更新频繁。
- 已确认：前端可以深度重做，接受以后合并上游时手动对齐前端改动的成本。

## Capabilities and Constraints

- 技术栈沿用现有代码：React 19 + Vite + TanStack Router（hash 路由）+ TanStack Query + shadcn/ui（Radix）+ Tailwind v4，源码位于 `web/`，构建产物由控制面在 `/console` 提供。
- 没有 i18n，界面文案全部硬编码在 TSX 中，主语言为简体中文。
- 本地开发需要真实后端（vite 把 `/api` 代理到 `VM2API_API_PROXY`，默认 `127.0.0.1:8787`），没有全局 mock。
- 只重做前端展现：后端 API、数据字段和功能行为保持不变；不能删除功能，只能调整入口位置和呈现方式。

### 术语约定（已确认）

- 面向用户的核心叫法统一为**账号**（例如"Claude Max 账号 vm-02"）。槽位 / 虚拟机 / VM 只在账号详情中作为"运行环境"出现，不再作为主导航名词。
- 内核、协议拦截、压测、数据库、system 提示词这类偏底层的页面收进侧栏的**高级**分组；功能全部保留，并用白话写说明。
- 文案优先说明"这是什么、开了会怎样、什么时候需要动它"；API 参数、JSON 字段、文件路径、环境变量不作为主说明出现，确有需要时放在次要位置。
- 专有名词（Claude、Pro、Max、OAuth、Setup Token、SOCKS5、Sub2API 等）保留原文，其余尽量用中文白话；中英文之间加空格。

## Brand Commitments

名称为 vm2api。除此之外，用户没有给出必须保留的视觉或品牌约束。

## Evidence on Hand

- 功能说明：`README.md`、`docs/ACCOUNT_GROUPS.md`、`docs/技术路线.md`、`docs/DEPLOY.md`。
- 现有前端：`web/src`（约 395 个文件）；主题 token 位于 `web/src/styles/theme.css`。
- 集群页的远端节点是写死的假数据（`features/cluster/mock-remotes.ts`），不能当作真实能力展示。

## Product Principles

1. **状态先于操作**：每页先回答"现在正常吗、哪里需要我处理"，再给操作入口。
2. **白话优先，细节可展开**：默认只显示人话说明，实现细节放进可展开的"详细说明 / 高级"区域。
3. **常用的就近，底层的收起**：三件常用事一两步可达；很少碰的底层设置不和常用项混在一起。
4. **一个概念一个名字**：全站术语统一，同一事物不出现多种叫法。
5. **危险操作讲清后果**：重建、删除、清空等操作要写明影响哪些账号或数据、能否恢复。
