# 模型目录刷新循环修复

## Goal
- 启动和后台模型发现不再通过重复写入配置文件触发 Codex App 自重启。
- 模型配置变更继续同步网关运行态，但 App 配置投影只在用户确认刷新时执行。

## Why Complex
- 同时涉及 core 原子文件写入、Electron 网关恢复/模型目录同步、桌面启动链路三个职责区域。

## Scope
- 相关模块/类：`packages/core` 目标 home 写入、`apps/desktop/electron` 网关恢复与模型目录同步。
- 相关文件：`packages/core/src/system/atomic-file.ts`、`packages/core/src/system/target-home.ts`、`apps/desktop/electron/account-model-catalog.ts`、`apps/desktop/electron/bridge.ts`及对应测试。
- 兼容要求：已有配置内容不变时保持文件 mtime/监听状态不变；显式确认刷新仍完整重建路由、同步目录并重启 App。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 让核心原子写入在内容未变化时跳过 rename | `packages/core/src/system/atomic-file.ts` | core tests + diff check | done | `npm run core:test -- --test-name-pattern='atomic file'`：171 项通过；新增 mtime 不变回归测试 |
| 2 | 让模型目录/网关恢复在等待确认时不触碰当前 App home | `apps/desktop/electron/bridge.ts`, `account-model-catalog.ts` | desktop build + targeted smoke tests | done | 网关运行态仍重建；`updateTargetHome=false` 时跳过目标 home 和目录投影；模型目录写入也改为幂等 |
| 3 | 覆盖重复同步不触发写入、显式刷新仍重启的回归行为 | core/electron tests | targeted tests | done | `npm run desktop:build` 通过；Electron/目录 smoke 48 项通过；之前完整安全 targeted 55 项、Core 171 项通过；未运行会触碰真实 App 生命周期的集成测试 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
