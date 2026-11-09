# 网关模型目录-继承模型元数据

## Goal
- 网关模式生成 Codex `model_catalog_json` 时，继承模型设置页中已保存的模型元数据，避免上下文、能力和高级参数被默认值覆盖。

## Why Complex
- 改动跨 Electron 网关目录生成、模型目录快照传递和回归测试，涉及多个职责模块。

## Scope
- 相关模块/类：网关模型目录生成、环境网关目录同步、Electron 网关重同步流程。
- 相关文件：`apps/desktop/electron/gateway-model-catalog.ts`、`apps/desktop/electron/account-model-catalog.ts`、`apps/desktop/electron/bridge.ts` 及对应测试。
- 兼容要求：没有模型快照或没有匹配模型时保持现有默认目录行为；网关展示名称、路由标识和 `prefer_websockets=false` 的安全约束保持不变。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 让网关目录生成器按暴露模型 slug 继承模型快照字段 | `gateway-model-catalog.ts` | 网关目录单元测试验证上下文、能力和自定义字段保留 | done | `npx tsx --test apps/desktop/electron/gateway-model-catalog.test.ts`：5 项通过 |
| 2 | 将模型快照传入所有网关目录同步入口 | `account-model-catalog.ts`, `bridge.ts` | TypeScript 编译与同步链路测试 | done | 4 个 Electron 网关目录同步入口均传入 `getModelCatalogStore().load()`；相关测试 18 项通过 |
| 3 | 补充完整同步回归测试并运行相关测试集 | `gateway-model-catalog.test.ts`, `account-model-catalog.test.ts` | `apps/desktop` 测试、构建、diff 检查 | done | 网关 5 项、账号目录 18 项通过；桌面端 597 项中 596 项通过、1 项按条件跳过；`npm run desktop:build` 通过 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
