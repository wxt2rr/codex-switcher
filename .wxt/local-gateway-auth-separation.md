# Core runtime-local gateway auth separation

## Goal
- 修复本地 Gateway 环境使用 ChatGPT 账号时，Codex 将第三方模型误判为 ChatGPT 官方模型的问题。
- 保证环境切换、网关启停和账号切换重新生成配置后，根因不会复发。

## Why Complex
- 影响环境投影、Codex Provider 配置和回归测试三个职责区域。
- 需要同时覆盖配置生成行为与现有 ChatGPT/兼容路由兼容性。

## Scope
- 相关模块/类：target-home 配置投影、Codex 本地 Provider 配置、target-home 测试。
- 相关文件：`packages/core/src/system/target-home.ts`、`packages/core/src/system/target-home.test.ts`，以及构建产生的 core dist 文件。
- 兼容要求：保留网关内部对 ChatGPT 订阅账号的授权方式；仅改变 Codex 到本地 Gateway 的入口 Provider 认证声明。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 将本地 Gateway 的入口认证与上游账号认证解耦 | `target-home.ts` | source unit tests | done | ChatGPT Gateway 账号写 `requires_openai_auth=false`，API Key Gateway 仍保留 `env_key` |
| 2 | 增加 ChatGPT 网关账号暴露第三方模型的回归测试 | `target-home.test.ts` | focused test | done | `npx tsx --test --test-concurrency=1 packages/core/src/system/target-home.test.ts`：15/15 通过 |
| 3 | 构建 core dist 并运行相关测试 | `packages/core` | package tests/build | done | `npm run core:build` 成功；`npm run core:test`：162/162 通过 |
| 4 | 检查 diff 和残余风险 | git diff | diff check | done | `git diff --check` 通过；仅涉及 target-home 源码、测试、dist 和本任务记录 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
