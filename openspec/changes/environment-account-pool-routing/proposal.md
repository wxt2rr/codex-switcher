## Why

An environment currently routes each API-key account independently, so an exhausted, rate-limited, or unavailable account interrupts a Codex session until the user switches manually. Environments need an opt-in account pool that preserves session affinity for cache efficiency and fails over safely when the selected account cannot accept a request.

## What Changes

- Add an environment-scoped account pool with explicit member selection, ordering, weights, and enablement.
- Route new sessions across eligible members while keeping an established session on the same healthy account.
- Detect retryable transport, authentication, quota, rate-limit, and upstream failures; cool down unhealthy members and retry at most once before any response bytes are emitted.
- Persist pool configuration, session bindings, health state, and failover audit metadata without persisting upstream secrets in the routing database.
- Add environment UI for pool configuration and live member health, plus request-detail fields for selected account, attempted accounts, and failover reason.
- Keep existing single-account routes compatible and allow Responses pools to combine ChatGPT AUTH and API-key accounts while preserving each member's native upstream authentication.

## Capabilities

### New Capabilities
- `environment-account-pools`: Environment-scoped pool configuration, member eligibility, sticky assignment, lifecycle synchronization, and desktop management UI.
- `resilient-account-routing`: Safe retry classification, member health/cooldown state, protocol-aware forwarding, and failover limits.
- `account-routing-observability`: Per-attempt usage attribution, failover audit data, health status, and request-detail filtering/display.

### Modified Capabilities

None.

## Impact

- Extends the local usage router model, SQLite schema, manager/admin API, secret hydration, and request forwarding pipeline.
- Extends Electron bridge/preload contracts and the environment and usage request-detail pages.
- Changes environment route activation so opted-in accounts can share a pool endpoint while preserving legacy per-account routes for environments without a pool.
- Requires schema migration and regression coverage for streaming, retry boundaries, process restart, account mutation, and route disable/restore behavior.
