# desktop-ui-systematic-optimization

## Goal
- 将桌面端所有管理页面和浮层交互统一为可复用、可访问、可响应的生产级 UI 系统，完整落地既定的 stageshow 优化方案，不裁剪为 MVP。

## Why Complex
- 涉及设计 Token、全局 CSS、共享表单/浮层组件、桌面壳层以及账号、服务商、模型、插件、环境、用量、操作/设置等多个页面。
- 预计跨越 4 个以上模块并修改超过 150 行代码，需要按切片验证。

## Scope
- 相关模块/类：design tokens、全局样式、页面标题/工具栏、surface/card/button/status、Popover/Select、账号和各管理页、动效与状态、响应式/可访问性。
- 相关文件：`packages/design-tokens/theme.css`、`apps/desktop/src/index.css`、`apps/desktop/src/components/**`、`apps/desktop/src/pages/**`。
- 兼容要求：保留现有业务行为、路由和数据契约；不改变账号/网关/模型功能语义；支持中英文、浅色/深色、macOS/Windows 缩放。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 统一语义 Design Token、focus 状态、控件基础尺寸与动效变量 | `theme.css`, `index.css`, `ui/*` | CSS 检查、组件测试、桌面构建 | done | `npm run desktop:build` 通过；新增 surface/control/overlay/focus/motion/z-index 语义变量，默认主题色统一为绿色，中性键盘焦点恢复 |
| 2 | 抽取统一页面标题/工具栏、surface/card/status 结构并迁移管理页 | `components/dashboard-kit.tsx`, `components/account-list-primitives.tsx`, `components/admin-primitives.tsx`, `pages/**` | 页面测试、构建、截图审查 | in_progress | 共享 Card/Header/Dialog 基础已迁移，下一步统一页面头部与工具栏 |
| 3 | 统一 Popover/Select/hover intent、Portal、z-index 和退出动画 | `form-primitives.tsx`, `hover-menu-*`, `select-*`, `use-delayed-unmount.ts` | hover/select 测试、键盘与 viewport 手验 | todo | — |
| 4 | 完整优化账号页信息层级与重置卡/模型测试/操作菜单 | `accounts-page.tsx`, account primitives | 账号组件测试、交互手验 | todo | — |
| 5 | 完整迁移服务商、模型、插件、环境、用量、操作/设置页 | `providers-page.tsx`, `models-page.tsx`, `plugins-page.tsx`, `environments-page.tsx`, `usage-page.tsx`, `operations-page.tsx`, `skills-page.tsx` | 各页面测试、构建、响应式审查 | todo | — |
| 6 | 统一 loading/empty/error/progress、响应式和 reduced-motion | `dashboard-kit.tsx`, pages, `index.css` | 状态矩阵、125%/150% 缩放检查 | todo | — |
| 7 | 回归验证、记录证据并交付 | 全部桌面 UI | `npm run desktop:test`, `npm run desktop:build`, 视觉/键盘手验 | todo | — |

## Rules
- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- 新增任务先补表，再继续实现。
- 不改变业务数据和网关行为；视觉重构必须保持现有测试契约。
