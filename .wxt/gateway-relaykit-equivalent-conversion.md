# gateway-relaykit-equivalent-conversion

## Goal
- 在保持当前项目 MIT 许可证和 TypeScript/Electron 架构的前提下，独立实现一个行为高度等价于 RelayKit 的协议转换内核。
- 覆盖 Responses、Chat Completions、Anthropic、Gemini 四种协议的请求、非流式响应、流式响应、工具、推理、多模态、Usage、转换路径和损失诊断，并完成 Gateway Runtime 集成和回归验证。

## Why Complex
- 跨 `packages/gateway/src/protocol`、`request`、`response`、`runtime`、新增 `conversion` 模块以及测试目录。
- 同时涉及同步请求转换、跨事件流式状态、协议特有字段保真、路由上下文和错误兼容，预计超过 150 行并跨多个职责模块。

## Scope
- 相关模块：Gateway protocol codecs、request/response IR、runtime dispatch/complete、routing conversion path、gateway tests。
- 相关文件：
  - `packages/gateway/src/protocol.ts`
  - `packages/gateway/src/protocol/codecs.ts`
  - `packages/gateway/src/request/request-ir.ts`
  - `packages/gateway/src/response/response-ir.ts`
  - `packages/gateway/src/runtime/runtime.ts`
  - `packages/gateway/src/index.ts`
  - `packages/gateway/src/conversion/**`
  - `packages/gateway/src/**.test.ts`
- 兼容要求：
  - 不引入 RelayKit 源码或 AGPL 运行时依赖。
  - 保留现有路由、账号池、Provider、Fallback、Usage 和公开 Gateway API 的职责。
  - 迁移期间保留旧 codecs 可回退，稳定后删除完整转换职责。
  - 未确认字段不得静默丢弃，必须进入 diagnostics 或按 strict 策略失败。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 建立转换层契约、协议质量矩阵、转换路径和诊断模型 | `conversion/types.ts`, `conversion/formats.ts`, `conversion/path-planner.ts`, `conversion/diagnostics.ts`, `packages/gateway/src/index.ts` | `npm run gateway:build`、转换契约单测 | done | `npm run gateway:build` 通过；转换矩阵和质量/透视路径测试已纳入 Gateway 测试 |
| 2 | 实现基础请求转换和协议特有工具/推理/多模态规范化 | `conversion/request-converter.ts`, `conversion/tool-converter.ts`, `conversion/reasoning-converter.ts`, `conversion/media-resolver.ts` | 请求矩阵、媒体和损失策略测试 | done | 独立规范化请求转换器覆盖工具、推理、媒体、开发者指令和严格损失策略；Gateway 测试通过 |
| 3 | 实现非流式响应、Usage 和错误转换 | `conversion/response-converter.ts`, `conversion/usage.ts` | 响应 golden/Usage 测试 | done | 四协议响应事件、Usage、工具/推理和错误响应编码已接入并通过 golden 测试 |
| 4 | 实现流式状态、工具参数拼接、终态和失败事件 | `conversion/stream-state.ts`, runtime transport boundary | 流式矩阵、终态、中断、Usage 测试 | done | 独立 stream state 支持工具参数跨 chunk 拼接、sequence、Usage、finalize/fail；四协议流方向回归通过 |
| 5 | 接入 Gateway Runtime 和 Electron HTTP/SSE 真实入口，原始请求直达转换层并保留路由/账号职责 | `runtime/runtime.ts`, `apps/desktop/electron/usage-router-service.ts`, `gateway-conversion-runtime.ts` | Gateway runtime 回归、真实 Responses→Chat SSE fixture | done | `GatewayRuntime.dispatch/complete`、桌面 `proxyRequest` 和账号池均默认接入共享转换器；真实 SSE 链路通过 |
| 6 | 建立差分/golden 测试和真实协议样例回归 | `conversion/*.test.ts`, `golden-fixtures.ts`, CI scripts | `npm run gateway:test`, `npm run gateway:build`、完整矩阵 | done | 固定四协议 request/response golden、工具/推理/Usage/媒体/错误、原生流事件和 16 个流方向均有回归；Gateway 93/93、桌面路由 26/26 通过 |
| 7 | 完成迁移、回退开关、文档和旧转换职责清理 | `apps/desktop/electron/gateway-conversion-runtime.ts`, `usage-router-service.ts`, docs | 全仓检查、旧路径不可误用、全量测试和 macOS 目录包 | done | 生产默认路径为共享转换内核；旧适配器仅作为显式 `CODEX_SWITCHER_LEGACY_PROTOCOL_CONVERSION=1` 回退；桌面全量 440 通过/1 跳过、Electron 类型检查通过、生产构建通过；arm64/x64 目录包均包含 `Contents/Resources/packages/gateway/dist/conversion/index.js` |

## Rules
- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`，没有验证证据不得标记 done。
- 新增任务先补表，再继续实现。
- 任何需要改变许可证、引入 RelayKit 源码或改变产品范围的事项必须暂停并重新确认。
