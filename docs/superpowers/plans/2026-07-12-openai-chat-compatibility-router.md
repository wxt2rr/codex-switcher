# OpenAI Chat Compatibility Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an API-key account manually route current Codex Responses traffic through a built-in OpenAI Chat Completions compatibility engine while preserving account isolation, tool workflows, streaming semantics, usage accounting, and native Responses pass-through behavior.

**Architecture:** Extend account runtime settings and the existing usage router. Pure TypeScript modules convert requests, tools, history, non-stream responses, and Chat SSE streams; the Electron main process owns upstream secrets and hydrates an in-memory route secret store over the authenticated loopback admin API. UI and target materialization remain in codex-switcher, and no external Go/Rust/Python sidecar is introduced.

**Tech Stack:** TypeScript 5.6, Node HTTP/fetch/Web Streams, Electron IPC, React 19, sql.js, Node test runner through `tsx --test`.

## Global Constraints

- Only OpenAI Responses to OpenAI Chat Completions conversion is in scope.
- Existing accounts default to native `responses` and compatibility routing disabled.
- Compatibility routing is manually enabled per API-key account.
- Native Responses routes remain byte-for-byte pass-through.
- Chat routes fail closed when disabled, unhealthy, or missing an in-memory upstream secret.
- Upstream API keys never appear in Codex target files, route URLs, notices, or persisted usage-router metadata.
- Runtime listeners bind only to `127.0.0.1`.
- No Go, Rust, Python, Docker, or separately installed proxy is required.
- Any substantially ported MIT code retains attribution and source commit metadata.

---

## File Structure

Create focused protocol modules under `apps/desktop/electron/openai-chat-compat/`:

- `types.ts`: shared protocol and diagnostic types.
- `tool-registry.ts`: request-scoped Responses tool to Chat function mappings.
- `request-transformer.ts`: Responses request to Chat Completions request.
- `history-store.ts`: bounded per-route function-call restoration.
- `sse-parser.ts`: arbitrary-byte-boundary SSE parser.
- `responses-events.ts`: valid Responses SSE event constructors.
- `stream-transformer.ts`: Chat SSE state machine to Responses SSE.
- `response-transformer.ts`: non-stream Chat response to Responses response.
- `upstream-client.ts`: timeout, abort, headers, retry-before-first-byte, and errors.
- `compatibility-handler.ts`: route-level orchestration.

Modify existing state, router, bridge, and UI files only where the feature crosses their ownership boundary.

---

### Task 1: Persist Account Protocol And Materialize Local Codex Targets

**Files:**
- Modify: `packages/core/src/state/store.ts`
- Modify: `packages/core/src/state/legacy.ts`
- Modify: `packages/core/src/state/legacy.test.ts`
- Modify: `packages/core/src/state/store.test.ts`
- Modify: `packages/core/src/system/target-home.ts`
- Modify: `packages/core/src/system/target-home.test.ts`

**Interfaces:**
- Produces: `AccountApiProtocol`, `ReasoningProfile`, and compatibility fields on `AccountRuntimeSettings`.
- Produces: local route materialization through `compatibilityRouteBaseUrl`, `compatibilityRouteToken`, and `compatibilityRouteProviderId`.

- [ ] **Step 1: Write failing state validation tests**

Add cases proving old state defaults safely and new state round-trips:

```ts
assert.equal(account.runtime.apiProtocol, "responses");
assert.equal(account.runtime.compatibilityRouteEnabled, false);

assert.deepEqual(reloaded.runtime, {
  preferredAuthMethod: "apikey",
  openaiBaseUrlMode: "custom",
  openaiBaseUrl: "https://chat.example/v1",
  apiProtocol: "chat_completions",
  compatibilityRouteEnabled: true,
  compatibilityRouteBaseUrl: "http://127.0.0.1:17899/routes/route-a/v1",
  compatibilityRouteToken: "local-token",
  compatibilityRouteProviderId: "codex-switcher-route-a",
  reasoningProfile: "auto",
});
```

- [ ] **Step 2: Run state tests and verify failure**

Run:

```bash
pnpm --dir packages/core exec tsx --test src/state/store.test.ts src/state/legacy.test.ts
```

Expected: FAIL because protocol and compatibility fields are not defined or preserved.

- [ ] **Step 3: Add exact runtime types and defaulting**

Add:

