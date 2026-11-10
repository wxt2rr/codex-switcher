# environment-direct-mode-bypasses-router

## Goal
- 让环境只有“直连模式”和“网关模式”两个用户可见模式。
- 直连模式直接使用账号原始 Auth/Base URL/API Key，不启动或依赖内部 routes。
- 网关模式继续使用 Gateway 入口，routes 仅作为网关内部下游实现。

## Why Complex
- 涉及环境页面状态、Electron 桥接同步、Router/Gateway 生命周期和历史状态恢复。
- 需要兼容旧版本留下的本地 route 配置，并验证启动、切换和网关重建路径。

## Scope
- 相关模块/类：环境页面、desktop bridge、UsageRouterManager、target-home 状态投影。
- 相关文件：`apps/desktop/src/pages/environments-page.tsx`、`apps/desktop/electron/bridge.ts`、`apps/desktop/electron/usage-router-manager.ts` 及测试。
- 兼容要求：已有网关继续可用；旧的非网关 response routes 在恢复时还原为账号原始配置并清理。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 梳理并隔离直连/网关生命周期 | bridge, manager | 单测 | done | 已确认 `enableEnvironment` 当前会把账号改写到 `/routes`，并将网关入口改为 `/gateways` |
| 2 | 直连模式清理旧 routes 并恢复原始账号配置 | bridge, manager | 路由恢复测试 | done | `loadOverview` 会恢复原始 Base URL、同步当前目标配置、清理 response routes；网关和账号池路径保持不变 |
| 3 | 调整页面状态文案，隐藏内部 routes 语义 | environments page | 页面测试/构建 | done | 非网关且无账号池时显示“直连模式”，账号池单独显示“账号池运行中” |
| 4 | 全量验证并更新 dist | core/desktop | desktop test/build/check | done | `desktop:build`、`desktop:test`（629，628 pass/1 skip）、`npm run check`、定向回归测试、`git diff --check` 全部通过 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
