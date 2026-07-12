# OpenAI Chat Compatibility Router Design

## Goal

Allow an API-key account whose upstream only implements OpenAI Chat Completions to run current Codex CLI and Codex App clients, which require the Responses API, without introducing an external proxy product or a second source of account configuration.

The implementation owns the compatibility behavior inside codex-switcher. OpenAI's published API shapes are the protocol baseline. CC Switch and CLIProxyAPI are MIT-licensed implementation references for Codex-specific edge cases and upstream compatibility behavior.

## Scope

The first version supports one conversion path:

```text
Codex Responses request
  -> codex-switcher account route
  -> OpenAI Chat Completions request
  -> Chat response or SSE stream
  -> Responses response or SSE stream
  -> Codex
```

Included:

- API-key accounts with an explicit `chat_completions` upstream protocol.
- Per-account manual compatibility-route enablement.
- Streaming and non-streaming requests.
- Text and image input supported by Chat Completions.
- Function, custom, namespace, and tool-search tool adaptation.
- Sequential and parallel tool calls.
- Multi-turn tool-result restoration.
- Reasoning metadata and leading `<think>` compatibility profiles.
- Model mapping, request overrides, usage conversion, cancellation, timeout, upstream errors, and diagnostics.
- macOS and Windows desktop builds.

Excluded:

- Anthropic Messages, Gemini, Grok, or other protocol conversion.
- OAuth-backed AUTH accounts.
- Responses built-in tools that cannot be represented as local function tools.
- A promise of lossless conversion outside the intersection of Responses and Chat Completions.
- Importing CLIProxyAPI account pools, OAuth, management UI, plugins, or update system.

## User Model

An API-key account gains these persisted fields:

```ts
type AccountApiProtocol = "responses" | "chat_completions";

interface CompatibilityRouteSettings {
  enabled: boolean;
  upstreamModel?: string;
  reasoningProfile: "auto" | "standard" | "reasoning_content" | "think_tags";
  requestOverrides?: Record<string, unknown>;
}
```

Defaults:

- `apiProtocol` defaults to `responses` for existing and new accounts.
- `compatibilityRoute.enabled` defaults to `false`.
- `reasoningProfile` defaults to `auto`.
- `upstreamModel` defaults to the selected catalog model slug.

The compatibility switch is available only when:

- the account uses API-key authentication; and
- `apiProtocol === "chat_completions"`.

Selecting Chat Completions does not silently start routing. The account remains saved but cannot launch Codex through that account until the user explicitly enables the compatibility route.

## Interaction Design

The account add/edit panel adds an `API protocol` selector below Base URL:

- `Responses API` with the description `Native Codex protocol`.
- `Chat Completions` with the description `Requires compatibility routing`.

When Chat Completions is selected, a compact compatibility section appears:

- A manual `Compatibility route` switch.
- A status line: `Stopped`, `Starting`, `Ready`, `Degraded`, or `Failed`.
- An optional upstream model override.
- A reasoning profile selector under advanced settings.
- A `Run compatibility check` command.

The account list shows one restrained status label only for Chat accounts:

- `Compatible` when the route is healthy.
- `Route off` when manually disabled.
- `Route error` when startup or health checks fail.

Launching CLI or App with a Chat account whose route is disabled or unhealthy is blocked before target files are changed. The error explains the required action and links back to account editing. There is no silent direct fallback to the Chat endpoint.

## Ownership And Persistence

The canonical account, key, Base URL, protocol, model bindings, and compatibility settings remain in codex-switcher state.

Runtime routes and conversation history are derived data:

```text
codex-switcher account state
  -> route registry
  -> local target config/auth materialization
  -> in-memory and bounded on-disk conversation state
```

No generated route configuration is editable outside codex-switcher. Upstream API keys are never written into route URLs, logs, notices, or model catalog files.

## Architecture

The existing usage router becomes an account-aware protocol gateway. It keeps native pass-through behavior and delegates Chat routes to a compatibility engine.

```text
UsageRouterService
├── RouteRegistry
├── RouteSecretStore
├── NativeResponsesForwarder
├── ChatCompatibilityHandler
│   ├── ResponsesRequestTransformer
│   ├── ToolRegistry
│   ├── ConversationHistoryStore
│   ├── ChatUpstreamClient
│   ├── ChatStreamParser
│   ├── ResponsesEventBuilder
│   └── ChatResponseTransformer
├── UsageRecorder
└── RouteDiagnostics
```

Each component has one responsibility:

- `RouteRegistry`: resolves a route ID to one account and rejects disabled or stale routes.
- `RouteSecretStore`: keeps upstream API keys in memory and accepts hydration only through the authenticated loopback admin channel.
- `NativeResponsesForwarder`: preserves the current byte-for-byte forwarding path.
- `ResponsesRequestTransformer`: converts supported Responses inputs and parameters into Chat messages and options.
- `ToolRegistry`: creates stable mappings between Responses tools and Chat function names.
- `ConversationHistoryStore`: restores prior assistant tool calls required by Chat providers.
- `ChatUpstreamClient`: handles headers, abort propagation, timeouts, and upstream HTTP behavior.
- `ChatStreamParser`: incrementally parses arbitrary SSE and UTF-8 chunk boundaries.
- `ResponsesEventBuilder`: owns Responses event ordering and item lifecycle invariants.
- `ChatResponseTransformer`: converts non-streaming responses into Responses objects.
- `UsageRecorder`: records normalized usage after conversion.
- `RouteDiagnostics`: records redacted compatibility failures and health state.

