# Gateway-非流式 Responses 兼容

## Goal
- 让本地 Agent 以 Chat Completions 非流式请求访问 Responses-only 上游时能够稳定返回非流式 Chat Completion。
- 保留上游真实错误，不把错误体包装成空成功响应。
- 不改变已经支持正常非流式 Responses 的服务商，也不破坏现有流式、工具调用和账号池路径。

## Why Complex
- 跨桌面 Gateway 路由、共享协议转换运行时、账号池兼容路径和回归测试多个模块。
- 同时涉及请求重试、SSE 聚合、错误语义和 usage/工具调用兼容。

## Scope
- 相关模块/类：`proxyRequest`、`proxyAccountPoolRequest`、共享 Gateway 转换运行时。
- 相关文件：`apps/desktop/electron/usage-router-service.ts`、`apps/desktop/electron/gateway-conversion-runtime.ts`、`packages/gateway/src/conversion/*`、Gateway 回归测试。
- 兼容要求：仅在客户端非流式且上游明确要求 `stream=true` 时按同一路由重试；真实失败继续透传；正常流式请求保持 SSE。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 建立共享 SSE 聚合到目标协议 JSON 的能力 | `apps/desktop/electron/gateway-conversion-runtime.ts` | `npx tsc -p apps/desktop/tsconfig.electron.json --noEmit` | done | Runtime uses shared `ResponseStreamState.events` and `encodeResponseEvents`; electron typecheck passed. |
| 2 | 修复桌面路由错误转换，并实现非流式 Chat→Responses 的精准回退 | `apps/desktop/electron/usage-router-service.ts` | usage router regression tests | done | Added exact stream-required retry, SSE-to-JSON bridge, and non-OK passthrough; direct Gateway tests pass. |
| 3 | 覆盖账号池/兼容路径的同等行为与错误透传 | `apps/desktop/electron/usage-router-service.ts`, compatibility tests | pool/compat tests | done | Corrected pool compatibility direction, kept legacy Responses surface behavior, and added Chat pool→Responses non-stream bridge test; all 37 usage-router tests pass. |
| 4 | 运行完整相关测试、构建并记录残余风险 | test/build outputs | desktop + gateway tests | done | Gateway package suite 138/138 passed; desktop pool/router suite 47/47 passed; compatibility suite 58 passed/1 intentionally skipped E2E; desktop production build passed. |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
