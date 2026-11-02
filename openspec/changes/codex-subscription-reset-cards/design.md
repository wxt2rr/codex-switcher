## Context

The desktop app already owns environment/account credentials, can resolve each account's `auth.json`, and has a cached usage collector that calls Codex's `/backend-api/wham/usage`. The gateway has provider adapters and account-pool health/failover, but its generic `readQuota` contract only understands request/token counters and cannot model subscription reset credits. The renderer receives account summaries through the preload bridge; the Electron main process is the only safe place to read credentials and perform a destructive reset-card consume.

Codex reset cards are exposed by private ChatGPT subscription endpoints. The implementation must tolerate missing fields and upstream changes, keep bearer tokens out of renderer/state/logs, and never expose a consume operation through the local Agent/Gateway API. The feature must work when the gateway is stopped, while gateway mode adds request-aware automatic-use decisions.

## Goals / Non-Goals

**Goals:**

- Read normal usage windows and reset-card metadata for every eligible subscription account.
- Deduplicate identical accounts across environments and persist a redacted, versioned snapshot.
- Refresh in the main process with bounded concurrency, cache, backoff, manual refresh throttling, and wake/focus recovery.
- Display count, per-card expiry/type/status, freshness, and actionable errors in the Accounts page.
- Support configurable expiry reminders and native macOS, Windows, and Linux notifications with an in-app fallback.
- Support explicit per-account automatic-use policies for weekly exhaustion and expiring cards, with a pre-use notification/grace period, revalidation, idempotency, locks, audit history, and post-consume refresh.
- Integrate weekly exhaustion with gateway account-pool candidate evaluation without consuming a card while another viable account can answer.
- Provide manual consume only from the trusted desktop UI, with confirmation and an explicit selected-card option.
- Cover migrations, parsing, scheduling, concurrency, notifications, routing, and failure recovery with automated tests.

**Non-Goals:**

- Making reset-card consumption available to API-key providers, relays, plugins, external Agent clients, or remote gateway keys.
- Guaranteeing compatibility with undocumented upstream endpoints after Codex changes them; unsupported responses must degrade safely and be diagnosable.
- Automatically changing Codex's own subscription settings, billing, or purchased credits.
- Treating a normal five-hour/weekly window reset as a consumed reset card.

## Decisions

### 1. Dedicated subscription client instead of extending generic provider quota

Add a `CodexSubscriptionClient` in Electron main with typed methods for usage, reset-card listing, and consumption. It will share auth-file resolution, account-id extraction, proxy resolution, timeout, and HTTP error handling with the existing metrics path. The generic gateway `ProviderAdapter.readQuota` remains unchanged for API-key providers. This avoids forcing a destructive, multi-step subscription operation into a generic quota contract.

The client will use `undici` with the existing upstream proxy abstraction, send `Authorization`, `ChatGPT-Account-Id`, `Accept`, `User-Agent`, and JSON content headers, and never return tokens. Unknown fields are ignored; known fields are normalized into a stable internal model. A 401/403 is `unauthorized`, 404 or missing credit data is `unsupported`, 429 is `rate-limited`, and transport/5xx errors are retryable.

### 2. Canonical account identity and durable state

Use a canonical key built from provider kind, ChatGPT account id, workspace/team id when present, and a stable hash of the account token only as a collision fallback. Environment/account names are references, not identity. A dedicated versioned `codex-subscription-state.json` store is preferable to the gateway usage database because the scheduler must run without starting the gateway. Writes are atomic and serialized; the store contains snapshots, consumption ledger, reminder dedupe keys, scheduler backoff, and settings, but never tokens.

Snapshots keep the full safe card metadata (`id` is hashed for display/logging, raw id stays only in protected local state), counts, expiry, reset type, observed time, source, and error state. A migration version allows fields to be added without invalidating older installations.

### 3. Main-process scheduler with one-flight and backoff

Create a `SubscriptionQuotaManager` owned by the Electron main process. It performs an initial refresh, reacts to account/auth mutations, runs a five-minute bounded poll, and rechecks on app focus/system resume. Each canonical account has a one-flight promise, a minimum 30-second read interval, jitter, and exponential backoff (5m, 15m, 30m, 1h) for failures. Manual refresh has the same provider-safe cooldown. UI visibility must not control correctness.

The manager publishes snapshot events over IPC and keeps the last good snapshot visible during transient failures, with explicit stale/error status. The existing one-minute usage cache remains for the legacy usage display but is fed from the same normalized usage response where possible.

### 4. Automatic-use policy and routing integration