Protocol code is separated from Electron IPC and React UI. Pure transformers accept and return typed values and have no filesystem, network, or global-state dependencies.

## Route Data Model

The existing route record is extended instead of creating a second router database:

```ts
interface RouteTarget {
  routeId: string;
  envName: string;
  accountName: string;
  upstreamBaseUrl: string;
  originalBaseUrl: string;
  enabled: boolean;
  protocol: "responses" | "chat_completions";
  upstreamModel?: string;
  reasoningProfile?: "auto" | "standard" | "reasoning_content" | "think_tags";
  requestOverrides?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}
```

The route ID remains deterministic for one environment, account, and upstream Base URL. Protocol changes update the route and invalidate its conversation history.

## Target Materialization

When an enabled Chat account becomes the CLI or App target:

- `config.toml` uses a generated local provider.
- The provider Base URL points to `/routes/<routeId>/v1`.
- `wire_api` is always `responses`.
- The target auth file contains a generated local route token, not the upstream API key.
- The Electron main process reads the upstream key from canonical account state and hydrates `RouteSecretStore` after router startup.
- Route metadata may persist in the usage database, but upstream keys never do.
- A restarted router reports Chat routes as `Starting` until their secrets have been rehydrated.
- `model_catalog_json` remains responsible only for model visibility.

When compatibility routing is disabled or the account switches back to native Responses, target materialization restores the normal upstream Base URL and API key behavior.

## Request Conversion

The request transformer supports:

- `instructions` as the leading system message.
- String input and typed message input.
- `input_text`, `output_text`, and `input_image` content.
- Assistant message reconstruction.
- Consecutive function calls grouped into one assistant `tool_calls` message.
- Function outputs emitted as adjacent `tool` messages.
- Deferred regular messages while required tool outputs are pending.
- `max_output_tokens` mapped according to the upstream model profile.
- `temperature`, `top_p`, `stream`, `parallel_tool_calls`, and supported Chat passthrough options.
- Responses tool choice converted to Chat function choice.
- Request overrides applied after conversion with protected fields that cannot be overridden.

Protected fields are `model`, `messages`, `tools`, `stream`, and authentication headers. Invalid overrides fail validation when the account is saved.

Unsupported Responses input items produce a typed compatibility error. They are not silently dropped.

## Tool Conversion

Tool mappings are request-scoped and preserved for the response conversion.

- Responses function tools map directly to Chat function tools.
- Namespace children are flattened into collision-safe names and restored on output.
- Custom tools become function tools with a required raw-string `input` field.
- Tool search becomes a compatibility function with query and limit fields.
- Tool names are normalized to the Chat provider limit and receive a deterministic hash suffix when truncated.
- Duplicate normalized names fail request conversion instead of selecting an arbitrary tool.
- Tool arguments are accumulated as text, canonicalized only after a complete JSON value is available, and otherwise preserved verbatim.

## Conversation History

Chat providers commonly require this adjacency:

```text
assistant(tool_calls)
tool(tool_call_id)
```

Codex may send only `previous_response_id` and new function outputs. The history store therefore records completed function-call items by:

- response ID;
- call ID; and
- route ID.

On a later request it restores missing assistant function-call items before conversion. A call-ID fallback is used only when it uniquely identifies one cached call in the same route.

History requirements:

- Per-route isolation.
- Maximum 512 completed responses per route.
- LRU eviction.
- Fifteen-minute idle expiry.
- Atomic bounded persistence so App or CLI restarts can continue a tool loop.
- Protocol, Base URL, API-key fingerprint, or model-binding changes invalidate affected history.
- Raw API keys, full prompts, and tool outputs are not written to diagnostic logs.

## Streaming State Machine

The stream parser accepts arbitrary byte boundaries, including:

- partial UTF-8 characters;
- partial SSE fields;
- multiple events in one chunk;
- CRLF or LF separators;
- `data:`-only Chat streams; and
- a final `[DONE]` marker.

The Responses event builder emits a valid lifecycle:

1. `response.created`
2. `response.in_progress`
3. zero or more item-added and delta events
4. item-done events
5. `response.completed`, `response.incomplete`, or `response.failed`

Text, reasoning, and every parallel tool call have independent state. Tool-call deltas may deliver ID, name, and arguments in any order. A function-call item is announced only after the call ID and function name are known. Buffered arguments are then emitted without reordering.

Client cancellation aborts the upstream fetch and closes the downstream stream without emitting a false completed event. Upstream disconnects before a terminal event produce `response.failed` when headers have already been sent, or an HTTP compatibility error when they have not.

## Reasoning Compatibility

Reasoning is provider-specific and never assumed to be lossless.

