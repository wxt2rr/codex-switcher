# 插件页-卡片配置入口

## Goal
- 将 Claude Code 及其他需要配置的插件入口统一收敛到对应插件卡片，移除插件页顶部的专属配置按钮。

## Scope
- 插件页顶部仅保留市场级操作。
- 已安装插件卡片在有配置能力时展示“配置/Configure”操作。
- Claude Code 卡片打开现有连接配置面板；普通插件卡片打开现有插件详情/设置面板。
- 保持现有设计 token、卡片布局、安装/升级/运行操作不变。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 移除顶部 Claude Code 配置入口，增加卡片配置入口 | `apps/desktop/src/pages/plugins-page.tsx` | 插件页静态测试、TypeScript 检查 | done | 顶部仅保留安装/刷新市场；有配置能力的卡片显示配置按钮，Claude Code 复用连接面板 |
| 2 | 覆盖 Claude Code 与普通插件的配置入口行为 | `apps/desktop/src/pages/plugins-page.test.ts` | 定向测试、桌面全量测试 | done | 定向测试与桌面全量测试通过；静态测试覆盖顶部入口移除、Claude Code 分流和普通插件配置能力判定 |
| 3 | 构建并检查视觉/格式回归 | desktop build / diff check | `npm run desktop:build`, `git diff --check` | done | 桌面生产构建通过，`git diff --check` 通过；插件页保持现有设计 token 与卡片布局 |

## Rules
- 同时只能有一个 `in_progress`。
- 不引入新的插件配置协议；只调整入口归属和现有面板复用。
