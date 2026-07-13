# OpenAI Chat Compatibility References

The compatibility router is an independent TypeScript implementation based on the public OpenAI Responses and Chat Completions contracts.

Behavioral study references:

- CC Switch (`farion1231/cc-switch`, commit `f39d463c442e705727531b85f2db98e00ccaf11e`), MIT: request conversion, streamed tool-call assembly, response event ordering, and bounded tool-call history were reviewed. No Rust source was copied into this project.
- CLIProxyAPI (`router-for-me/CLIProxyAPI`, commit `6fc4f0c4ef5675a2b04d84c1158a0140523d53fe`), MIT: provider execution boundaries, retry behavior, and multi-protocol routing were reviewed. No Go source was copied into this project.

Local fixtures and tests are newly authored in:

- `apps/desktop/electron/openai-chat-compat/request-transformer.test.ts`
- `apps/desktop/electron/openai-chat-compat/stream-transformer.test.ts`
- `apps/desktop/electron/openai-chat-compat/response-transformer.test.ts`
- `apps/desktop/electron/openai-chat-compat/codex-e2e.test.ts`

The implementation does not link, bundle, execute, or depend on either reference project at runtime.
