# Claude Code 模型与配置编辑

## Goal
- 在 Claude Code 插件中支持默认模型单选、`/model` 模型白名单多选，并提供 settings.json 查看与修改。
- 保持现有账号来源、代理同步、配置历史和回滚行为兼容。

## Why Complex
- 跨桌面渲染器、Electron bridge、Agent adapter、IPC preload/main 和测试，预计修改超过 150 行并涉及多个职责模块。

## Scope
- 相关模块/类：Claude Code connection panel、DesktopBridge、Electron Claude Code bridge、通用 Agent adapter。
- 相关文件：
  - `apps/desktop/src/components/claude-code-connection-panel.tsx`
  - `apps/desktop/src/bridge.ts`
  - `apps/desktop/src/desktop-model.ts`
  - `apps/desktop/electron/bridge.ts`
  - `apps/desktop/electron/main.ts`
  - `apps/desktop/electron/preload.ts`
  - `packages/gateway/src/agent/contracts.ts`
  - `packages/gateway/src/agent/profiles.ts`
  - `packages/gateway/src/agent/adapter.ts`
- 兼容要求：配置 JSON 写入前备份到现有 Claude Code 历史；敏感值不返回诊断数据，但配置编辑器按现有 Codex 配置编辑逻辑显示原文。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 扩展 Agent binding，使用 `model` 与 `availableModels` | `packages/gateway/src/agent/*` | gateway adapter tests | done | `npm run gateway:test`（244 passed） |
| 2 | 扩展 Claude Code source/connection 数据和持久化 | `apps/desktop/src/desktop-model.ts`, `apps/desktop/electron/claude-code-connection.ts`, `apps/desktop/electron/bridge.ts` | desktop bridge tests | done | `npm run desktop:test`（634 tests，633 passed，1 skipped） |
| 3 | 增加 settings.json 读写 IPC，并接入历史备份 | `apps/desktop/electron/main.ts`, `apps/desktop/electron/preload.ts`, `apps/desktop/src/bridge.ts` | bridge smoke tests | done | desktop test suite passed |
| 4 | 更新插件弹窗的单选、多选和 JSON 编辑交互 | `apps/desktop/src/components/claude-code-connection-panel.tsx` | component source tests, desktop build | done | component tests 5 passed；desktop build passed |
| 5 | 全量测试、构建与 diff 检查 | repository | `npm run desktop:test`, `npm run desktop:build`, `git diff --check` | done | all checks passed |
| 6 | 修复发布包缺少 JSONC/YAML 运行时依赖 | `apps/desktop/package.json`, `package-lock.json`, Electron extraResources | package config test, local dir package, package verify | done | `app.asar` 含 `jsonc-parser`/`yaml`；Gateway resources 含两者；本地包启动无主进程异常 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
