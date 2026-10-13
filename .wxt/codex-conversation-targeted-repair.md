# Codex 会话定点修复

## Goal
- 保留现有环境级“同步对话列表”逻辑不变，新增按 Codex 对话 ID 分析并只修复指定会话的能力。
- 从所有已配置环境定位会话，比较历史 provider/model 与当前环境配置，确认后生成备份并定点修改。

## Why Complex
- 涉及 Electron 主进程、IPC/preload、React 环境页和 Codex JSONL/SQLite 存储四个模块。
- 需要同时提供诊断、候选环境选择、备份、定点修复和多语言交互。

## Scope
- 相关模块/类：Codex 会话扫描与修复、Electron bridge/preload、环境管理页。
- 相关文件：
  - `apps/desktop/electron/codex-conversation-repair.ts`
  - `apps/desktop/electron/bridge.ts`
  - `apps/desktop/electron/main.ts`
  - `apps/desktop/electron/preload.ts`
  - `apps/desktop/src/bridge.ts`
  - `apps/desktop/src/react-app.tsx`
  - `apps/desktop/src/pages/environments-page.tsx`
- 兼容要求：不修改 `syncEnvironmentConversationHistory` 和现有全量同步行为；修复前 Codex 必须停止；不修改消息正文。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 新增跨环境会话扫描、诊断和定点备份修复模块 | `apps/desktop/electron/codex-conversation-repair.ts` | 静态检查与类型边界 | complete | 已完成跨环境定位、provider/model 对比、备份、原子写入、定点 JSONL/SQLite 修复；保留同路径环境候选，并修正 config.toml 顶层解析。 |
| 2 | 接通 Electron bridge、IPC 和 preload 类型 | `bridge.ts`, `main.ts`, `preload.ts`, `src/bridge.ts` | 接口调用链检查 | complete | 已接通主进程函数、IPC handler、preload 暴露和浏览器预览 fallback。 |
| 3 | 在环境页新增全局入口、环境预选入口和诊断/确认弹框 | `environments-page.tsx`, `react-app.tsx` | UI 状态与文案检查 | complete | 已加入顶部入口、环境卡片入口、分析、同 ID 多环境选择、provider/model 对比、确认修复、备份路径和错误结果展示；桌面构建通过。 |
| 4 | 完成代码审查与交付说明 | 全部改动 | `git diff`、工作区检查 | complete | `npm run build --workspace ./apps/desktop` 通过；`git diff --check` 通过；全量同步入口 `syncEnvironmentConversationHistory` 未改动。 |

## Rules
- 同时只能有一个 `in_progress`。
- 全量同步逻辑不改、不复用其全量写入入口。
- 默认只读分析；只有用户确认后才写入。
- 多环境同 ID 时必须要求用户选择，不能自动猜测。
- 只修改目标会话元数据，保留消息内容，并备份 JSONL、SQLite 及 WAL/SHM。
