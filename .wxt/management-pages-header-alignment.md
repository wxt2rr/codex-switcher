# 管理页面头部对齐

## Goal
- 让插件、模型、服务商页面的标题、描述和搜索/操作工具栏与账号、环境页面保持统一的纵向层级和视觉容器。

## Why Complex
- 同时涉及共享列表页头部组件、三个管理页面和桌面回归测试。

## Scope
- 相关模块/类：`ListPageHeader`、ProvidersPage、ModelsPage、PluginsPage。
- 相关文件：`apps/desktop/src/components/account-list-primitives.tsx`、三个页面文件及其必要测试。
- 兼容要求：保留现有搜索、筛选、刷新、安装和新增操作；Overview/Settings 等使用内联头部的页面不改变布局。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 为共享头部增加堆叠工具栏布局 | account-list-primitives | TypeScript/build | complete | `ListPageHeader` 新增 `layout="stacked"`，保留默认内联布局 |
| 2 | 应用到服务商、模型、插件页面 | providers/models/plugins pages | 页面源码测试、桌面测试 | complete | 三个页面均使用 `layout="stacked"`，搜索、筛选、刷新和新增操作保留 |
| 3 | 检查响应式和现有交互不回归 | desktop test suite | `npm run desktop:test` | complete | Desktop 521 通过、1 跳过；构建通过 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
