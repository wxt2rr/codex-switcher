# desktop-uiux-full-system

## Goal
- 完成 codex-switcher 桌面端全量 UI/UX 统一改造，让设计令牌、公共组件、页面骨架、导航、弹框、反馈、暗色模式、动效和所有业务页面遵循同一套高质量视觉与交互规范。
- 保留现有业务能力与数据流程，不做 MVP 裁剪；优先复用现有组件并逐页迁移。

## Why Complex
- 跨 `apps/desktop/src/index.css`、`packages/design-tokens/theme.css`、公共组件、桌面壳层和全部业务页面。
- 预计涉及超过 4 个模块、超过 150 行代码，并同时覆盖样式、交互、可访问性和暗色模式。

## Scope
- 设计令牌：颜色、surface、边框、圆角、阴影、间距、排版、动效、状态语义。
- 公共组件：Button、Badge、Card、DataTable、PageHeader、PageToolbar、ListCard、SidePanel、Dialog、Toast/Notice、Empty/Loading/Error。
- 壳层：侧边栏分组、激活态、品牌区、窗口内容布局、暗色模式。
- 页面：overview、accounts、environments、providers、models、plugins、skills、usage、usage-request-details、operations、gateway-admin-editor。
- 交互：sticky footer、Escape、焦点管理、遮罩行为、统一按钮层级、响应式工具栏、减少动效支持。
- 兼容要求：不改变业务 API、路由、持久化格式和已有对话修复逻辑；现有中英文文案继续可用。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 建立并落地语义化 design tokens，清理重复基础样式 | `packages/design-tokens/theme.css`, `apps/desktop/src/index.css` | `npm run build --workspace ./apps/desktop`; diff check | done | `npm run build --workspace ./apps/desktop` 通过；语义 surface、边框、状态色、阴影和动效变量已映射 |
| 2 | 统一 Button、Input、Badge、Card、DataTable、公共页面骨架 | `apps/desktop/src/components/ui/*`, `admin-primitives.tsx`, `account-list-primitives.tsx` | desktop build + existing tests | done | `npm run build --workspace ./apps/desktop` 与 `npm run test:desktop --workspace ./apps/desktop` 通过；页面/组件完成语义 surface、按钮、输入、选择器和表格迁移 |
| 3 | 完善 SidePanel/Dialog/Confirm/Progress/Notice 交互和 sticky footer | `admin-primitives.tsx`, feedback components | targeted tests + build | done | `npm run build --workspace ./apps/desktop` 通过；SidePanel 支持 Escape/遮罩/焦点/dialog 语义，编辑面板与长表单已迁移 sticky 操作区 |
| 4 | 重做桌面壳层与侧边栏层级、激活态、暗色适配 | `desktop-shell.tsx`, shell styles | build + manual route smoke | done | `npm run build --workspace ./apps/desktop` 通过；侧边栏分组分隔、激活 accent、语义背景、通知和更新浮层已统一 |
| 5 | 迁移 overview/accounts/environments/providers/models 页面 | corresponding page files | build + desktop tests | done | 所有目标页已迁移语义背景/文字/边框、统一圆角和公共列表骨架；模型/账号编辑面板操作区已固定 |
| 6 | 迁移 plugins/skills/usage/usage-details/operations/gateway editor 页面 | corresponding page files | build + desktop tests | done | `npm run test:desktop --workspace ./apps/desktop` 通过；目标页已统一 frame、surface、控件和表格视觉 |
| 7 | 统一状态色、空/加载/错误/反馈、响应式布局和动效约定 | shared components + all pages | build + grep audit + manual smoke | done | InlineNotice、语义状态色、空/加载状态、错误反馈、响应式滚动、sticky 操作区和 reduced-motion 已完成；残余硬编码仅保留明确的业务状态/代码块表现；全量测试通过 |
| 8 | 全量回归、修复视觉/类型问题并提交交付 | all touched files | `npm run test:desktop --workspace ./apps/desktop`, `npm run build --workspace ./apps/desktop`, git diff check | in_progress | 全量桌面测试：466 通过、1 跳过、0 失败；构建通过；继续完成最终构建、提交和 push |

## Rules
- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- 新增任务先补表，再继续实现。
- 不删除未提交的兼容逻辑，不修改业务数据契约。
- 每个切片完成后立即执行对应验证，验证失败不得进入下一项。
