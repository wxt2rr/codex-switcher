# provider-supply-chain-complete

## Goal

- 完成 Provider 供应链、统一模型目录、订阅账号、四类网关协议、账号池路由、模型绑定、Provider 图标、迁移、测试和未签名跨平台发布。
- 保留手动切换。
- 不实现意图路由。
- 所有阶段均为必做项，不以 MVP 或主链路完成作为最终完成标准。

## Why Complex

- 涉及 `packages/core`、`packages/gateway`、Electron 主进程、React 页面、持久化迁移、图标资产、测试和 GitHub Actions。
- 涉及多个 Provider、四类协议、API Key/OAuth/订阅/插件四种认证路径。
- 需要兼容当前环境、账号、模型、路由和 Codex 模型目录行为。

## Scope

- 相关模块：Provider Registry、Provider Adapter、Model Registry、Model Catalog、Gateway Route Compiler、Account Pool、Desktop Bridge、Provider/Account/Model UI、Provider Icons、Config Migration、Release Workflow。
- 相关文件：`packages/core/src/gateway/**`、`packages/gateway/src/provider/**`、`apps/desktop/electron/**`、`apps/desktop/src/**`、`docs/**`、`.github/workflows/**`。
- 兼容要求：保留手动模式、现有账号和模型绑定、旧 Provider ID、已有网关协议和未签名发布方式。
- 明确排除：意图路由、提示词分类路由、设置页已删除的两个运营面板、外部图标远程加载。

## Task List

| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 固化统一 Provider/Account/Model/Protocol 契约 | `packages/core/src/gateway/**`, `packages/gateway/src/provider/**` | core/gateway 类型与单测 | done | `npm run test --workspace ./packages/gateway`：79 项通过；`npm run gateway:build` 和 `npm run core:build` 通过。Provider 分类、图标元数据、认证 plugin 类型和稳定别名已落地。 |
| 2 | 建立完整 Provider Registry、预设、别名和图标元数据 | `packages/gateway/src/provider/**`, `apps/desktop/src/provider-icons.*` | Provider 清单覆盖测试 | done | Gateway 测试 80 项通过；新增完整 Provider 清单、canonical/legacy ID 归一化、分类、图标元数据、桌面 Provider Catalog IPC 和本地 ProviderIcon。桌面测试 412 项通过，构建通过。 |
| 3 | 完成四类协议 Adapter 和请求/响应能力矩阵 | `packages/gateway/src/protocol/**`, `packages/gateway/src/provider/**`, `packages/core/src/gateway/model.ts` | 协议、流式、工具、推理测试 | done | 四类协议互转、流式响应、工具/推理字段测试通过；新增 Provider 端点、模型协议、凭证协议交集校验，绑定编译会补齐同一 Provider 的多协议端点。核心 161 项、桌面 412 项（411 通过、1 个既有环境依赖跳过），core/gateway 构建通过。 |
| 4 | 完成全部 API/云、本地、自定义 Provider | `packages/gateway/src/provider/**`, `apps/desktop/electron/**` | 每个 Provider mock 发现和请求测试 | done | 已覆盖完整 API/云、本地、自定义清单、别名和本地图标元数据；统一 Adapter 支持发现、配额、签名、错误分类，并会使用环境中实际配置的端点。Gateway 80 项通过；桌面工作区 runtime 测试 413 项（412 通过、1 个既有环境依赖跳过）。 |
| 5 | 完成全部订阅 Provider Adapter | `packages/gateway/src/provider/**`, `apps/desktop/electron/**` | 登录、刷新、模型、账号池测试 | done | 订阅 Provider 使用统一 Adapter 生命周期；新增凭据导入和刷新 IPC，令牌写入现有账号目录并保留 provider_auth_method；模型发现支持订阅令牌、默认模型预置和账号绑定；Gateway 80 项通过，桌面 414 项（413 通过、1 个既有环境依赖跳过）。 |
| 6 | 完成统一模型目录、Codex 目录同步和完整字段补齐 | `apps/desktop/electron/model-catalog*`, `apps/desktop/electron/gateway-model-*` | 目录字段、原子写入和路由可用性测试 | done | `npm run core:test`、`npm run gateway:test`、`env -u CODEX_SWITCHER_DESKTOP_RESOURCES_PATH npm run desktop:test` 全部通过；桌面 415 项中 414 通过、1 项为既有环境依赖跳过。旧/不完整目录会补齐必需字段，网关目录只暴露存在可用凭据、协议交集和可编译路由的模型/路由组。 |
| 7 | 完成模型绑定、账号池、显式路由组和会话保持 | `packages/gateway/src/routing/**`, `apps/desktop/electron/**` | 同模型多账号、跨 Provider 和故障转移测试 | done | 已完成 Provider 上游协议投影、入口/上游协议分离、同模型多账号、显式模型/路由组、会话保持、失败转移，以及 Responses 入口经账号池转换到 Anthropic 上游；`usage-router-service`、`usage-router-manager` 和绑定编译回归通过。 |
| 8 | 完成 Provider、账号、模型页面和图标展示 | `apps/desktop/src/pages/**`, `apps/desktop/src/components/**` | React/页面行为和图标回退测试 | done | Provider 页面已接入完整目录、凭据导入/刷新、环境/入口协议/Base URL/额外请求头；模型绑定继续在模型页面维护；本地 ProviderIcon 和未知 Provider 回退已加入。桌面构建通过，页面/图标行为回归通过。 |
| 9 | 完成旧数据迁移、诊断日志和启动回退 | `apps/desktop/electron/**`, `packages/core/**` | 幂等迁移、根因日志和失败回退测试 | done | v1/v2 网关双写、幂等迁移、失败回滚、旧目录自动补齐和 `switcher.log` 模型目录同步事件均已覆盖；`router-events.jsonl` 记录请求模型、入口/上游协议、路由组、候选/缺失/禁用/环境不匹配/协议不匹配/冷却路由及上游错误。`npm run core:test` 161 项通过，桌面诊断/迁移回归包含在 419 项通过中。 |
| 10 | 完成 Intel/ARM macOS 构建与 GitHub Actions 发布 | `apps/desktop/package.json`, `.github/workflows/**`, `docs/**` | 构建、产物、Release 和版本检查 | done | 桌面版本已递增到 0.1.42，已补发布说明；标签触发的 GitHub Actions 会构建未签名 macOS arm64/x64 并上传 Release。本机实际生成并校验了 `codex-switcher-0.1.42-arm64.dmg`、`codex-switcher-0.1.42.dmg` 及对应 zip，两个 `.app` 均通过 `package:verify`；未执行真实 GitHub 发布。 |

## Rules

- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- 验证不过不得进入下一项。
- 新增任务先补表，再继续实现。
- 不删除用户已有的三个未跟踪 JS 文件，除非用户明确要求。
- 生产文件和日志不写入外部产品名称或外部产品文案。
