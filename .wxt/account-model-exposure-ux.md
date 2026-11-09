# account-model-exposure-ux

## Goal
- 让账号模型选择面板默认只展示当前可用模型，清晰隔离手动、历史和过期记录，并修复统一模型标识下的测试 404。

## Why Complex
- 同时调整模型测试请求的 Gateway 暴露标识、账号模型候选分组、发现失败状态提示和组件回归测试，跨 Electron bridge 与 Renderer。

## Scope
- 相关模块/类：`buildModelRequestPreview`、账号模型候选构建、`AccountModelExposurePanel`、`ModelTestButton`。
- 相关文件：`apps/desktop/electron/bridge.ts`、`apps/desktop/src/components/account-model-exposure-utils.ts`、`apps/desktop/src/components/account-model-exposure-panel.tsx`、`apps/desktop/src/components/model-test-button.tsx` 及测试。
- 兼容要求：不删除历史模型和账号绑定；过期模型仍可被用户移除或重新发现；保持现有设计 token 和双语文案。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 修复预览测试使用实际 Gateway 暴露模型标识，并阻止过期模型直接发请求 | bridge/model test | targeted bridge tests | complete | Electron/Web 类型检查通过；预览请求改用 `binding.exposedModelId`，过期模型测试按钮进入禁用态 |
| 2 | 重构账号模型面板的状态分层、计数和过期/手动交互 | exposure panel/utils/test button | component tests + desktop tests | complete | 完成可用/已选择状态分层；过期模型显示“上次可用/服务商已移除”并禁用测试；手动模型显示“未验证”；模型管理页同步禁用过期测试；组件与 Bridge 定向测试 42 passed；Task 4 进一步将账号页候选收窄为当前可用 |
| 3 | 完成类型检查、桌面测试、构建和 diff 检查 | desktop | `npm run desktop:test`, `npm run desktop:build`, `git diff --check` | complete | `npm run desktop:test`（626 passed、1 skipped、0 failed）；`npm run desktop:build` 成功；Web/Electron 类型检查和 `git diff --check` 通过 |
| 4 | 账号绑定面板只展示当前可用模型，隐藏失效绑定并引导到模型管理页 | account model exposure panel | panel tests + desktop tests | complete | Web/Electron 类型检查通过；账号面板仅保留“当前可用/已选择”筛选，失效模型隐藏并提供重新发现与打开模型管理入口；保存时只提交可用选择并保留历史绑定；定向测试 72 passed，完整桌面测试 627 passed / 1 skipped，桌面构建成功 |

## Rules
- 同时只能有一个 `in_progress`。
- 保留历史数据，不把“移除绑定”实现成删除全局模型。
- stale/unavailable 模型不发送测试请求，避免把可预期状态错误显示为 404。
- 每完成一项立即回写验证证据。
