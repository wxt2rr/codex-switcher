# Gateway 通用能力探测与降级

## Goal
- 为服务商、模型、协议建立通用能力判断，不把能力判断限定在 `web_search`。
- 在能力未知或不兼容时自动探测、缓存、降级或代用，避免错误请求触发账号池冷却。
- 保持旧的 `capabilities` 字段和既有路由/协议转换兼容。

## Why Complex
- 涉及共享 Gateway 协议契约、模型/插件能力数据、协议转换、运行时路由、账号池失败分类和桌面服务。
- 需要兼容旧配置、旧模型目录、插件返回的旧能力字段和无 Gateway 构建产物的回退路径。

## Scope
- 相关模块：Gateway capability contracts/registry/planner、模型与插件能力归一化、协议工具编码、桌面 Usage Router。
- 本次覆盖：普通函数工具、Hosted tools、图片/推理/流式等已有能力；web_search 作为第一个 Hosted Tool 适配。
- 兼容要求：未知能力安全降级；能力不兼容不进入账号冷却；账号池关闭时不切换服务商。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 新增通用能力契约、能力状态合并、缓存和错误探测工具 | `packages/gateway/src/capability/*` | Gateway 单元测试 | done | `npm run gateway:build` passed; capability contract/registry/planner and tests added, including code interpreter/computer use filtering and unsatisfiable tool-choice cleanup. |
| 2 | 扩展模型/插件能力结构并保持旧字段归一化 | core model/import, plugin-sdk, provider adapter | Gateway/core/plugin build + tests | done | Added `capabilityProfile` to core models, plugin SDK, provider adapters, discovery and route bindings; legacy top-level and nested `capabilities` fields remain compatible. Core suite 165/165, gateway/plugin builds and Electron typecheck passed. |
| 3 | 将 Capability Planner 接入工具编码和协议转换 | conversion/tool-converter, request converter | conversion tests | done | `npm run gateway:test` passed; safe policy now filters web search, code interpreter and computer-use hosted tools while preserving legacy allow mode. |
| 4 | 接入桌面 Usage Router 的运行时判定、单次降级重试和能力错误分类 | usage-router-service, account-pool-routing | desktop tests + typecheck | done | Desktop router regression passed: native and account-pool routes learn precise capability mismatches, retry once on the same route/member, and never cool down or fail over for capability errors. |
| 5 | 增加模型能力状态展示和诊断入口 | bridge/catalog/models UI | desktop build/tests | done | `/admin/capabilities`, Electron bridge/preload and model-page status badges expose persisted provider/model/credential observations. |
| 6 | 完成回归验证和交付说明 | `.wxt` and full affected tests | `npm run gateway:test`, `npm run core:test`, desktop checks, `git diff --check` | done | Core/Gateway/plugin builds and tests passed; desktop build, package CommonJS/ESM boundary check, usage-store (6/6), Manager+Router regression (47/47), compatibility tests (33 passed/1 skipped), capability router regression (30/30), Electron/Web typechecks and `git diff --check` passed. Latest Gateway suite: 108/108. Capability cache writes use the existing atomic private JSON helper, and ambiguous generic tool errors no longer poison the cache. |

## Rules
- 同时只能有一个 `in_progress`。
- `tools=true` 只兼容映射为 `tools.function`，不得推断 Hosted Tool 支持。
- `capability_mismatch` 不得触发账号冷却或普通服务商切换。
- 不对所有 4xx/5xx 自动重试，只对可识别的能力格式错误重试一次。
- 每完成一项立刻更新 Status 和 Evidence。
