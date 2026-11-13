# Claude Code 配置入口与漂移状态

## Goal
- 将 Claude Code 的配置 JSON、配置历史入口与配置文件路径放在同一块。
- 插件自身保存配置后同步受管快照，不再误报“配置已被外部修改”。

## Why Complex
- 同时涉及 Electron bridge 写入流程、通用 Agent 快照、Claude Code 插件弹窗和测试。

## Scope
- 相关模块/类：Claude Code bridge、Agent adapter、Claude Code connection panel。
- 相关文件：
  - `apps/desktop/electron/bridge.ts`
  - `packages/gateway/src/agent/adapter.ts`
  - `apps/desktop/src/components/claude-code-connection-panel.tsx`
  - 对应测试文件
- 兼容要求：保留原始配置用于取消绑定恢复；外部修改仍通过内容哈希检测；历史备份行为不变。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 增加受管快照的显式同步能力，修复插件 JSON 保存后的误报 | `packages/gateway/src/agent/adapter.ts`, `apps/desktop/electron/bridge.ts` | adapter/desktop bridge tests | done | `node --test --import tsx packages/gateway/src/agent/adapter.test.ts`（12 项通过） |
| 2 | 将配置 JSON、配置历史移动到配置路径卡片 | `apps/desktop/src/components/claude-code-connection-panel.tsx` | component source test, desktop build | done | `claude-code-connection-panel.test.ts` 5 项通过；`npm run desktop:build` 通过 |
| 3 | 补充回归测试并运行相关测试 | tests | `npm run gateway:test`, desktop tests | done | Gateway adapter 12 项通过；Desktop 635 项（634 通过，1 跳过） |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
