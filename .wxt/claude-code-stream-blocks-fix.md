# Claude Code 流式内容块边界修复

## Goal
- 修复 Responses/Chat/Gemini 转 Anthropic 时连续文本被拆成多个内容块，导致 Claude Code 逐字显示为列表。
- 一并核对 thinking、工具调用、媒体和终止事件的内容块边界，避免同类流式渲染异常。

## Why Complex
- 改动涉及 Gateway 流状态机、响应转换、桌面流式代理和多协议回归测试。

## Scope
- 相关模块：`packages/gateway/src/conversion/stream-state.ts`、响应转换测试、桌面 Gateway 流代理。
- 兼容要求：连续同类增量复用同一 Anthropic block；类型切换、显式 item 切换和终止时正确关闭；不改变 Responses/Chat/Gemini 原生输出协议。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 修复 Anthropic 文本/思考 block 复用 | stream state、转换测试 | 连续增量只生成一个 start/stop | done | `npx tsx --test packages/gateway/src/conversion/stream-state.test.ts`：38 通过 |
| 2 | 审核并补齐 block 边界回归覆盖 | stream state tests、桌面模型预览路径 | 工具、媒体、类型切换和终止顺序测试；统一模型预览兼容匹配 | done | 流式回归覆盖 text/thinking/media/tool-result/terminal；`bridge-smoke.test.ts`：38 通过 |
| 3 | 全链路验证 | Gateway、桌面测试、构建 | 定向测试、`npm run desktop:test`、`npm run desktop:build` | done | Core 176 通过；Gateway 243 通过；桌面 624 通过、1 跳过；`desktop:build` 成功；`git diff --check` 成功 |

## Rules
- 同时只能有一个 `in_progress`。
- 不改变非 Anthropic 目标协议的现有事件契约。
- 不以屏蔽内容或缓冲整段响应的方式规避问题，保持流式输出。
