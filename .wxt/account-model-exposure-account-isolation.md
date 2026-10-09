# account-model-exposure-account-isolation

## Goal
- 修复账号模型选择面板把其他账号发现的模型混入当前账号候选列表的问题。
- 当前账号只展示自己的发现模型和真正的手动模型；已存在的历史绑定仍可见并可解除。

## Why Complex
- 本次改动涉及 React 面板、模型候选归类逻辑和行为测试三个职责点。

## Scope
- 相关模块/类：账号模型暴露面板、账号模型候选集合构建。
- 相关文件：
  - `apps/desktop/src/components/account-model-exposure-panel.tsx`
  - `apps/desktop/src/components/account-model-exposure-utils.ts`
  - `apps/desktop/src/components/account-model-exposure-panel.test.ts`
- 兼容要求：保留已经绑定的历史模型，使用户仍能取消错误绑定；不修改模型目录和账号发现数据。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 收紧候选集合，只将当前账号发现模型、无 provider key 的手动模型和已绑定历史模型加入列表 | 面板/候选工具 | 候选集合行为测试 | done | `account-model-exposure-panel.test.ts` 通过；其他账号带 provider key 的记录不再进入未选候选 |
| 2 | 修正当前账号发现模型的服务商归类优先级 | 面板/候选工具 | 类型检查、面板测试 | done | 当前发现快照优先于模型记录旧的 `provider_id`；Web TypeScript 检查通过 |
| 3 | 运行桌面测试并回写结果 | 测试套件 | `npm run desktop:test` | done | 桌面测试 438 项：437 通过、1 跳过（需显式开启 Codex E2E）、0 失败 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
