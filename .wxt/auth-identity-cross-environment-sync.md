# Auth Identity Cross-Environment Sync

## Goal
- 页面不变，在底层自动识别同一个 AUTH 账号并同步授权凭证。
- 重新授权和 Token 刷新成功后，更新所有确认属于同一真实账号的环境实例。
- 保持每个环境的模型、协议、Base URL、网关和账号池配置独立。

## Why Complex
- 授权文件按环境和账号实例分别存储，重新授权、自动刷新、目标环境投影和网关路由刷新由不同模块负责。
- 必须基于稳定的 ChatGPT account ID 关联账号，不能按显示名称盲目覆盖。
- 同步后还要让激活目标和已启用网关使用最新凭证，同时保持旧环境文件和历史回滚能力。

## Scope
- 相关模块：Electron bridge 授权流程、legacy account state、环境文件历史、Usage Router、回归测试。
- 相关行为：AUTH 账号身份识别、重新授权同步、Token 刷新同步、网关凭证刷新、冲突跳过和安全日志。
- 不在范围：页面布局或新增设置项、API Key 自动同步、注销/删除跨环境传播、模型和路由配置同步。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 增加稳定 AUTH 身份识别与关联规则 | `bridge.ts`, core state helpers | account ID 提取、同名不同身份隔离测试 | done | 复用现有 JWT/account_id 提取逻辑，新增 `deriveAuthIdentityKey` |
| 2 | 接入重新授权后的跨环境凭证同步 | `bridge.ts`, env-file-history | 多环境 AUTH 授权同步测试 | done | 授权写入后按 `provider:account_id` 同步；不同真实账号不覆盖，账号显示名可不同 |
| 3 | 接入 Token 刷新后的跨环境同步与路由刷新 | `bridge.ts`, usage-router-manager | 刷新后激活目标和网关凭证测试 | done | Token 刷新复用同一同步管线；受影响环境刷新网关或本地路由，目标投影失败不阻断源环境成功 |
| 4 | 完成安全边界和回归验证 | bridge/core/router tests | 类型检查、相关测试、桌面构建 | done | 桌面测试 409 通过、1 个已明确跳过的外部 Codex E2E，类型检查和生产构建通过；未修改页面文件 |

## Rules
- 同时只能有一个 `in_progress`。
- 只同步可确认同一 `account_id` 的 AUTH 账号。
- 不同步 API Key，不传播注销和删除操作。
- 不记录 access token、refresh token 或完整授权内容。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
