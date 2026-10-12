# model-testing-buttons

## Goal
- 在模型页模型卡片和账号页模型选择面板提供独立的模型连通性测试。
- 使用当前账号/服务商发送默认提示词“你是什么模型”，显示成功或失败结果，不改变勾选和保存流程。

## Why Complex
- 同时涉及模型页、账号页、Renderer bridge、Electron IPC 和 Usage Router 五个职责区域。

## Scope
- 相关模块/类：模型目录 UI、账号模型暴露 UI、Desktop bridge、UsageRouterManager。
- 相关文件：`apps/desktop/src/pages/models-page.tsx`、`apps/desktop/src/components/account-model-exposure-panel.tsx`、`apps/desktop/src/components/model-test-button.tsx`、`apps/desktop/src/bridge.ts`、`apps/desktop/electron/{preload,main,bridge,usage-router-manager}.ts`。
- 兼容要求：网关开启时优先通过环境网关并约束当前账号；未开启网关时直连账号路由，并支持 Responses、Chat Completions、Anthropic、Gemini 路径。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 新增模型测试请求后端能力 | UsageRouterManager、Electron bridge、IPC | Electron/Web TypeScript 编译 | done | `npx tsc -p apps/desktop/tsconfig.web.json --noEmit` 与 `npx tsc -p apps/desktop/tsconfig.electron.json --noEmit` 通过 |
| 2 | 增加可复用测试按钮并接入账号页 | account model exposure panel | Desktop build | done | 账号列表按钮独立于 checkbox，测试事件阻止默认勾选行为 |
| 3 | 接入模型页并完成生产构建 | models page | `npm run desktop:build`、`git diff --check` | done | Vite production build 成功，diff 检查通过 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