```ts
export type AccountApiProtocol = "responses" | "chat_completions";
export type ReasoningProfile = "auto" | "standard" | "reasoning_content" | "think_tags";

export interface AccountRuntimeSettings {
  // existing fields
  apiProtocol?: AccountApiProtocol;
  compatibilityRouteEnabled?: boolean;
  compatibilityRouteBaseUrl?: string;
  compatibilityRouteToken?: string;
  compatibilityRouteProviderId?: string;
  compatibilityUpstreamModel?: string;
  compatibilityReasoningProfile?: ReasoningProfile;
  compatibilityRequestOverrides?: Record<string, unknown>;
}
```

Validation returns explicit defaults for `apiProtocol`, `compatibilityRouteEnabled`, and `compatibilityReasoningProfile` while keeping generated route fields absent when disabled.

- [ ] **Step 4: Write failing target-home tests**

Assert that an enabled Chat route writes:

```toml
preferred_auth_method = "apikey"
model_provider = "codex-switcher-route-a"

[model_providers.codex-switcher-route-a]
name = "codex-switcher-route-a"
base_url = "http://127.0.0.1:17899/routes/route-a/v1"
wire_api = "responses"
env_key = "OPENAI_API_KEY"
```

Assert `auth.json` contains only the local route token. Assert native Responses target output remains unchanged.

- [ ] **Step 5: Implement compatibility target materialization**

Before writing `auth.json`, derive target auth data:

```ts
const targetAuthData =
  account.runtime.apiProtocol === "chat_completions" &&
  account.runtime.compatibilityRouteEnabled &&
  account.runtime.compatibilityRouteToken
    ? { OPENAI_API_KEY: account.runtime.compatibilityRouteToken }
    : account.authData;
```

Add a managed provider section only when all generated route fields exist. Throw before writing either file if an enabled Chat route is incomplete.

- [ ] **Step 6: Run focused and core tests**

```bash
pnpm --dir packages/core exec tsx --test src/state/store.test.ts src/state/legacy.test.ts src/system/target-home.test.ts
pnpm --dir packages/core test
```

Expected: all core tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/state packages/core/src/system/target-home.ts packages/core/src/system/target-home.test.ts
git commit -m "feat: persist account compatibility protocol"
```

---

### Task 2: Extend Route Metadata And Add Memory-Only Secret Hydration

**Files:**
- Modify: `apps/desktop/electron/usage-routing-model.ts`
- Modify: `apps/desktop/electron/usage-routing-model.test.ts`
- Modify: `apps/desktop/electron/usage-store.ts`
- Modify: `apps/desktop/electron/usage-store.test.ts`
- Create: `apps/desktop/electron/openai-chat-compat/route-secret-store.ts`
- Create: `apps/desktop/electron/openai-chat-compat/route-secret-store.test.ts`
- Modify: `apps/desktop/electron/usage-router-service.ts`

**Interfaces:**
- Produces: extended `RouteTarget` and `RouteRuntimeSecret`.
- Produces: `RouteSecretStore.set/get/delete/clear`.
- Produces admin endpoint: `PUT /admin/routes/:routeId/secret`.

- [ ] **Step 1: Write failing route/store migration tests**

Use a database created with the old table shape, reopen it, and assert defaults:

```ts
assert.equal(route.protocol, "responses");
assert.equal(route.reasoningProfile, "auto");
assert.equal(route.upstreamModel, undefined);
```

Assert persisted rows never contain `apiKey` or `routeToken` columns.

- [ ] **Step 2: Extend route types and migrate the sql.js schema**

Add:

```ts
export type RouteProtocol = "responses" | "chat_completions";

export interface RouteTarget {
  // existing fields
  protocol: RouteProtocol;
  upstreamModel?: string;
  reasoningProfile: ReasoningProfile;
  requestOverrides?: Record<string, unknown>;
}

