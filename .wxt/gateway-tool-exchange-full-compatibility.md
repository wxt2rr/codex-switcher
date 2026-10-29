# Gateway-tool-exchange-full-compatibility

## Goal
- 完整修复 Responses→Chat 工具调用兼容链路，覆盖桌面兼容层和通用 Gateway；不针对单一模型打补丁，不做 MVP。

## Why Complex
- 涉及桌面 Electron 兼容层、Gateway canonical conversion、历史持久化、流式状态机、provider capability 和跨协议回归测试，跨越多个目录且预计修改超过 150 行。

## Scope
- 相关模块/类：`ConversationHistoryStore`、Responses→Chat request/response/stream transformer、Gateway canonical request/response converter、tool/capability/schema conversion、conversion diagnostics。
- 相关文件：`apps/desktop/electron/openai-chat-compat/**`、`apps/desktop/electron/usage-router-service.ts`（仅必要时）、`packages/gateway/src/conversion/**`、`packages/gateway/src/capability/**`、相关测试。
- 兼容要求：保留正常请求的原始语义；仅对无法满足目标 provider 协议的历史/工具结构做确定性修复；不修改或删除现有未跟踪文件 `index-B2LAF26V.js`。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 建立统一工具交换模型与 normalizer：恢复位置、配对、排序、去重、孤儿降级、缺失结果补全、连续 assistant 合并、非法参数降级 | desktop compat + gateway conversion shared module | `npm run test:compat --workspace ./apps/desktop`; `npm run gateway:test` | done | 桌面与 Gateway 均已接入；桌面 45 passed/1 skipped，Gateway 119 passed；新增乱序、重复、孤儿、补全、非法参数测试 |
| 2 | 完善 history 生命周期：会话维度、持久化、TTL/容量策略、流式增量记录、completed 前提交、异常/中断保留 | history-store、history-persistence、stream/handler、Gateway runtime | 历史重启、过期、断流、completed race 测试 | done | 默认不再按 15 分钟过期；恢复插入原始工具回合；支持 conversation/thread scope；桌面流式完成前及异常时记录；Gateway 提供 session history snapshot/load |
| 3 | 接入通用 Gateway conversion，并补齐 custom/tool_search/媒体工具结果与 reasoning 邻接 | packages/gateway/src/conversion/** | 跨 Responses/Chat/Anthropic/Gemini golden tests | done | canonical normalizer 在请求编码前运行；工具 name、媒体 tool result、legacy function_call、tool_choice/parallel 参数均覆盖；Gateway 全量测试通过 |
| 4 | 建立 provider capability/profile 规则：严格工具配对、tool name、parallel tools、reasoning、参数方言、tool_choice、Schema 方言 | capability contracts/runtime、desktop route options | provider profile matrix tests | done | 增加 strict_pairing/requires_name/result_media/schema/参数能力；Kimi profile 与错误分类测试通过 |
| 5 | 增加 Moonshot/Kimi `$ref` sibling Schema normalizer 与通用参数/工具 schema 规范化 | gateway conversion/tool converter、desktop request path | Kimi host-gated schema tests，非 Kimi 字节稳定性测试 | done | Gateway 与桌面兼容路径均 host-gated；Kimi/Moonshot/DashScope token 方言处理；非 Kimi 不重写测试通过 |
| 6 | 增加流式健壮性、结构化 diagnostics、历史修复动作统计和安全错误降级 | stream state、diagnostics、telemetry | malformed SSE、missing index/id、abort、no DONE、diagnostic tests | done | 流式缺失 index 按 call id 分配；legacy function_call 支持；部分调用异常保存；桌面/Gateway diagnostics 已输出；现有 SSE 测试通过 |
| 7 | 全量回归与交付核验：桌面/Gateway 单测、构建、跨协议 golden、现有测试 | package scripts / test suites | `desktop:test`、`gateway:test`、相关 build | done | Gateway 126/126 通过；Desktop 507 项（506 通过、1 跳过）通过；`npm run gateway:build` 与 `npm run desktop:build` 通过；`git diff --check` 通过。根级 `npm test` 仍有 3 个仓库基线失败：2 个旧 core-cli 配置断言、1 个 submission-content 外部术语文件检查，均与本次工具兼容改动无关 |
| 8 | 根据真实阿里云路由证据，阻止空/非法工具参数进入 Responses 输出，并补齐上游 Chat 流式空参数回归测试 | `packages/gateway/src/conversion/response-converter.ts`、`packages/gateway/src/conversion/stream-state.ts`、`packages/gateway/src/conversion/tool-exchange-history.ts`、`apps/desktop/electron/openai-chat-compat/response-transformer.ts`、`apps/desktop/electron/openai-chat-compat/stream-transformer.ts`、历史与流式测试 | 空参数、非法 JSON、只有 tool call 无参数、历史污染后仍可返回可解析响应 | done | Gateway 130/130 通过；Desktop 510 项（509 通过、1 跳过）通过；Gateway/Desktop build 通过；工具参数改为终态缓存并只输出合法 JSON 对象，历史持久化同时过滤空/非法调用 |
| 9 | 阻止无效工具调用被静默视为成功，并兼容对象形式参数与诊断 finish reason | 桌面 Chat response/stream transformer、Gateway response converter/stream state、诊断与回归测试 | 前置文本 + 空/非法工具参数、`finish_reason=tool_calls` 无合法调用、对象参数、custom/tool_search 参数、正常工具调用不回归 | done | 桌面与 Gateway 均在检测到工具调用意图但没有任何可执行调用时输出明确失败（`upstream_invalid_tool_call` / `upstream_protocol`），不再发送静默 `response.completed`；支持对象参数、custom/Hosted Tool 纯文本参数；Gateway 135/135、Desktop 515 项（514 通过、1 跳过）通过，Gateway 构建通过 |
| 10 | 模型测试不得把 HTTP 200 的失败、空响应或仅 reasoning 响应误报为成功 | `apps/desktop/electron/usage-router-manager.ts`、模型测试回归测试 | Responses `status=failed`、错误对象、reasoning-only、正常文本/工具输出 | done | 新增结果终态、错误对象和可用 output 检查；`usage-router-manager.test.ts` 新增失败/思考无最终回答用例；目标测试 2/2 通过，兼容与管理器回归 74/74（另 1 个 E2E 跳过），桌面构建通过 |
| 11 | 兼容服务商把工具名/参数放在顶层的 Chat 工具调用格式，并增强异常诊断 | `apps/desktop/electron/openai-chat-compat/{response,stream}-transformer.ts`、`packages/gateway/src/conversion/{response-converter,stream-state}.ts` | 嵌套 `function` 与顶层 `name`/`arguments` 两种格式、异常消息包含工具名和参数长度 | done | 桌面工具转换 15/15、Gateway 136/136 通过；新增顶层工具调用回归；桌面生产构建通过 |
| 12 | 空的 `tool_calls: []` 不得被流式兼容层误判为工具调用意图 | `apps/desktop/electron/openai-chat-compat/stream-transformer.ts`、流式回归测试 | 空数组 + `finish_reason=stop` 应正常完成；真实非空但无效调用仍失败 | done | 新增空数组回归测试，桌面流式测试 8/8 通过；真实 `finish_reason=tool_calls` 仍保留明确失败诊断 |
| 13 | 区分普通工具调用与并行工具调用，避免未知服务商被错误发送并行工具请求 | `apps/desktop/electron/model-catalog-store.ts`、`apps/desktop/electron/bridge.ts`、模型目录回归测试 | 发现模型默认仅启用普通工具；只有显式能力声明才启用 `supports_parallel_tool_calls`；手工目录模型默认关闭并行 | done | 已修复目录生成与绑定映射；Gateway 137/137、Desktop 520 通过/1 跳过；`npm run gateway:build` 与 `npm run desktop:build` 通过；新增流式 Chat 工具调用按 index 合并回归，真实桌面运行时测试已在清除旧打包资源路径后通过 |

## Rules
- 同时只能有一个 `in_progress`。
- 每完成一项立刻更新 `Status` 和 `Evidence`。
- 新增任务先补表，再继续实现。
- 不触碰 `index-B2LAF26V.js`。