- `standard`: no provider-specific reasoning field is sent or interpreted.
- `reasoning_content`: maps Responses reasoning effort and consumes `reasoning_content` deltas.
- `think_tags`: detects one leading `<think>...</think>` block and separates it from answer text.
- `auto`: selects a known profile from model/provider metadata, otherwise uses `standard`.

Reasoning summaries become Responses reasoning items. Missing or unsupported encrypted reasoning is never fabricated. Encrypted content is omitted with a diagnostic capability marker rather than replaced with placeholder text.

## Upstream Behavior

The upstream client:

- posts to `<baseUrl>/chat/completions` after normalizing trailing slashes;
- forwards only allowlisted headers;
- injects the account API key as a bearer token;
- requests `stream_options.include_usage` for streaming calls;
- uses configurable connection, first-byte, idle, and total timeouts;
- retries only before downstream output begins;
- never retries validation, authentication, or other deterministic 4xx failures;
- preserves upstream request IDs in redacted diagnostics; and
- maps upstream error envelopes into Responses-compatible errors.

The first release does not load-balance multiple keys or models. Reliability features must not obscure which account the user selected.

## Security

- The gateway listens only on `127.0.0.1`.
- Each route uses a generated local bearer token.
- Route tokens are compared in constant time.
- The upstream API key never reaches the Codex process while compatibility routing is enabled.
- Upstream API keys exist in the router process only in memory and are cleared when a route is disabled or replaced.
- Request and response bodies are excluded from normal logs.
- Diagnostic exports redact authorization, API keys, route tokens, image data URLs, and tool outputs.
- Runtime state files use user-only permissions where supported.
- Requests cannot select another route by changing the model name.
- Request overrides cannot modify destination URL or authentication.

## Failure And Recovery

Route startup is transactional:

1. Validate account configuration.
2. Persist the route.
3. Verify router health.
4. Materialize local target files if the account is active.
5. Mark the route ready.

Failure rolls back the generated route and leaves the prior target files intact.

Disabling a route restores active target files before deleting runtime route state. If restoration fails, the route remains enabled and reports a degraded state so the account never points at a removed local endpoint.

## Compatibility Check

The manual check performs staged, non-destructive probes against the selected account and model:

1. Authentication and model availability.
2. Non-streaming text.
3. Streaming text and usage.
4. One function call.
5. Tool result continuation.
6. Two parallel function calls when enabled by the model catalog.
7. Reasoning-field behavior for the selected profile.

Results are recorded per account as capabilities, timestamps, latency, and redacted failure reasons. A failed optional probe marks the route degraded; failed authentication, text streaming, or sequential tool use marks it failed.

## Test Strategy

### Pure Contract Tests

Golden fixtures cover:

- every supported Responses input item;
- request parameters and protected overrides;
- function, custom, namespace, and tool-search conversion;
- sequential and parallel tools;
- tool-call deltas arriving in every field order;
- arbitrary SSE and UTF-8 chunk boundaries;
- reasoning profiles;
- usage and finish-reason mapping;
- non-streaming output;
- malformed upstream chunks;
- timeout, cancellation, and disconnect behavior; and
- unsupported item failures.

### History Tests

- `previous_response_id` restoration.
- Unique call-ID fallback.
- ambiguous call-ID rejection.
- route isolation.
- restart persistence.
- LRU and TTL eviction.
- invalidation after account configuration changes.

### Router Integration Tests

An in-process fake Chat server verifies exact outgoing requests and returned Responses streams through the real HTTP router.

### Codex End-To-End Tests

A deterministic fake Chat model drives a real installed Codex CLI through:

- one text turn;
- one shell tool call;
- parallel tool calls;
- a multi-turn tool result;
- cancellation; and
- an upstream failure.

The test asserts that Codex completes without protocol parsing errors and that no upstream key appears in target files or logs.

### Reference Regression

Behavioral fixtures derived from public CC Switch and CLIProxyAPI tests are recorded with source repository, commit hash, license, and local expected behavior. The implementation does not depend on either project at runtime.

## Attribution

The repository adds a third-party notice identifying:

- CC Switch: `https://github.com/farion1231/cc-switch`, MIT License.
- CLIProxyAPI: `https://github.com/router-for-me/CLIProxyAPI`, MIT License.

Any substantially ported code retains the applicable copyright and license header. Source commit hashes are recorded when fixtures or algorithms are imported.

## Success Criteria

- A Chat-only API-key account can complete real Codex text and tool workflows through the local route.
- Native Responses accounts remain byte-for-byte pass-through routes.
- Compatibility routing is manually controlled per account.
- Accounts with identical model slugs cannot cross-route requests or credentials.
- Streaming output obeys Responses event lifecycle invariants under arbitrary chunking.
- Multi-turn and parallel tool calls survive CLI/App restarts within the history retention window.
- No upstream API key appears in Codex target configuration, route URLs, notices, or logs while routing is enabled.
- macOS and Windows builds require no Go, Rust, Python, Docker, or separately installed proxy.
- The full core and desktop test suites and the new protocol contract suite pass before release.