export interface RouteRuntimeSecret {
  routeId: string;
  upstreamApiKey: string;
  localRouteToken: string;
  hydratedAt: number;
}
```

Use `PRAGMA table_info(route_targets)` and `ALTER TABLE` for missing metadata columns. Serialize overrides as JSON. Do not add secret columns.

- [ ] **Step 3: Write and implement secret-store tests**

Required behavior:

```ts
const store = new RouteSecretStore();
store.set(secret);
assert.deepEqual(store.get("route-a"), secret);
store.delete("route-a");
assert.equal(store.get("route-a"), undefined);
```

The store clones values on set/get and rejects empty route IDs or keys.

- [ ] **Step 4: Add authenticated secret hydration endpoint**

Accept:

```json
{
  "upstreamApiKey": "sk-upstream",
  "localRouteToken": "local-random-token"
}
```

Return `204`; reject missing fields with `400`; require the existing admin bearer token. Route deletion also deletes its secret.

- [ ] **Step 5: Add route authorization helper**

Use constant-time comparison:

```ts
export function authorizeRouteToken(header: string | undefined, expected: string): boolean {
  const actual = header?.replace(/^Bearer\s+/i, "") ?? "";
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
```

- [ ] **Step 6: Run focused tests**

```bash
pnpm --dir apps/desktop exec tsx --test electron/usage-routing-model.test.ts electron/usage-store.test.ts electron/openai-chat-compat/route-secret-store.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/electron/usage-routing-model.ts apps/desktop/electron/usage-routing-model.test.ts apps/desktop/electron/usage-store.ts apps/desktop/electron/usage-store.test.ts apps/desktop/electron/openai-chat-compat/route-secret-store*
git commit -m "feat: add account route protocol metadata"
```

---

### Task 3: Implement Tool Registry And Responses Request Conversion

**Files:**
- Create: `apps/desktop/electron/openai-chat-compat/types.ts`
- Create: `apps/desktop/electron/openai-chat-compat/tool-registry.ts`
- Create: `apps/desktop/electron/openai-chat-compat/tool-registry.test.ts`
- Create: `apps/desktop/electron/openai-chat-compat/request-transformer.ts`
- Create: `apps/desktop/electron/openai-chat-compat/request-transformer.test.ts`
- Create: `apps/desktop/electron/openai-chat-compat/fixtures/requests/*.json`

**Interfaces:**
- Produces: `buildToolRegistry(request): ToolRegistry`.
- Produces: `transformResponsesRequest(input): TransformedChatRequest`.

- [ ] **Step 1: Define protocol types and typed errors**

```ts
export class CompatibilityError extends Error {
  constructor(
    readonly code: "UNSUPPORTED_ITEM" | "INVALID_TOOL" | "INVALID_REQUEST" | "UPSTREAM_PROTOCOL",
    message: string,
    readonly status = 400,
  ) { super(message); }
}

export interface TransformedChatRequest {
  body: Record<string, unknown>;
  tools: ToolRegistry;
  requestedModel: string;
}
```

- [ ] **Step 2: Write failing tool-registry tests**

Cover function, custom, namespace, tool-search, deterministic truncation, collision rejection, and reverse lookup. Assert custom tools use a required string `input` property.

- [ ] **Step 3: Implement tool registry**

Use SHA-256 suffixes for names longer than 64 characters:

```ts
const suffix = createHash("sha256").update(original).digest("hex").slice(0, 8);
return `${original.slice(0, 55)}_${suffix}`;
```

Store mappings by Chat name and by namespace/name pair.

- [ ] **Step 4: Write failing request golden tests**

Fixtures cover:

- instructions plus string input;
- typed messages and image URL/detail;
- grouped parallel function calls;
- function outputs adjacent to assistant tool calls;
- deferred regular messages;
- custom/namespace/tool-search definitions;
- `tool_choice`;
- reasoning profiles;
- token parameter selection;
- protected override rejection; and
- unsupported item failure.

- [ ] **Step 5: Implement request conversion**

Use a single ordered pass over `input`. Maintain:

```ts
const pendingCalls: ChatToolCall[] = [];
const awaitingOutputs = new Set<string>();
const deferredMessages: ChatMessage[] = [];
```

Flush consecutive calls into one assistant message. Do not silently skip unknown item or content types. Add `stream_options: { include_usage: true }` when streaming.

- [ ] **Step 6: Apply validated overrides**

Reject `model`, `messages`, `tools`, `stream`, `authorization`, `base_url`, and URL-shaped keys. Merge other JSON values after standard conversion.

- [ ] **Step 7: Run focused tests**

```bash
pnpm --dir apps/desktop exec tsx --test electron/openai-chat-compat/tool-registry.test.ts electron/openai-chat-compat/request-transformer.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/electron/openai-chat-compat
git commit -m "feat: convert Responses requests to Chat"
```

---

### Task 4: Implement Bounded Conversation History Restoration

**Files:**
- Create: `apps/desktop/electron/openai-chat-compat/history-store.ts`
- Create: `apps/desktop/electron/openai-chat-compat/history-store.test.ts`
- Create: `apps/desktop/electron/openai-chat-compat/history-persistence.ts`
- Create: `apps/desktop/electron/openai-chat-compat/history-persistence.test.ts`

**Interfaces:**
- Produces: `ConversationHistoryStore.recordResponse`, `recordFunctionCall`, `enrichRequest`, `invalidateRoute`, `prune`.
- Produces: user-only, atomically persisted bounded history snapshots.

- [ ] **Step 1: Write failing restoration tests**

Cover:

```ts
await history.recordResponse("route-a", responseWithTwoCalls);
const restored = await history.enrichRequest("route-a", {
  previous_response_id: "resp-a",
  input: [{ type: "function_call_output", call_id: "call-1", output: "ok" }],
});
assert.equal(restored.restoredCount, 1);
```

Also test unique call-ID fallback, ambiguous rejection, route isolation, 512-response LRU, and fifteen-minute TTL.

- [ ] **Step 2: Implement in-memory indexes**

Maintain response order, response-to-call maps, and call-ID-to-response queues per route. Clone stored JSON values. Call-ID fallback succeeds only with exactly one live candidate.

- [ ] **Step 3: Write failing persistence tests**

Persist, recreate the store, and restore a tool call. Assert temporary-file rename and file mode `0o600` on non-Windows platforms. Assert expired entries are not reloaded.

- [ ] **Step 4: Implement debounced atomic persistence**

Use one JSON snapshot per route under `usage-router/chat-history/<routeId>.json`. Serialize only function-call metadata required for restoration; exclude prompts, tool outputs, and API keys.

- [ ] **Step 5: Run focused tests**

```bash
pnpm --dir apps/desktop exec tsx --test electron/openai-chat-compat/history-store.test.ts electron/openai-chat-compat/history-persistence.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/electron/openai-chat-compat/history-*
git commit -m "feat: restore Chat tool call history"
```

---

### Task 5: Implement Arbitrary-Chunk SSE Parsing And Responses Event State Machine

**Files:**
- Create: `apps/desktop/electron/openai-chat-compat/sse-parser.ts`
- Create: `apps/desktop/electron/openai-chat-compat/sse-parser.test.ts`
- Create: `apps/desktop/electron/openai-chat-compat/responses-events.ts`
- Create: `apps/desktop/electron/openai-chat-compat/responses-events.test.ts`
- Create: `apps/desktop/electron/openai-chat-compat/stream-transformer.ts`
- Create: `apps/desktop/electron/openai-chat-compat/stream-transformer.test.ts`
- Create: `apps/desktop/electron/openai-chat-compat/fixtures/streams/*.sse`

**Interfaces:**
- Produces: `SseParser.push/finish`.
- Produces: `transformChatStream(options): ReadableStream<Uint8Array>`.

- [ ] **Step 1: Write failing SSE parser tests**

Feed the same stream one byte at a time, at every possible split point, and as one chunk. Assert identical events for LF, CRLF, comments, multiple `data:` lines, UTF-8 text, and `[DONE]`.

- [ ] **Step 2: Implement incremental parser**

Use `TextDecoder.decode(chunk, { stream: true })`, retain incomplete event text, and emit only after a blank-line terminator. `finish()` flushes decoder state and rejects a non-empty malformed final JSON event.

- [ ] **Step 3: Write event-builder lifecycle tests**

Assert constructors produce ordered Responses events with stable response/item IDs and indexes. The terminal event must include all completed output items and normalized usage.

- [ ] **Step 4: Implement event builders**

Provide named constructors for created, in-progress, message/reasoning/function item added/delta/done, completed, incomplete, failed, and error events. Serialize each as:

```text
event: <type>\n
data: <json>\n
\n
```

- [ ] **Step 5: Write failing stream state-machine tests**

Cover text, explicit `reasoning_content`, leading `<think>`, tool fields arriving arguments-first, two interleaved tool indexes, duplicate finish chunks, usage-only chunks, `[DONE]` without finish reason, abort, and mid-stream malformed JSON.

- [ ] **Step 6: Implement independent item state**

Track:

```ts
interface StreamState {
  responseStarted: boolean;
  text: TextItemState;
  reasoning: ReasoningItemState;
  tools: Map<number, ToolItemState>;
  outputItems: Array<{ index: number; item: unknown }>;
  usage?: ResponsesUsage;
  finishReason?: string;
}
```

Announce a tool item only after both call ID and name are known. Preserve buffered argument order. Ignore a duplicate terminal chunk but reject content after completion.

- [ ] **Step 7: Run focused tests**

```bash
pnpm --dir apps/desktop exec tsx --test electron/openai-chat-compat/sse-parser.test.ts electron/openai-chat-compat/responses-events.test.ts electron/openai-chat-compat/stream-transformer.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/electron/openai-chat-compat/{sse-parser,responses-events,stream-transformer}* apps/desktop/electron/openai-chat-compat/fixtures/streams
git commit -m "feat: translate Chat streams to Responses events"
```

---

### Task 6: Implement Non-Stream Conversion And Upstream Client

**Files:**
- Create: `apps/desktop/electron/openai-chat-compat/response-transformer.ts`
- Create: `apps/desktop/electron/openai-chat-compat/response-transformer.test.ts`
- Create: `apps/desktop/electron/openai-chat-compat/upstream-client.ts`
- Create: `apps/desktop/electron/openai-chat-compat/upstream-client.test.ts`
- Create: `apps/desktop/electron/openai-chat-compat/compatibility-handler.ts`
- Create: `apps/desktop/electron/openai-chat-compat/compatibility-handler.test.ts`

**Interfaces:**
- Produces: `transformChatResponse`.
- Produces: `ChatUpstreamClient.execute`.
- Produces: `handleChatCompatibilityRequest`.

- [ ] **Step 1: Write failing non-stream fixtures**

Cover text, reasoning, one tool, parallel tools, length/content-filter finish reasons, usage details, empty choices, malformed arguments, and provider error envelopes.

- [ ] **Step 2: Implement non-stream conversion**

Return a Responses object containing stable IDs, status mapping, ordered output items, and normalized usage. Use `ToolRegistry` reverse mappings. Empty choices are `UPSTREAM_PROTOCOL`, not an empty successful response.

- [ ] **Step 3: Write failing upstream client tests with a local server**

Verify:

- URL is `<baseUrl>/chat/completions`.
- only allowlisted client headers survive;
- upstream bearer token is injected;
- local route token is never forwarded;
- abort closes the upstream request;
- connection and first-byte timeout errors are typed;
- retry occurs only before response output and only for retryable status/network failures.

- [ ] **Step 4: Implement upstream client**

Use explicit timeout phases and `AbortSignal.any`. Default values:

```ts
const DEFAULT_TIMEOUTS = {
  connectMs: 10_000,
  firstByteMs: 30_000,
  idleMs: 120_000,
  totalMs: 600_000,
};
```

Retry once for connection reset, 408, 429, 502, 503, and 504 before downstream output. Never retry other 4xx responses.

- [ ] **Step 5: Implement compatibility orchestration**

`handleChatCompatibilityRequest` authorizes the local route token, loads the in-memory upstream key, restores history, converts the request, calls upstream, transforms the response, records completed function calls, and returns normalized usage metadata to the router.

- [ ] **Step 6: Run focused tests**

```bash
pnpm --dir apps/desktop exec tsx --test electron/openai-chat-compat/response-transformer.test.ts electron/openai-chat-compat/upstream-client.test.ts electron/openai-chat-compat/compatibility-handler.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/electron/openai-chat-compat
git commit -m "feat: execute Chat compatibility requests"
```

---

### Task 7: Integrate Compatibility Handling Into Usage Router And Manager

**Files:**
- Modify: `apps/desktop/electron/usage-router-service.ts`
- Modify: `apps/desktop/electron/usage-router-service.test.ts`
- Modify: `apps/desktop/electron/usage-router-manager.ts`
- Modify: `apps/desktop/electron/usage-router-manager.test.ts`
- Modify: `apps/desktop/electron/bridge.ts`
- Modify: `apps/desktop/electron/bridge-core-ops.test.ts`

**Interfaces:**
- Produces: `enableAccountCompatibility`, `disableAccountCompatibility`, `getAccountCompatibilityStatuses`, `checkAccountCompatibility`.
- Consumes: compatibility handler and canonical account API key.

- [ ] **Step 1: Write failing native pass-through regression**

Send an exact byte payload and unusual headers through a `responses` route. Assert the upstream receives the original body bytes and `/responses` suffix unchanged.

- [ ] **Step 2: Write failing Chat route integration**

Configure a fake Chat upstream, persisted route metadata, and hydrated secret. Send a Responses streaming tool request through the real router and assert Responses SSE output plus normalized usage storage.

- [ ] **Step 3: Route by protocol**

In `proxyRequest`:

```ts
if (route.protocol === "chat_completions") {
  return handleChatCompatibilityRequest(context);
}
return proxyNativeResponsesRequest(context);
```

Require route-token authorization for Chat routes. Preserve current native route behavior.

- [ ] **Step 4: Add account-level manager methods**

```ts
enableAccountCompatibility(input: RoutableAccount): Promise<AccountRouteStatus>;
disableAccountCompatibility(envName: string, accountName: string): Promise<AccountRouteStatus>;
getAccountCompatibilityStatuses(accountKeys: string[]): Promise<AccountRouteStatus[]>;
checkAccountCompatibility(envName: string, accountName: string): Promise<CompatibilityCheckResult>;
```

Generate route/local tokens with `randomBytes(32)`. Persist only route metadata and the local token in private codex-switcher state. Hydrate upstream secrets after every router start.

- [ ] **Step 5: Make enable/disable transactional**

Enable order: validate, ensure service, persist metadata, hydrate secret, health check, update account runtime, rematerialize active targets. Roll back route and runtime on failure.

Disable order: restore runtime/target files, delete route and secret, invalidate history. If restoration fails, retain the route and mark degraded.

- [ ] **Step 6: Block invalid launches**

Before `switchAccount` starts CLI/App, reject a Chat account unless its route status is `ready` or `degraded` with mandatory probes passing.

- [ ] **Step 7: Run router and bridge tests**

```bash
pnpm --dir apps/desktop exec tsx --test electron/usage-router-service.test.ts electron/usage-router-manager.test.ts electron/bridge-core-ops.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/electron/usage-router-* apps/desktop/electron/bridge.ts apps/desktop/electron/bridge-core-ops.test.ts
git commit -m "feat: manage compatibility routes per account"
```

---

### Task 8: Add Desktop IPC, Account UI, Status, And Compatibility Check

**Files:**
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/src/bridge.ts`
- Modify: `apps/desktop/src/bridge.test.ts`
- Modify: `apps/desktop/src/react-app.tsx`
- Modify: `apps/desktop/src/pages/accounts-page.tsx`
- Modify: `apps/desktop/src/i18n.ts`
- Modify: `apps/desktop/src/components/responsive-layout.test.ts`

**Interfaces:**
- Exposes: account protocol fields in `nativeLogin` and edit flow.
- Exposes: toggle/status/check compatibility bridge methods.

- [ ] **Step 1: Write failing bridge forwarding tests**

Assert preload and browser bridge forward:

```ts
toggleAccountCompatibility(envName, accountName, enabled)
getAccountCompatibilityStatuses()
checkAccountCompatibility(envName, accountName)
```

Also assert `nativeLogin` carries protocol, upstream model, reasoning profile, and validated overrides.

- [ ] **Step 2: Implement IPC contracts**

Use shared serializable types. Never expose upstream API keys in status payloads. Status payload:

```ts
interface AccountCompatibilityStatus {
  accountKey: string;
  state: "stopped" | "starting" | "ready" | "degraded" | "failed";
  checkedAt?: number;
  message?: string;
  capabilities?: CompatibilityCapabilities;
}
```

- [ ] **Step 3: Write failing account-panel source assertions**

Assert protocol selector is click-only, compatibility controls render only for API-key Chat accounts, and the route switch calls account-level rather than environment-level methods.

- [ ] **Step 4: Implement account editor controls**

Add `API protocol` below Base URL. For Chat, render a compact un-nested settings region containing manual route switch, status, upstream model override, reasoning profile, and compatibility check. Disable the check until Base URL, key, and model are available.

- [ ] **Step 5: Add account-list status**

Use restrained neutral/success/error text and existing semantic icons. Do not add a card, large banner, or animated status dot.

- [ ] **Step 6: Implement staged compatibility check UI**

Show one progress row while running and a concise result summary. Detailed probe results live in a dialog opened by `View details`; secrets and tool output are never displayed.

- [ ] **Step 7: Run UI and bridge tests**

```bash
pnpm --dir apps/desktop exec tsx --test src/bridge.test.ts src/components/responsive-layout.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/electron/{main.ts,preload.ts} apps/desktop/src/{bridge.ts,bridge.test.ts,react-app.tsx,i18n.ts} apps/desktop/src/pages/accounts-page.tsx apps/desktop/src/components/responsive-layout.test.ts
git commit -m "feat: configure Chat compatibility per account"
```

---

### Task 9: Add Compatibility Probes, Real Codex Contract Test, Attribution, And Release Verification

**Files:**
- Create: `apps/desktop/electron/openai-chat-compat/compatibility-check.ts`
- Create: `apps/desktop/electron/openai-chat-compat/compatibility-check.test.ts`
- Create: `apps/desktop/electron/openai-chat-compat/fake-chat-model.ts`
- Create: `apps/desktop/electron/openai-chat-compat/codex-e2e.test.ts`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `docs/compatibility/openai-chat-reference-fixtures.md`
- Modify: `apps/desktop/electron/package.test.ts`
- Modify: `apps/desktop/package.json`

**Interfaces:**
- Produces: staged compatibility results and release evidence.

- [ ] **Step 1: Write failing staged-check tests**

The fake upstream controls each stage. Assert mandatory failures (`auth`, `text`, `stream`, `sequential_tool`) produce `failed`; optional parallel/reasoning failures produce `degraded`; all passing produces `ready`.

- [ ] **Step 2: Implement compatibility check**

Run probes sequentially with per-stage abort timeouts and no destructive tool execution. The tool probe uses deterministic functions such as `echo_probe` and returns its result through a second model request.

- [ ] **Step 3: Add deterministic real-Codex test harness**

Start the router and fake Chat model, create a temporary `CODEX_HOME`, write a local Responses provider, and run the installed Codex executable non-interactively. Cover text, one tool, parallel tools, continuation, cancellation, and upstream failure. Skip with an explicit reason only when no Codex binary is installed.

- [ ] **Step 4: Add reference attribution**

Record:

```markdown
- CC Switch, MIT, source commit used for behavioral study.
- CLIProxyAPI, MIT, source commit used for behavioral study.
- Fixture name, source test path, and whether behavior was reimplemented or code was ported.
```

Include full MIT notices for any substantially ported code.

- [ ] **Step 5: Add package assertions**

Assert all compatibility modules compile into `electron-dist` and no external runtime executable is referenced. Add the real-Codex contract command as a separate script so unit tests remain deterministic:

```json
{
  "test:compat": "tsx --test electron/openai-chat-compat/*.test.ts",
  "test:compat:e2e": "CODEX_SWITCHER_RUN_CODEX_E2E=1 tsx --test electron/openai-chat-compat/codex-e2e.test.ts"
}
```

- [ ] **Step 6: Run complete verification**

```bash
pnpm --dir packages/core test
pnpm --dir packages/core build
pnpm --dir apps/desktop test:desktop
pnpm --dir apps/desktop test:compat
pnpm --dir apps/desktop build
CODEX_SWITCHER_RUN_CODEX_E2E=1 pnpm --dir apps/desktop test:compat:e2e
git diff --check
```

Expected: all unit, router, UI, compatibility, real-Codex, and build checks pass. The existing Vite large-chunk warning may remain; no new errors or warnings specific to compatibility routing are allowed.

- [ ] **Step 7: Perform manual macOS smoke test**

Create one Chat-only test account, enable its route, launch CLI and App, complete a tool call, switch to a native Responses account, and verify both target files and account status return to native behavior.

- [ ] **Step 8: Perform Windows packaged smoke test**

Install the NSIS package, repeat enable/launch/tool/switch/disable, and confirm the router child process exits with the app and no firewall prompt appears because it binds only to loopback.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/electron/openai-chat-compat apps/desktop/electron/package.test.ts apps/desktop/package.json THIRD_PARTY_NOTICES.md docs/compatibility
git commit -m "test: verify OpenAI Chat compatibility routing"
```

---

## Plan Self-Review

- Spec coverage: account persistence, manual per-account controls, local target materialization, secret isolation, request/tools/history/stream/non-stream conversion, reasoning, errors, usage, diagnostics, real Codex, macOS, Windows, and attribution are assigned to tasks.
- Type consistency: `AccountApiProtocol`, `ReasoningProfile`, `RouteProtocol`, `RouteTarget`, `RouteRuntimeSecret`, `AccountCompatibilityStatus`, and compatibility bridge method names are defined once and reused.
- Scope: Anthropic/Gemini conversion, account pools, external sidecars, and unrelated router refactors remain excluded.
- Placeholder scan: the plan contains no deferred implementation placeholders; every task names exact files, interfaces, test commands, and acceptance behavior.

