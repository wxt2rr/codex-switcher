## Context

The desktop app already owns a detached local router process, persists route metadata and usage in `usage.db`, and rewrites API-key account Base URLs to account-specific local routes. Native Responses routes currently forward the inbound authorization header, while Chat compatibility routes hydrate an upstream key into process memory. There is no environment-level route identity, session affinity, member health, or safe retry boundary.

The pool must work offline, survive router restarts, keep upstream credentials out of SQLite, preserve existing environments that only use single-account routing, and never replay a request after response bytes have reached the client.

## Goals / Non-Goals

**Goals:**

- Provide an opt-in account pool per environment with selected AUTH and API-key members, order, weight, and a shared local route.
- Assign each new logical session using weighted round-robin and retain a healthy assignment for cache and conversation continuity.
- Fail over once for retryable pre-response failures, apply explicit cooldown states, and recover members automatically.
- Support native Responses forwarding and existing Chat compatibility conversion without mixing incompatible pool members.
- Persist configuration, bindings, health snapshots, and audit metadata while hydrating secrets only into router memory.
- Keep enable, restart, account update/delete, disable, and rollback operations transactional.

**Non-Goals:**

- Pooling AUTH/OAuth accounts or refreshing OAuth credentials.
- Retrying after response headers or body bytes have been sent.
- Cross-environment pools, cloud synchronization, or a remote control plane.
- Guaranteeing upstream cache hits; affinity only preserves the conditions needed for them.

## Decisions

### Introduce a first-class environment pool route

A pool is exposed as `/pools/{poolId}` instead of overloading an account route. Pool configuration references member route IDs so protocol conversion and upstream metadata remain reusable. Eligible account runtimes in the environment are materialized with the same pool Base URL and local pool token; disabling the pool restores every original runtime.

Alternative: rewrite an existing account route to fan out. Rejected because route identity, usage attribution, and rollback would remain coupled to an arbitrary entry account.

### Keep configuration and secrets separate

`usage.db` stores pool configuration, members, session bindings, health state, and request audit columns. A router-memory pool secret store maps each member route ID to its upstream API key and maps the pool to a local token. On application/router startup the manager reconstructs members from core state and rehydrates secrets through authenticated admin endpoints.

Alternative: persist encrypted upstream keys in SQLite. Rejected because the application has no OS-keychain-backed encryption lifecycle and existing state already provides the source of truth.

### Use tiered session affinity

The dispatcher derives a session key in this order: an explicit supported session/conversation header or body identifier; a known `previous_response_id` mapping; a stable hash of the model and bounded initial conversation content; and finally the selected entry account. Successful upstream response IDs are mapped back to the same member. Bindings expire after a configurable TTL and are refreshed on use.

New sessions use smooth weighted round-robin among healthy members. A valid existing binding always wins over balancing while its member is eligible.

Alternative: round-robin every request. Rejected because it breaks conversation continuity and reduces upstream prompt-cache reuse.

### Retry only before client-visible output

The router buffers upstream response headers until the upstream request resolves. It may retry once on transport failures, timeouts, 408, 425, 429, selected quota/auth failures, and 5xx responses. It does not retry validation/model errors and never retries once any body bytes are relayed. Compatibility conversion follows the same rule at the upstream execution boundary.

Retryable HTTP responses are drained/discarded before the fallback attempt. The final response is relayed unchanged. Every attempt is recorded, but only the final client request contributes one logical request record.

### Model member health as a small state machine

Members move through `healthy`, `degraded`, `cooldown`, `exhausted`, `unauthorized`, and `disabled`. Retry-After controls cooldown when present; otherwise repeated failures use 30 seconds, 2 minutes, and 10 minutes. A successful probe/request resets transient failure counters. Unauthorized members require secret rehydration or user correction; quota exhaustion may recover at an explicit reset time or conservative cooldown.

Health is evaluated lazily during dispatch and persisted after transitions. No startup-blocking remote health check is required.

### Enforce member compatibility before activation

Members must belong to the same environment and have compatible protocol/model routing. Native Responses pools may combine ChatGPT AUTH and API-key members. Chat compatibility pools remain API-key only. Invalid or missing accounts are rejected on save; deleting or mutating a member triggers atomic resynchronization. A pool with no eligible member returns a structured 503 response.

### Extend usage records with routing audit fields

The logical request stores `pool_id`, entry account, selected/final account, attempted account list, attempt count, failover reason, and session-key hash. Raw session identifiers and keys are never persisted. Usage tokens and costs are attributed to the final upstream account and Base URL.

## Risks / Trade-offs

- [Ambiguous session identity] → Use tiered derivation, expose the derived binding source in diagnostics, and allow a conservative entry-account fallback.
- [Duplicate side effects] → Retry at most once and only before any client-visible bytes; never replay a partially streamed response.
- [Pool secret unavailable after detached-router restart] → Report degraded state and rehydrate during application startup before marking the pool ready.
- [All members exhausted] → Return structured 503 with member summaries and the earliest known recovery time; do not spin or retry indefinitely.
- [Compatibility conversion keeps per-route history] → Keep history keyed by member route and persist the session-to-member binding so follow-up tool calls stay on the same converter history.
- [Schema migration corrupts usage data] → Add idempotent additive migrations and test legacy database loading.

## Migration Plan

1. Add additive pool and audit tables/columns; existing route rows remain valid.
2. Bump the local router API version so stale processes restart before new admin calls.
3. Ship the pool disabled by default. Existing environment routing behavior remains unchanged until a pool is explicitly saved and enabled.
4. On enable, validate and hydrate the full pool before rewriting account runtimes. Roll back route metadata and all runtime files on any failure.
5. On disable or rollback, restore stored original Base URLs/tokens and leave historical usage records intact.

Rollback is disabling/deleting the pool and restoring legacy per-account routing. Database additions are retained and ignored by older code.

## Open Questions

None blocking. Cross-protocol pools remain excluded. AUTH credentials and optional ChatGPT account IDs are hydrated only in router memory and refreshed from core account state during application synchronization.
