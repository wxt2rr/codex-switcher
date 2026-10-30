# desktop-hover-menu-stability

## Goal
- 修复共享下拉框和账号页自定义菜单在 hover 时反复展开/收起的问题，保证菜单在触发区、菜单区及两者之间的短暂移动过程中保持稳定。

## Why Complex
- 涉及共享 Radix Select 的 portal 菜单、账号页自定义菜单、hover 协调器和动画指针事件策略。
- 需要同时覆盖行为修复、回归测试和打包运行验证。

## Scope
- 相关模块/类：共享 Select hover 状态、账号页 RowActionSubmenu/CardTargetButton、菜单动画样式。
- 相关文件：`apps/desktop/src/components/form-primitives.tsx`、`apps/desktop/src/components/hover-menu-state.ts`、`apps/desktop/src/components/select-hover-coordinator.ts`、`apps/desktop/src/pages/accounts-page.tsx`、`apps/desktop/src/index.css`及相关测试。
- 兼容要求：点击打开/选择行为保持不变；`openOnHover={false}` 的控件不受影响。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 复核现有 hover 状态机及运行包时间，定位持续抖动来源 | Select、账号页菜单、release 进程 | 源码/进程/构建时间检查 | done | 当前运行的 release 进程早于最新 dir 构建；共享 Select 的 portal 需要几何区域判断 |
| 2 | 统一实现 portal 与自定义菜单的稳定 hover 状态机 | form-primitives、hover-menu-state、accounts-page、CSS | TypeScript/build + 静态回归测试 | done | `npm run desktop:build` 通过；共享 Select 的 hover 静态回归通过；Portal 使用触发区/内容区几何判定、延迟收起和关闭态 pointer-events 防抖 |
| 3 | 重新构建并启动最新 dir 包，验证运行包确实包含修复 | desktop build/package:mac:dir | 进程启动时间、构建产物检查 | done | `npm run desktop:package:mac:dir` 通过；目录包 13:05 启动，当前窗口 URL 为 `apps/desktop/release/mac-arm64/.../app.asar/dist/index.html` |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
- 受当前 Computer Use API 限制，未完成真实鼠标“仅 hover 不点击”的自动化操作；已确认目录包运行的是最新启动实例，点击菜单展开路径正常。
