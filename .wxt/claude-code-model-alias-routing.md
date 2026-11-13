# Claude Code 模型别名路由

## Goal
- 让 Claude Code 的官方模型别名能通过本地网关的 `/v1/models` 校验，并在请求进入路由时映射到连接配置中的真实 Switcher 模型。
- 兼容 `claude-haiku-4-5-20251001` 这类带日期后缀的 Claude 模型 ID。

## Why Complex
- 改动跨 Claude Code 连接配置、Electron 本地网关请求处理和网关集成测试，涉及两个独立职责区域。

## Scope
- 相关模块：Claude Code 模型别名解析、本地网关模型列表与请求路由。
- 相关文件：
  - `apps/desktop/electron/claude-code-connection.ts`
  - `apps/desktop/electron/usage-router-service.ts`
  - `apps/desktop/electron/usage-router-service.test.ts`
- 兼容要求：不改变普通 OpenAI/Responses/Chat Completions 模型路由；不输出 API key 等敏感信息。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 增加 Claude 别名及日期后缀的纯解析逻辑 | `claude-code-connection.ts` | Claude connection tests | done | `node --test --import tsx apps/desktop/electron/claude-code-connection.test.ts`（11 passed） |
| 2 | 接入本地网关 `/models` 和请求路由 | `usage-router-service.ts` | usage router regression tests | done | `node --test --import tsx --test-name-pattern='local (Agent|Anthropic)' apps/desktop/electron/usage-router-service.test.ts`（4 passed） |
| 3 | 补齐回归测试并运行全量验证 | `usage-router-service.test.ts`, repository | desktop test/build/diff check | done | `npm run desktop:test`（637 passed、1 skipped）；`npm run desktop:build`；`git diff --check` |
| 4 | 兼容生产环境 router stateDir 与连接记录分层目录 | `usage-router-service.ts`, `usage-router-service.test.ts` | 定向回归测试、desktop test/build | done | 父目录回退已实现；定向测试通过；`npm run desktop:test`（638 passed、1 skipped）；`npm run desktop:build`；`git diff --check` |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
