# 模型路由-服务商失败时重绑定模型

## Goal
- 服务商模型发现为空或失败时，允许用户从现有模型目录选择模型，并按当前账号服务商重新生成绑定。
- 模型选择、测试按钮和保存操作使用同一套投影与网关路由逻辑。
- 服务商发现成功时继续拒绝未发现或已下线的模型。

## Why Complex
- 跨模型目录存储、Electron bridge 的测试预览和账号模型选择行为，需要保持保存/测试一致。

## Scope
- 相关模块/类：model-catalog-store、Electron bridge model preview、账号模型选择面板。
- 相关文件：`apps/desktop/electron/model-catalog-store.ts`、`apps/desktop/electron/bridge.ts`、`apps/desktop/src/components/account-model-exposure-panel.tsx`、相关测试。
- 兼容要求：保留当前服务商发现成功时的严格可用性校验；不覆盖工作区已有未提交改动。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 提取可复用的“允许手动重绑定”判定，放宽失败/空发现时的来源校验 | model-catalog-store | model catalog unit tests | done | `npx tsx --test apps/desktop/electron/model-catalog-store.test.ts`：21 项通过；空 discovery 可将 `openai:*` 重绑定到当前服务商，含历史 unavailable 的成功刷新仍拒绝 |
| 2 | 让测试预览先投影当前服务商绑定，再执行可用性与路由校验 | bridge | bridge/gateway tests | done | 删除 preview 前置的旧 provider-key 校验，复用 `projectAccountBindingsFromCatalog`；59 项定向 desktop 测试通过 |
| 3 | 增加空发现、失败发现和成功发现的回归测试 | model-catalog-store, bridge tests | targeted test command | done | `npm run desktop:test`：486 项通过，1 项按环境跳过；覆盖空发现重绑定、失败发现手动回退、成功刷新后 unavailable 拒绝及保存入口 |
| 4 | 执行类型检查、构建和 git diff 检查 | desktop | build/test | done | Electron/Web `tsc --noEmit` 通过；`npm run desktop:build` 通过（Vite 仅提示既有大 chunk）；`npm run desktop:test` 486 项通过、1 项跳过；`git diff --check` 通过 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
