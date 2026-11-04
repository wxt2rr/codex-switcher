# gateway-stream-deduplicate-completion

## Goal
- Prevent Responses-to-Chat Completions streaming from replaying complete text in `response.output_item.done` and terminal `response.completed` after deltas were already forwarded.

## Why Complex
- The fix crosses stream state bookkeeping and regression coverage, and must preserve terminal lifecycle events while avoiding duplicate content for all non-Responses targets.

## Scope
- 相关模块/类：Gateway response stream conversion.
- 相关文件：`packages/gateway/src/conversion/stream-state.ts`, `packages/gateway/src/conversion/stream-state.test.ts`.
- 兼容要求：Keep native Responses lifecycle/terminal frames and first-authoritative output for streams without prior deltas; suppress only replayed aggregate content.

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Extend replay detection to canonical event history for non-Responses targets | stream-state.ts | focused stream-state tests | done | `hasResponseTextItem` now matches item id/output index against prior canonical deltas; terminal aggregate detection also considers canonical text/reasoning/media/tool events |
| 2 | Add Responses-to-Chat Completions regression coverage | stream-state.test.ts | gateway test suite | done | `npm run test --workspace ./packages/gateway`: 232 passed, 0 failed |
| 3 | Build gateway and verify the live endpoint no longer emits duplicate content | gateway build/runtime | build + curl SSE inspection | done | `npm run gateway:build`; `npm run desktop:build`; `npm run desktop:package:mac:dir`; restarted gateway on port 17833 (PID 84120); live SSE returned 19 incremental content chunks, one assembled answer, no duplicate full chunk, and `[DONE]` |

## Rules
- 同时只能有一个 `in_progress`
- 每完成一项立刻更新 `Status` 和 `Evidence`
- 新增任务先补表，再继续实现
