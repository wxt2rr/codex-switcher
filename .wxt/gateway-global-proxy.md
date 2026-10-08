# gateway-global-proxy

## Goal
- 让 Gateway 上游请求自动复用项目当前解析出的本机代理。
- 保留账号/凭证/Provider 专属代理优先级。
- 本地 Gateway 和本地上游地址直连，代理变化可以即时作用于已运行路由。
- 提升上游连接失败的安全诊断信息，不泄露 Token 或 API Key。

## Why Complex
- 跨 Electron bridge、UsageRouterManager、独立 Usage Router 服务、代理传输和测试模块。
- 需要同时覆盖普通路由、账号池、环境 Gateway、AUTH 和 API Key 请求。

## Scope
- 相关模块/类：代理解析、UsageRouterManager、usage-router-service、Electron bridge、代理与路由测试。
- 相关文件：`apps/desktop/electron/upstream-proxy.ts`、`apps/desktop/electron/usage-router-manager.ts`、`apps/desktop/electron/usage-router-service.ts`、`apps/desktop/electron/bridge.ts` 及对应测试。
- 兼容要求：不把自动检测代理持久化为路由专属代理；显式代理配置继续优先；现有本地路由 URL 不走代理。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 建立统一代理决策与代理传输行为 | `upstream-proxy.ts`、代理测试 | 单元测试、类型检查 | done | `upstream-proxy.test.ts` 与平台代理测试 5/5 通过；支持显式/全局/直连优先级、本地与 `NO_PROXY` 绕过、HTTP/HTTPS/SOCKS5 |
| 2 | 将全局代理注入独立 Router 服务并支持即时刷新 | `usage-router-manager.ts`、`usage-router-service.ts` | Router 管理器/服务测试 | done | API 版本升级到 10；通过受保护管理接口动态同步全局代理；服务不持久化自动检测值 |
| 3 | 将自动检测代理接入所有 Gateway/路由生命周期 | `bridge.ts`、相关测试 | Desktop 测试 | done | Router 创建/复用时同步；手动代理设置与清除后即时刷新运行中的 Router |
| 4 | 完善错误诊断和代理能力兼容性 | Router 服务、代理模块 | 回归测试、错误脱敏检查 | done | 错误记录标明显式/全局/直连来源；账号池成员持久化代理；HTTP/HTTPS/SOCKS5 与显式优先级回归通过 |
| 5 | 完整验证并整理交付状态 | 全部相关模块 | `npm run desktop:test`、`npm run desktop:build`、`git diff --check` | done | Desktop 400 项测试通过（399 通过、1 条受环境变量控制的 E2E 跳过）；core 157 项、gateway 79 项通过；build 与 diff 检查通过 |

## Rules
- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- 新增任务先补表，再继续实现。
