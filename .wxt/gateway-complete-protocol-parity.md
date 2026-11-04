# Gateway-完整协议转换对齐

## Goal
- 以 Magpie `c1c8877` 和 OpenAI Responses、OpenAI Chat Completions、Anthropic Messages、Gemini 官方协议为基线，完整对齐 Gateway 的双向转换能力。
- 扩展统一 Canonical IR，统一 generic 与 legacy 两条运行时路径，覆盖请求、响应、流式、历史恢复、工具往返、媒体、usage、错误和结构化输出。
- 以真实协议 fixture、正反向 golden 测试和回归测试证明不再存在已知未对齐能力。

## Why Complex
- 跨 `packages/gateway`、`apps/desktop/electron/openai-chat-compat`、运行时路由、协议 codec、历史存储和测试 fixture 多个子系统。
- 涉及四种协议、流式与非流式两套响应、旧实现与新实现兼容，预计修改超过 150 行。

## Scope
- 相关模块/类：Canonical request/response IR、request/response/tool/reasoning/media/usage converters、stream state、history store、protocol codecs、legacy OpenAI Chat compatibility adapter、gateway runtime。
- 相关文件：`packages/gateway/src/conversion/**`、`packages/gateway/src/request/**`、`packages/gateway/src/response/**`、`packages/gateway/src/protocol/**`、`packages/gateway/src/runtime/**`、`apps/desktop/electron/openai-chat-compat/**` 及对应测试/fixture。
- 兼容要求：保留现有双向工具转换行为；不得覆盖工作区已有未提交改动；对无法由目标协议表达的能力必须显式降级并记录，而不是静默丢弃。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 建立官方协议与 Magpie 对照矩阵，盘点 IR 字段、item 类型、工具类型和可逆性边界 | `docs/`、`packages/gateway/src/**` | 矩阵覆盖四协议请求/响应/流式/历史/错误场景；审查现有实现与测试 | done | 已新增 [`docs/superpowers/specs/2026-11-03-gateway-protocol-parity-matrix.md`](/Users/wangxt/myspace/codex-switcher/docs/superpowers/specs/2026-11-03-gateway-protocol-parity-matrix.md)，并以当前源码和 Magpie `c1c8877` 对照记录缺口 |
| 2 | 扩展 Canonical IR 与 codec，完整承载请求参数、消息 item、reasoning、结构化输出、媒体、工具、usage、错误元数据 | `packages/gateway/src/request/**`、`response/**`、`conversion/**`、`protocol/**` | TypeScript 类型检查；每个新增字段有正向/反向单测 | done | Canonical/public IR 已承载共享控制、Chat 顶层 `web_search_options`、Responses metadata/error/incomplete、Gemini/Anthropic 签名字段、usage 嵌套详情；`npm run gateway:build` 通过，Gateway 全量 221 项测试通过。 |
| 3 | 完成四协议请求转换：普通/custom/tool_search/web_search、allowed_tools、namespace、Gemini snake_case、Anthropic 专属字段、structured output | `packages/gateway/src/conversion/request-converter.ts`、`tool-converter.ts`、`reasoning-converter.ts`、`codecs.ts` | Responses/Chat/Anthropic/Gemini fixture 对比；断言层级、排除未知字段、schema 清理和降级日志 | done | `npm run gateway:build && npm run gateway:test` 通过（221/221）；已覆盖 Chat 顶层 web search、custom/tool_search fallback、allowed_tools、namespace/长名 hash、Gemini snake_case 与 responseSchema、Anthropic output_config/max_tokens、schema 清理和 capability omission。 |
| 4 | 完成四协议响应与流式转换：item 生命周期、tool/custom/tool_search 往返、assistant output_text、reasoning、媒体、finish/error/incomplete、usage | `packages/gateway/src/conversion/response-converter.ts`、`stream-state.ts`、`usage.ts` | 流式事件序列 golden；非流式与流式结果一致性；错误语义保真 | done | 已覆盖基础 item/tool/custom/tool_search、usage、incomplete/error、annotations/refusal、未知事件诊断、reasoning 多 summary item、加密 thinking 生命周期、媒体 content-part 生命周期、动态 tool-search 结果、native `output_item.done` 参数和 stream/non-stream 关键回归；`npm run gateway:build && npm run gateway:test` 通过（221/221）。 |
| 5 | 完善历史恢复与持久化：完整 item 顺序、assistant 文本/reasoning、tool outputs、media、compaction、conversation key，并修复 previous_response_id 消费边界 | `tool-exchange-history.ts`、`apps/desktop/electron/openai-chat-compat/history-store.ts`、runtime | 多轮工具调用、历史对话、compaction、跨环境恢复回归测试 | done | generic 与 Electron history 均保留完整 output item 顺序、Gemini 同名工具 FIFO/thought signature、Chat/Gemini 多媒体 tool result、interrupted stream partial text/reasoning/media/tool call、compaction 安全降级、conversation scope、route collision-safe persistence、usage/status/incomplete 元数据和 item/total byte ceilings；Gateway history 与 desktop history 回归通过（221/221、compat 68 pass/1 skipped）。 |
| 6 | 统一 legacy 与 generic 两套路径，消除同请求因开关/路由不同产生的转换差异 | `apps/desktop/electron/openai-chat-compat/**`、`packages/gateway/src/runtime/**` | 同一输入走两条路径的结构化 diff；兼容旧配置和已有请求 | done | `useLegacyProtocolConversion()` 固定关闭；生产 `usage-router-service.ts`、`compatibility-handler.ts` 全部通过 shared `gateway-conversion-runtime`，stream history 也统一使用 shared `buildStreamHistory`；新增静态 parity 检查确保生产入口不导入 legacy transformers，compat 测试通过。旧 transformer 仅保留为 source-compatible test helper。 |
| 7 | 完成生产级验证与交付审查：真实上游样例、协议异常、降级、取消、超时、重试、日志脱敏、性能和兼容性 | 全部 gateway 转换相关模块 | workspace test/build/typecheck；fixture 回归；completion review；记录残余风险 | done | `npm run test:cross-platform` 全部通过（core、Gateway 221/221、脚本 35/35）；`npm run desktop:test` 593 项（592 pass、1 个真实 Codex E2E 跳过）；`npm run desktop:build`、Electron `tsc --noEmit`、`git diff --check` 均通过。已有测试覆盖错误/取消/超时/重试、首字节后禁止 fallback、日志脱敏、历史大小上限及 packaged Gateway dist 加载。残余风险仅为真实上游/真实 Codex 账号 E2E 需要用户环境令牌。 |

## Rules
- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- 新增任务先补表，再继续实现。
- 不允许用“字段存在”代替协议语义验证；必须验证字段层级、类型、事件顺序和可逆性。
- 对 Magpie 未覆盖但官方协议已定义的能力，以官方协议为准，并在矩阵中记录差异。
