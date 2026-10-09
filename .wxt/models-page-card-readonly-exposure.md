# 模型页面卡片化与只读账号来源

## Goal
- 将模型页面改为紧凑卡片布局。
- 模型页面只管理模型目录和模型元数据，账号模型暴露关系统一由账号页面维护。
- 明确展示模型被哪些账号发现，避免“1 个账号发现”无法定位账号的问题。

## Why Complex
- 涉及模型页面状态、模型卡片展示、账号来源聚合、绑定入口移除和相关测试。
- 预计修改超过 4 个职责点，且需要保持现有账号页模型暴露配置兼容。

## Scope
- 相关模块/类：ModelsPage、模型卡片、模型目录聚合、模型页面测试。
- 相关文件：`apps/desktop/src/pages/models-page.tsx`、模型页测试及必要的 UI 样式文件。
- 兼容要求：保留模型目录、编辑、删除、刷新发现和账号页暴露配置；移除模型页面修改账号绑定的入口，但不删除后端已有绑定数据或接口。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 梳理现有模型页绑定、发现和目录展示边界 | ModelsPage | 代码检查 | done | 已确认模型页存在独立绑定面板，账号页已有暴露选择面板 |
| 2 | 重构模型页为卡片布局并展示服务商、发现来源账号和暴露数量 | `models-page.tsx` | TypeScript、模型页测试 | done | `npx tsc -p apps/desktop/tsconfig.web.json --noEmit` 通过 |
| 3 | 移除模型页绑定账号交互，保留模型编辑与删除 | `models-page.tsx` | 源码断言、TypeScript | done | 已移除绑定状态、绑定弹窗和保存调用，保留编辑、删除 |
| 4 | 补充模型页筛选和账号来源展示测试 | 模型页测试 | 定向测试、diff check | done | `tsx --test` 3 项通过，`git diff --check` 通过 |
| 5 | 完成回归验证并记录兼容风险 | desktop web | 类型检查、定向测试、构建 | done | `npm run desktop:test`：436 项，435 通过、1 跳过、0 失败；`npm run desktop:build` 通过 |

## Rules
- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- 新增任务先补表，再继续实现。
- 账号页是账号模型暴露关系的唯一修改入口；模型页只读展示账号来源和暴露统计。

## Compatibility Notes
- 模型目录、编辑、删除和刷新发现能力保留。
- 后端 `accountBindings` 数据和绑定接口保留，旧配置不会被删除；模型页不再提供第二个修改入口。
- 现有账号页模型暴露选择器继续负责保存账号与模型关系。