Policies are global defaults plus canonical-account overrides. Automatic use is off by default and supports `weekly-exhausted`, `expiring`, or `both`. Weekly use is allowed once per weekly window and only after the gateway has evaluated all viable candidates; direct mode may use it only for an explicitly enabled active account because no gateway candidate set exists. Expiring use selects the earliest expiring available card, requires a used window, and only spends when normal recovery will not make the account usable before the card expires. Permanent cards are never selected by the expiring rule.

Before a consume, the manager takes a per-account lock, fetches usage and cards again, recomputes the trigger, and creates a random idempotency key. It sends a notification and honors a configurable 30-second grace period (or a user-selected confirmation mode), then revalidates once more. Consumption uses the selected card id when known, records the result and request id, invalidates the snapshot, and reads usage/cards again. A failed or ambiguous response never retries with a different card automatically.

Gateway integration is a single retryable admission hook: when a candidate is held solely because its usage is exhausted and no other candidate can answer, the manager may perform the policy check and consume once, then retry the same request once. It must not consume on a generic first 429, on an API-key route, or while another candidate is healthy. Direct mode uses only the background policy and explicit account selection.

### 5. Notifications as a cross-platform service

Add a main-process `DesktopNotificationService` using Electron `Notification`, with support detection, permission/status reporting, click-to-focus account routing, and in-app notice fallback. Notification events are typed (`expiring`, `pre-consume`, `consumed`, `failed`, `sync-error`, `reauth-required`) and deduplicated by canonical account/card/event threshold. Expiry reminders and pre-consume notifications are independently configurable. No notification contains tokens or full opaque credit ids.

### 6. UI and settings

Add a compact reset-card row to each auth account card with count/status and a hover/focus popover. The popover lists card type, relative/exact expiry, safe short id, freshness, and last error; it includes a throttled refresh action. Settings get a dedicated “Subscription quota and reset cards” section for polling, expiry reminder lead, system notifications, auto-use mode, pre-use behavior, and defaults. Account actions can override auto-use and expose a manual “Use reset card” confirmation. Unsupported/API-key accounts remain visually neutral and are not presented as failures.

### 7. Testing and safe rollout

Use a fake upstream server for usage/list/consume responses, including malformed, unauthorized, rate-limited, and delayed cases. Test parsing fixtures against Magpie-shaped payloads, scheduler fake-clock transitions, deduplication across environments, per-account locks, idempotency, notification suppression, routing retry, and migration. No test uses a real account or writes a real auth file. Existing browser-preview bridge mocks receive deterministic no-op snapshots and notifications.

## Risks / Trade-offs

- **[Private upstream API changes]** → Version the wire parser, classify unsupported responses distinctly, keep last good data, surface a diagnostic, and never consume on an unknown response.
- **[Accidental irreversible consumption]** → Default auto-use off, per-account opt-in, explicit policy, pre-use notification/grace or confirmation, re-read before consume, per-account lock, idempotency, and audit trail.
- **[Duplicate accounts in multiple environments]** → Canonical account identity and one-flight manager; update every environment reference from one snapshot.
- **[Notification spam]** → Persist event keys, minimum intervals, state-change detection, and one notification per card/threshold.
- **[Proxy/platform differences]** → Reuse the existing undici proxy path and test HTTP, HTTPS, SOCKS5, macOS, Windows, and Linux separately.
- **[App not running or machine asleep]** → Poll on startup/resume and report that background reminders require the app or launch-at-login to be active; never claim a notification was delivered when it was not.
- **[Gateway request race]** → Serialize consumption, revalidate under lock, retry the request at most once, and preserve the original upstream error if consumption is ambiguous.
- **[State migration failure]** → Treat unreadable state as empty with a backup, preserve the previous file, and show a recoverable diagnostic rather than deleting it.

## Migration Plan

1. Ship the state store and parser with automatic-use disabled; existing accounts continue using the current usage flow.
2. On first run, import no secrets and create only empty snapshot/settings state. Existing usage metrics remain compatible.
3. Add UI and background reads; unsupported accounts show an explicit neutral state.
4. Enable manual consume behind confirmation after read/parse tests pass.
5. Enable per-account automatic-use settings only after scheduler, routing, and notification tests pass. Existing users never have auto-use silently enabled.
6. On rollback, stop the manager, leave snapshots as inert local state, and continue legacy usage polling. No auth or Codex config files are modified by this feature.

## Open Questions

- Whether the first release should expose a user-configurable expiry lead below 30 minutes; the scheduler will enforce a five-minute minimum polling cadence regardless.
- Whether the native notification permission status should be shown in Settings or only when the user enables notifications; the service API supports both without changing persistence.
