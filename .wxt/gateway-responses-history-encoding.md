# gateway-responses-history-encoding

## Goal
- 让生产运行时的 Responses 请求编码与 Magpie 的 item-level 语义一致，避免把 function_call、function_call_output、reasoning 等 Responses item 错误放进 message.content。

## Why Complex
- 同时涉及生产请求转换器、Responses item 顺序、工具调用/结果/推理语义和回归测试；仓库中还存在一套未被生产运行时使用的公共协议编码器。

## Scope
- 相关模块/类：Gateway request conversion、Responses history encoding、tool exchange normalization。
- 相关文件：`packages/gateway/src/conversion/request-converter.ts`、`packages/gateway/src/conversion/request-converter.test.ts`、对应生成的 gateway runtime bundle。
- 兼容要求：Chat Completions、Anthropic、Gemini 的现有编码行为不变；Responses 的普通文本/图片/文件仍使用 message content，工具调用和工具结果改为顶层 input item。

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 建立 Responses item-level 编码 helper，保留消息顺序并拆出工具调用、工具结果和 reasoning | `request-converter.ts` | 类型检查 + 定向请求转换测试 | complete | `encodeResponsesInput` 现在将 function_call、function_call_output、reasoning 作为顶层 item；普通内容保留在 message.content；函数调用 item id 自动规范为 `fc_...` |
| 2 | 增加截图场景及 reasoning/混合内容回归测试 | `request-converter.test.ts` | gateway test | complete | 新增 Chat→Responses 工具历史、Responses→Responses sealed reasoning/instructions、非法 `call_...` item id 规范化测试，定向 30/30 通过 |
| 3 | 重新生成生产 gateway bundle，清理无关生成差异 | `packages/gateway/dist/**` | gateway build + diff check | complete | `npm run gateway:build` 通过；同步 request-converter/stream-state 及其测试 bundle，`git diff --check` 通过 |
| 4 | 完成需求映射和残余风险核对 | `.wxt/gateway-responses-history-encoding.md` | verify-deliver | complete | Gateway 全量 235/235 通过；未重启运行中的网关/App |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
