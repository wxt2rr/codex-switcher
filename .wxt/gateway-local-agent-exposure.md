# gateway-local-agent-exposure

## Goal
- 在环境卡片中增加“允许本机 Agent 接入”开关，并为开启网关的环境提供可复制的本地 Base URL、Models URL、支持协议和访问 Key。
- 保持网关只监听 `127.0.0.1`，不开放局域网/公网；关闭开关时不改变 Codex App 当前网关行为。

## Why Complex
- 涉及桌面环境页、Electron bridge、网关运行时鉴权、模型目录接口、运行时持久化和跨模块测试。

## Scope
- 相关模块/类：Environment gateway runtime、UsageRouterService/Manager、desktop bridge、EnvironmentsPage。
- 相关文件：`apps/desktop/electron/usage-router-service.ts`、`apps/desktop/electron/usage-router-manager.ts`、`apps/desktop/electron/bridge.ts`、`apps/desktop/src/bridge.ts`、`apps/desktop/src/pages/environments-page.tsx`、对应测试。
- 兼容要求：现有 Codex gateway URL 和已有内部路由不变；Admin API 继续使用独立 admin token；所有监听仍为 loopback。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 锁定本机 Agent 接入契约、持久化字段和 API 路径 | Gateway model/service | Unit tests | complete | Existing gateway uses one loopback port and per-environment path; external surface will use `/v1/*` aliases on the same loopback port |
| 2 | 增加本机 Agent access token、Models endpoint 和协议别名 | usage-router-service/manager/store | Gateway tests | complete | `/v1/models`、`/v1/responses` 鉴权和别名测试通过；旧 `/responses` 兼容测试通过；本机 Key 不会转发到无认证上游 |
| 3 | 连接 bridge 与环境状态，支持开关读写和运行时同步 | bridge/preload/bridge types | Desktop bridge tests | complete | Electron IPC、token 持久化和 manager toggle 测试已补齐 |
| 4 | 在环境卡片增加紧凑的接入开关与 endpoint details | environments page/copy | Desktop tests/build | complete | 环境卡片提供本机 Agent 开关、Base URL/Models/API Key 复制和协议提示，desktop build 通过 |
| 5 | 完成回归验证并整理交付 | repo | desktop tests/package workflow | complete | `npm run desktop:test` 529 tests / 528 pass / 1 skipped / 0 fail；`npm run desktop:build` 通过 |

## Rules
- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- 仅允许本机访问；不得把 listener 改成 `0.0.0.0`。
