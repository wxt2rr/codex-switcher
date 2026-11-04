# Gateway 协议转换对齐矩阵

基线：OpenAI Responses、OpenAI Chat Completions、Anthropic Messages、Gemini 官方 JSON 协议，以及 Magpie `c1c8877` 的 `internal/gateway` 转换实现。

## 请求语义

| 语义 | Responses | Chat | Anthropic | Gemini | 当前实现状态 |
| --- | --- | --- | --- | --- | --- |
| 模型/消息/流式 | `model/input/stream` | `model/messages/stream` | `model/messages/stream` | `model/contents/streamGenerateContent` | 基础覆盖 |
| token 限额 | `max_output_tokens` | `max_tokens`/`max_completion_tokens` | `max_tokens` | `generationConfig.maxOutputTokens` | `max_completion_tokens`及方言透传不完整 |
| 采样控制 | `temperature/top_p/stop` | `temperature/top_p/stop` | `temperature/top_p/stop_sequences` | `generationConfig` | 未进入 Canonical IR |
| 服务/缓存/客户端元数据 | `service_tier/prompt_cache_key/include/client_metadata` | `service_tier/prompt_cache_key/metadata` | `metadata/speed/safeguards` | `cachedContent`/原生扩展 | 未完整承载 |
| 工具选择 | `auto/none/required/function/allowed_tools` | `auto/none/required/function` | `auto/any/tool/none` | `functionCallingConfig` | `allowed_tools`未实现 |
| 结构化输出 | `text.format` | `response_format` | `output_config.format` | `responseMimeType/responseSchema` | 未接入统一 IR |
| reasoning | `reasoning.effort/summary` | `reasoning_effort`及供应商扩展 | `thinking`/`output_config.effort` | `thinkingConfig` | 请求与历史未完全拆分 |

## 消息、工具和媒体

| 能力 | Magpie/官方语义 | 当前风险 |
| --- | --- | --- |
| assistant 历史 | Responses 历史文本使用 `output_text`；reasoning、媒体按目标协议重建 | 当前可能全部编码成 `input_text` |
| Responses items | `function_call`、`custom_tool_call`、`tool_search_call`、各类 output、`agent_message`、compaction | item 类型、standalone output、compaction 不完整 |
| namespace | 保留 namespace、子工具名、工具选择和回程映射 | 映射只保留 child name，回程会丢 namespace |
| custom tool | `input:string`、严格 schema、format、custom call/output | 目标协议降级为普通 function，语义不完整 |
| tool_search | 搜索请求、动态工具发现、结果回传、后续请求注入 | 当前按 hosted tool 处理，缺少完整往返 |
| web search | Chat 顶层 `web_search_options`，Responses search item/source include | 当前可能放在 Chat `tools` 内，回程信息不全 |
| schema 安全 | Magpie 清理 `encrypted` 标记并保留合法 schema | 当前可能把加密标记直接发给普通上游 |
| 工具名 | 目标不支持 namespace 时需要稳定、无碰撞的 qualified name | 仅截断，长名称可能碰撞 |
| 图片/文件/工具结果媒体 | 多协议媒体字段、工具结果 parts、签名/extra content | Gemini/Anthropic/Responses 媒体和签名不完整 |

## 响应、流式和持久化

| 能力 | 当前状态 |
| --- | --- |
| 流式 item 生命周期、ID 前缀和 custom/tool_search 事件 | 不完整 |
| `finish_reason`、`incomplete_details.reason`、refusal、annotations、logprobs | 简化映射 |
| usage 嵌套字段、reasoning tokens、cache read/write | 字段名和层级不完全符合官方结构 |
| 上游 error code、request id、retryable、取消和超时 | envelope 保留不足 |
| 完整历史顺序、assistant 文本/reasoning、tool output、media、compaction | 当前历史存储主要是工具调用摘要 |
| generic 与 Electron legacy 转换路径 | 能力和字段规则存在漂移 |

## 完成判定

1. 每个矩阵项都有 Canonical IR 字段或明确的不可表达降级诊断。
2. 四种协议每个方向都有请求、非流式响应、流式事件和历史恢复 fixture。
3. 同一输入经过 generic 与 legacy 的结构化 diff 只有已记录的协议差异。
4. 测试断言字段层级、字段排除、事件顺序、工具配对、usage 和错误语义，而不是只断言字符串存在。
