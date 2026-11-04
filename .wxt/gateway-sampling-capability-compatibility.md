# gateway-sampling-capability-compatibility

## Goal
- 对齐 Magpie 的采样参数兼容策略：按服务商、端点、协议和模型记录 `temperature/top_p/top_k` 能力；请求发送前裁剪明确不支持的参数；上游明确拒绝时只做有限重试并学习结果。
- 修复上游返回 `400 Unsupported parameter: temperature` 导致网关请求失败的问题，同时不把能力不匹配误判为账号冷却或池故障。

## Why Complex
- 涉及共享 Gateway 能力模型、跨协议请求转换、桌面路由运行时和持久化能力观测四个模块。
- 需要同时覆盖直连路由、账号池、协议转换和兼容端点，并保持未知能力的向后兼容。

## Scope
- 相关模块/类：`packages/gateway` capability registry/planner/converter；`apps/desktop/electron` usage router and provider model discovery.
- 相关文件：能力契约、请求转换器、路由运行时、插件模型能力归一化及对应测试。
- 兼容要求：只有明确 `unsupported` 才删除参数；未知能力保留原请求；每次请求的动态修复有上限；能力 key 必须包含 provider、endpoint、protocol、model 和 credential 维度。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 扩展采样参数能力模型、错误识别和参数裁剪 | `packages/gateway/src/capability/*` | capability unit tests | complete | `npm run gateway:test`：228 项通过；新增 temperature metadata、错误识别、Chat/Gemini 裁剪、过期观察 TTL 测试；过期结论不再永久裁剪 |
| 2 | 将采样参数能力接入跨协议转换和模型发现 | `packages/gateway/src/conversion/*`, plugin/core model mapping | gateway tests + build | complete | canonical IR filtering prevents re-injection; provider/plugin/core/catalog mappings updated; request conversion tests pass |
| 3 | 将预发送裁剪和有限动态修复接入所有桌面路由入口 | `apps/desktop/electron/usage-router-service.ts`, compatibility handler | desktop typecheck + router tests | complete | direct, account-pool and compatibility routes use unified filtering; each route learns/retries at most 3 precise mismatches; capability mismatches remain non-cooldown |
| 4 | 编译产物、回归测试与残余风险检查 | `packages/gateway/dist`, test suites | gateway/core/desktop checks | complete | gateway 228/228, core 172/172, desktop 594 pass + 1 skipped, usage-router 43/43; core/gateway/desktop builds and Electron typecheck pass; `git diff --check` clean |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
