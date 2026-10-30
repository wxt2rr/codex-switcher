# Gateway-跳过无凭据账号

## Goal
- 防止默认环境的保留账号 `default/default` 在没有真实登录凭据时被编译为可用的 Codex 内置模型路由。
- 防止运行时在路由凭据缺失时把入口 Authorization（例如其它服务商的 API Key）转发给上游。

## Why Complex
- 同时涉及网关模型编译、运行时路由转发和回归测试三个职责模块。

## Scope
- 相关模块/类：Codex 内置模型路由编译、Responses 路由代理、账号池路由代理。
- 相关文件：`apps/desktop/electron/gateway-model-bindings.ts`、`apps/desktop/electron/usage-router-service.ts` 及对应测试。
- 兼容要求：保留 `default/default` 作为系统兜底账号；有真实凭据的 Plus/Codex 账号和显式 `none` 插件账号行为不变。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 仅为有真实 AUTH 凭据的账号编译 Codex 内置模型路由 | `gateway-model-bindings.ts` | gateway-model-bindings tests | done | 11/11 tests passed; missing-token AUTH account is excluded |
| 2 | 运行时拒绝缺失路由凭据，禁止透传入口 Authorization | `usage-router-service.ts` | usage-router-service tests | done | 39/39 tests passed; missing ChatGPT credential returns 503 without upstream call |
| 3 | 本机 Agent 的 OpenAI-compatible 请求统一关闭上游存储 | `usage-router-service.ts`, `usage-router-service.test.ts` | local Agent Responses/Chat tests | done | Responses and Chat Completions ingress both arrive upstream with `store=false` |
| 4 | 补齐 default/default 与可用 Plus 路由回归覆盖并完成构建 | test files | targeted tests, desktop build, diff check | done | 11/11 binding tests, 40/40 router tests, desktop build and diff check passed |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
