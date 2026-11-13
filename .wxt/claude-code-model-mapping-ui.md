# Claude Code 官方模型映射表

## Goal
- 将 Claude Code 插件的默认模型和模型列表改为“Claude 官方模型 → Switcher 实际模型”的映射配置。
- 写入 `model`、`availableModels` 和 `modelOverrides`，让 `/model` 展示官方模型、请求落到对应 Switcher 模型。

## Why Complex
- 涉及 Claude Code 数据契约、Electron bridge 配置写入、来源模型候选、连接记录持久化、插件弹窗交互和回归测试。

## Scope
- 相关模块/类：Claude Code connection model、Electron bridge、Claude Code connection panel、Agent adapter。
- 相关文件：
  - `apps/desktop/electron/claude-code-connection.ts`
  - `apps/desktop/electron/bridge.ts`
  - `apps/desktop/src/desktop-model.ts`
  - `apps/desktop/src/components/claude-code-connection-panel.tsx`
  - `packages/gateway/src/agent/*`
  - 对应测试文件
- 兼容要求：兼容旧版 raw model 配置；旧配置不再作为官方模型展示，需安全迁移到映射表；保持历史备份和回滚。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 锁定官方模型与 Switcher 模型的独立数据契约 | connection/model types | typecheck/tests | complete | `npm run desktop:build`、`npm run gateway:test` |
| 2 | 读取、持久化并应用 `modelOverrides` 映射 | Electron bridge、Agent adapter | bridge/gateway tests | complete | Agent adapter 写入/恢复映射测试通过；desktop build 通过 |
| 3 | 将插件弹窗改成默认模型 + 映射表 | connection panel | component test、desktop build | complete | 面板测试 5/5；desktop build 通过 |
| 4 | 兼容旧 raw model 配置并补充回归验证 | bridge/tests | desktop/gateway tests | complete | 旧 raw ID 自动迁移到官方模型映射；desktop 635（634 通过、1 跳过）、gateway 245/245 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
