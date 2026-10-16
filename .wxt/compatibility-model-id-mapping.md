# 兼容路由-模型标识映射

## Goal
- 让非网关兼容路由把 Codex 的 provider:model 展示标识转换为服务商要求的 upstream model id。
- 兼容旧路由缺少 providerId/upstreamModel 的数据，避免模型切换后再次出现 404 Model not exist。

## Why Complex
- 跨兼容请求转换、路由持久化和启动恢复三个职责模块，需要保持现有单模型配置兼容。

## Scope
- 相关模块/类：兼容请求处理、UsageRouterManager、账号兼容路由恢复。
- 相关文件：`apps/desktop/electron/openai-chat-compat/compatibility-handler.ts`、`apps/desktop/electron/openai-chat-compat/compatibility-handler.test.ts`、`apps/desktop/electron/usage-router-manager.ts`、`apps/desktop/electron/bridge.ts`。
- 兼容要求：显式 `upstreamModel` 继续作为无 provider 前缀请求的回退；带 provider 前缀的模型优先转换为前缀后的上游模型名。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 增加通用 provider:model 到 upstream model 映射，并让兼容路由持久化 providerId | compatibility-handler, usage-router-manager, bridge | 单元测试 + 类型检查 | done | 兼容请求按 provider 前缀转换；路由持久化 providerId；启动恢复对空 upstreamModel 使用持久化路由值 |
| 2 | 验证兼容请求转换、旧路由恢复与现有测试 | compatibility tests, manager tests | 相关 `tsx --test`、`git diff --check` | done | compatibility-handler 4/4、usage-router-manager 17/17、electron tsc、git diff --check 全部通过 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
