# 模型路由-刷新后失效绑定修复

## Goal
- 刷新服务商模型列表后，已经不再由上游提供的旧模型不能继续被测试或编译进网关路由。
- 测试按钮、保存绑定和网关编译使用一致的可用性判断；刷新失败时保留旧绑定作为恢复后备。
- 核对并同步 our-free-model 上游模型目录端点变更，避免继续使用过期的 `/zen/v1/models`。

## Why Complex
- 跨桌面 Electron bridge、模型目录存储、网关编译和内置插件多个职责区域。

## Scope
- 相关模块/类：model-catalog-store、Electron bridge preview、gateway model binding compiler、csw-our-free-model vendor。
- 相关文件：`apps/desktop/electron/model-catalog-store.ts`、`apps/desktop/electron/bridge.ts`、相关测试、`plugins/csw-our-free-model/vendor/ofm`。
- 兼容要求：不覆盖工作区已有未提交改动；手动模型和 discovery 失败恢复逻辑继续可用；不硬编码具体模型名。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 统一 preview 与可用性校验，阻止 ready discovery 中 unavailable 模型继续路由 | model-catalog-store, bridge | 相关单测 | done | `model-catalog-store` 与 `gateway-model-bindings` 29 项通过；preview 现在显式拒绝 unavailable |
| 2 | 增加保存入口边界校验并补回归测试 | model-catalog-store tests | desktop tests | done | `setAccountBindings`、`setModelBindings`、projection 共用 ready discovery 校验；新增 unavailable 绑定回归测试通过 |
| 3 | 评估并同步 OFM 上游模型刷新端点/版本 | csw-our-free-model vendor | plugin tests, diff review | done | vendor runtime source 同步至上游 2.5.6（含 `/inference/v1`、OpenCode v2 指纹与会话协议）；本地 managed/plugin 测试及真实上游请求通过 |
| 4 | 全量验证并记录残余风险 | gateway/desktop build and tests | git diff --check | done | `npm run desktop:test` 481 项通过（1 skipped），`npm run desktop:build`、`npm run gateway:build`、插件测试和真实上游请求均通过 |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
