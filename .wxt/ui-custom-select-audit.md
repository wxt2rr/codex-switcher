# UI-统一自定义下拉控件

## Goal
- 清理桌面端页面中残留的原生 `<select>`，统一使用项目现有的 Radix 风格下拉组件，避免浏览器原生菜单和蓝色焦点边框破坏视觉一致性。

## Why Complex
- 涉及模型页、账号模型暴露面板及对应测试，需同时检查全局残留并验证构建。

## Scope
- 相关模块/类：模型页面、账号模型暴露面板、共享表单 Select 使用方式。
- 相关文件：`apps/desktop/src/pages/models-page.tsx`、`apps/desktop/src/components/account-model-exposure-panel.tsx` 及对应测试。
- 兼容要求：保留现有筛选状态、国际化文案、键盘/点击选择和空选项行为；不改变其它业务逻辑。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 将模型页和账号模型暴露面板的原生下拉替换为共享 Select | 两个页面组件、form-primitives | 定向源码测试、TypeScript | complete | 两处筛选器均改为共享 `Select`，并关闭 hover 自动展开，保留现有筛选状态和文案 |
| 2 | 补充禁止原生下拉回归的测试断言 | 两个对应测试文件 | `tsx --test` | complete | `npx tsc` web/electron 通过；3 个定向测试全部通过 |
| 3 | 执行全局残留审计、构建和差异检查 | 桌面端 | `rg`、build、diff check | complete | 全仓桌面源码无原生 `<select>`；`git diff --check` 通过；`npm run desktop:build` 成功 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
