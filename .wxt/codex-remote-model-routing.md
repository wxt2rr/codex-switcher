# codex-remote-model-routing

## Goal
- 让 Codex App 的官方登录只负责手机远程控制，同时允许当前环境选择 Plus、API Key 直连或 Switcher 网关作为模型服务。
- API Key / 网关切换不再覆盖环境中的官方 `auth.json`；远程状态只显示 Switcher 能确认的阶段，不伪称已完成官方配对。

## Why Complex
- 跨 core 状态与 legacy 元数据、目标环境投影、Electron IPC、React 环境/账号交互四个模块，预计超过 150 行改动。

## Scope
- 相关模块/类：环境状态、legacy env metadata、target-home projection、Electron bridge/preload、desktop model、environments/accounts UI。
- 相关文件：`packages/core/src/state/*`、`packages/core/src/system/target-home.ts`、`apps/desktop/electron/*`、`apps/desktop/src/*`。
- 兼容要求：旧环境没有远程字段时保持原行为；只有显式选择官方账号作为远程身份后才保留该身份。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 增加环境远程身份状态与 legacy 持久化 | core state/legacy/env service | core tests | done | `npm run core:build && npm run core:test`（178 pass） |
| 2 | 目标环境投影保留官方 auth，API Key 只作为模型配置 | target-home, bridge switch flow | target-home tests | done | `npm run core:build && npm run core:test`（含远程+API Key 场景，178 pass） |
| 3 | 增加远程状态/选择 IPC 和 desktop bridge 类型 | electron bridge/preload/main, desktop-model | bridge type/build tests | done | `npm run desktop:build`（类型、Electron IPC、Vite 构建通过） |
| 4 | 环境卡片展示远程状态与模型服务，增加连接/切换面板 | environments page, react app | desktop UI tests/build | done | 环境卡片/SidePanel 已接入；`npm run desktop:test`（627 pass，1 skip） |
| 5 | 按官方规范区分远程配对状态与已配置账号 | Electron bridge, desktop model, environments page | typecheck/build | done | 官方文档只把 `codex remote-control` / pairing 定义为独立能力；UI 将“已配置官方账号”和“待完成配对”分开显示，Switcher 不伪称已连接 |
| 6 | 路由切换保留 auth，显式登录才更新 auth | target-home, bridge login/switch flows | core/desktop build | done | API Key 通过 `OPENAI_API_KEY` provider env 或环境网关路由注入；API Key 登录、切换与网关不会覆盖环境选定的远程 `auth.json`；直连模式禁止两个 AUTH 身份共用一个 home |
| 7 | 回归验证并回写本任务证据 | core/desktop | build and focused checks | done | `npm run core:build && npm run core:test`（180 pass）；`npm run desktop:build` 通过；`npm run desktop:test`（627 pass，1 skip） |

## Rules
- 同时只能有一个 `in_progress`。
- 远程身份与模型账号保持独立；不得把 API Key 写入官方 `auth.json`。
- 旧数据不自动猜测远程身份；首次使用通过 UI 选择官方账号。
