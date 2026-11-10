# default-account-slot-and-stale-gateway-route

## Goal
- 让系统授权只属于保留的 `default` 环境，并在界面统一显示为“默认账号”。
- 清理旧版本留下的 `default/default` 路由，避免首次启动或开启网关时报账号不存在。

## Why Complex
- 涉及核心状态读取、桌面桥接、路由恢复和账号页面多个模块。

## Scope
- 相关模块/类：legacy state、target home、UsageRouterManager、desktop bridge、账号/环境页面。
- 兼容要求：保留旧系统授权文件作为可恢复数据；自动移除已不存在账号的旧路由。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 限制系统槽位只读取/写入 default 环境 | packages/core/src/state/legacy.ts, packages/core/src/system/target-home.ts, apps/desktop/electron/bridge.ts | core tests | done | `legacy.test.ts`, `target-home.test.ts` passed |
| 2 | 清理网关启用前的不存在账号路由 | apps/desktop/electron/usage-router-manager.ts | manager regression test | done | stale-account gateway test passed |
| 3 | 统一 UI 文案并只在 default 展示默认账号 | apps/desktop/src/pages/accounts-page.tsx, environments-page.tsx | desktop tests/build | done | 文案与过滤已更新；desktop build passed |
| 4 | 执行回归验证 | core/desktop checks | npm run check, npm run desktop:test | done | `npm run core:test`, targeted core tests, `npm run desktop:build`, `npm run desktop:test` passed |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
