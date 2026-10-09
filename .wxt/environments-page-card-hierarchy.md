# 环境页-卡片信息层级优化

## Goal
- 将环境页卡片从“多列状态堆叠”改为清晰的三段式信息结构：环境身份、运行状态、路径与网关地址。
- 降低操作密度，保留核心启动/关闭网关和账号池操作，其它管理动作收进统一的更多菜单。

## Why Complex
- 改动环境卡片、操作菜单、响应式布局和回归测试，既要优化视觉层级，也要保持现有编辑、配置、历史、删除和路由切换行为不变。

## Scope
- 相关模块/类：`EnvCard`、环境操作菜单、环境页响应式样式。
- 相关文件：`apps/desktop/src/pages/environments-page.tsx`、`apps/desktop/src/index.css`、`apps/desktop/src/components/responsive-layout.test.ts`。
- 兼容要求：不改变环境、网关、账号池、配置、历史和删除接口；保留中英文/日文文案和窄屏横向滚动策略。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 重构环境卡片为身份、状态、路径三段式布局 | `environments-page.tsx` | TypeScript、页面源码断言 | complete | 卡片改为身份/运行状态/路径三段式，移除重复 CLI/App、路由和网关地址标签 |
| 2 | 将次要操作收进自适应更多菜单并保留主操作 | `environments-page.tsx` | 定向测试、TypeScript | complete | 网关和账号池保留为主操作，编辑/配置/历史/删除收进自适应 `⋯` 菜单 |
| 3 | 更新环境页响应式样式和回归断言 | `index.css`、`responsive-layout.test.ts` | `tsx --test`、diff check | complete | 删除旧环境多列布局，新增卡片/状态/操作菜单样式；全量桌面测试 436 项通过（435 pass、1 skip） |
| 4 | 构建桌面端验证交付 | 桌面端 | `npm run desktop:build` | complete | Vite/TypeScript 桌面端构建成功，`git diff --check` 通过 |
| 5 | 强化网关和账号池开关的状态色与文案 | `environments-page.tsx`、对应测试 | 定向测试、构建 | complete | 运行中使用绿色状态和按钮，未运行使用中性状态，异常使用琥珀色；账号池显示可用数并增加 `aria-pressed` |
| 6 | 统一未开启网关与账号池的中性按钮样式 | `environments-page.tsx` | 定向测试、构建 | complete | 未开启网关改用与账号池一致的浅灰中性按钮；24 项环境布局测试通过，桌面构建成功 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 不改变后端接口和环境运行逻辑
