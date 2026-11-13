# Claude Code 流式协议兼容

## Goal
- 修复 Claude Code 调用 GPT Responses 上游时的 `Stream must be set to true` 错误。
- Claude 端继续收到它请求的非流式 Anthropic JSON 响应，上游需要流式传输时由网关负责转换和聚合。

## Why Complex
- 同时涉及直连路由、凭据池路由、Responses SSE 聚合和 Electron 网关回归测试。

## Scope
- 相关模块：本地网关请求转发与跨协议响应转换。
- 相关文件：
  - `apps/desktop/electron/usage-router-service.ts`
  - `apps/desktop/electron/usage-router-service.test.ts`
- 兼容要求：只在上游明确要求流式传输且客户端未请求流式时重试；已有 Chat Completions 兼容逻辑和正常流式请求不变。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 抽取跨协议非流式请求的流式重试条件 | `usage-router-service.ts` | targeted router test | done | `node --test --import tsx --test-name-pattern='(non-streaming Chat request|local Anthropic Agent requests bridge)' apps/desktop/electron/usage-router-service.test.ts`（3 passed） |
| 2 | 覆盖直连路由与凭据池的 Anthropic → Responses 聚合 | `usage-router-service.ts` | router regression tests | done | 新增 Anthropic 本地 Agent 回归；原有 Chat 直连与凭据池桥接测试均通过 |
| 3 | 运行桌面测试、构建和 diff 检查 | repository | desktop test/build/diff check | done | `npm run desktop:test`（638 passed、1 skipped）；`npm run desktop:build`；`git diff --check` |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
