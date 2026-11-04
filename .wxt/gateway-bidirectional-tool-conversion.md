# Gateway bidirectional tool conversion

## Goal

Implement production-grade bidirectional tool conversion for the local Gateway. Every request is parsed into one canonical tool IR and every target protocol has its own encoder/decoder. The implementation must preserve tool semantics where the target supports them, make deterministic and observable downgrades where it does not, and keep historical and streaming tool calls executable.

## Evidence baseline

- OpenAI official `Using tools`: Responses function tools use the flat shape `{ type: "function", name, description, parameters, strict }`; Responses namespaces contain flat function tools; hosted tools use provider-defined `type` values. Chat Completions uses `{ type: "function", function: { name, description, parameters } }`.
  - https://developers.openai.com/api/docs/guides/tools
- OpenAI official migration guide: Responses output items and streaming events are typed; function-call output must retain the matching `call_id`; Chat streaming chunks and Responses typed SSE events are different wire contracts.
  - https://developers.openai.com/api/docs/guides/migrate-to-responses
- Audited reference gateway implementation at commit `c1c8877`: it parses all four protocols to a shared IR, shapes foreign Chat tool definitions into Chat's nested `function` form, preserves hosted tools, lifts message-carried tools, and keeps tool-call pairing/history protocol-aware.

## Contract decisions

1. `CanonicalTool` is the only internal representation. It carries kind, name, description, JSON Schema, namespace, strict/defer flags, and raw provider fields needed for lossless hosted-tool forwarding.
2. Function tools are encoded independently per target:
   - Responses: flat `name` and `parameters`.
   - Chat Completions: nested `function.name` and `function.parameters`.
   - Anthropic: `name` and `input_schema`.
   - Gemini: `functionDeclarations[].name` and `parameters`.
3. Unknown/foreign shapes are normalized only at the protocol boundary when the target contract requires it. Hosted tools are never silently converted to ordinary functions; unsupported hosted tools are omitted only under explicit safe capability policy and produce diagnostics.
4. Namespace tools remain grouped for Responses. For protocols without namespaces they are flattened into function tools with a deterministic qualified-name mapping, and tool calls/results use that mapping in both directions.
5. `tool_choice`, `parallel_tool_calls`, strictness, custom tool input format, tool-call history, and streaming argument deltas are represented explicitly. Invalid or incomplete calls cannot be emitted as successful terminal responses.

## Task list

| ID | Task | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Extend canonical IR and tool normalizer for function/custom/namespace/hosted tools, strict/defer flags, qualified names, and foreign input shapes | done | `packages/gateway/src/conversion/tool-converter.ts`, request/response IR; covered by Gateway tests |
| 2 | Implement protocol-specific request encoders/decoders and remove the Responses-via-Chat shape bug in `protocol/codecs.ts` | done | `request-converter.ts`, `protocol/codecs.ts`; exact field-placement tests passed |
| 3 | Implement protocol-specific response/event encoders/decoders, including custom/hosted calls and typed Responses streaming events | done | `response-converter.ts`, `stream-state.ts`; typed Responses/custom/hosted stream tests passed |
| 4 | Make tool-call history pairing deterministic across protocols, including missing/duplicate/orphan results and namespace mapping | done | `tool-exchange-history.ts`, desktop history store/runtime metadata; history and runtime tests passed |
| 5 | Add capability-aware loss policy and diagnostics for unsupported tools/fields; no silent semantic loss | done | Route capability filtering, explicit downgrade diagnostics/errors; capability and request tests passed |
| 6 | Add strict structural regression tests for all source/target matrices, foreign shapes, namespaces, hosted tools, tool choice, history, and stream deltas | done | `npm run gateway:test`: 221 passed, 0 failed |
| 7 | Build and verify Gateway plus desktop runtime consumes the current `packages/gateway/dist` artifact | done | `gateway:build` passed; `gateway:test` 221/221 passed; `desktop:build` passed; latest `desktop:test` 592 passed, 1 environment-gated E2E skipped, 0 failed; packaged runtime and shared-history regression passed |

## Verification gates

- No test may assert only that serialized JSON contains a tool name; tests must assert exact protocol field placement and absence of invalid sibling/nested fields.
- A request with an invalid tool shape must either normalize deterministically or fail/diagnose before transport; it must not reach an upstream with an empty tool name.
- Streaming tests cover first-fragment IDs, indexed continuation fragments, empty arguments, malformed JSON, custom/hosted calls, and terminal events.
- Existing non-tool text, reasoning, image, and usage conversions must remain unchanged.

## Final verification

- `npm run gateway:build` — passed.
- `npm run gateway:test` — 221 passed, 0 failed.
- `npm run desktop:test` — 592 passed, 0 failed, 1 environment-gated Codex E2E skipped (`CODEX_SWITCHER_RUN_CODEX_E2E=1` is required).
- `npm run desktop:build` — passed; Vite emitted only the existing chunk-size advisory.
- Targeted shutdown regression — passed: pool capability mismatch test now exits cleanly without `ENOTEMPTY` during event-log cleanup.
- `git diff --check` — passed.

The desktop runtime consumes the rebuilt `packages/gateway/dist` artifact through its existing adapter boundary; no direct CommonJS import of Gateway ESM was introduced.
