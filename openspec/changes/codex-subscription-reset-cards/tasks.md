## 1. Domain model and upstream client

- [x] 1.1 Add typed reset-card, usage-window, snapshot, error, policy, consumption, and notification contracts shared by Electron main and renderer.
- [x] 1.2 Add canonical subscription-account identity derivation from auth claims/account id/workspace with collision-safe fallback and environment reference mapping.
- [x] 1.3 Implement the Codex subscription HTTP client for usage, reset-credit listing, and consume endpoints using undici proxy support, timeouts, headers, and redacted error classification.
- [x] 1.4 Implement schema-tolerant parsing fixtures for usage windows and reset-credit payloads, including expiry, permanent, unknown, malformed, and unsupported responses.
- [x] 1.5 Add client tests for auth headers, account headers, proxy selection, timeout, 401/403/404/429/5xx handling, idempotency payloads, and token redaction.

## 2. Durable state and settings

- [x] 2.1 Implement versioned atomic subscription state storage for snapshots, consumption ledger, backoff, reminder keys, and pending actions without credentials.
- [x] 2.2 Implement state migration, backup-on-corruption, serialization locking, and recovery diagnostics.
- [x] 2.3 Add global reset-card settings and per-canonical-account overrides with defaults, validation, and migration-safe persistence.
- [x] 2.4 Add settings tests covering defaults, invalid values, migration, corruption recovery, and independent account overrides.

## 3. Background synchronization manager

- [x] 3.1 Implement the main-process SubscriptionQuotaManager lifecycle, account discovery, startup refresh, mutation refresh, focus/resume refresh, and shutdown cleanup.
- [x] 3.2 Add one-flight deduplication, bounded concurrency, minimum read interval, jitter, retry-after handling, exponential backoff, and last-good snapshot retention.
- [x] 3.3 Feed normalized usage data to the existing account metrics path while preserving legacy output and error labels.
- [x] 3.4 Add manager tests with a fake clock and fake client for initial sync, hidden UI, duplicate requests, backoff, resume, stale data, and cross-environment deduplication.

## 4. Consumption and routing safety

- [x] 4.1 Implement manual consume orchestration with confirmation input, per-account mutex, fresh read, selected-card validation, idempotency key, audit record, and post-consume refresh.
- [x] 4.2 Implement weekly-exhausted and expiring-card trigger evaluation with normal-window recovery checks, earliest-expiry selection, permanent-card exclusion, and one-per-window safeguards.
- [x] 4.3 Implement pre-consume grace/confirmation state machine with cancellation, revalidation, ambiguous-result handling, and operation progress events.
- [x] 4.4 Integrate automatic weekly consumption with gateway account-pool candidate admission and one-request retry, without consuming on generic 429 or while a viable fallback exists.
- [x] 4.5 Ensure direct mode only runs explicitly enabled account policies and ensure no external Gateway/Agent endpoint can invoke consumption.
- [x] 4.6 Add concurrency, trigger, routing, idempotency, ambiguous-result, and external-access rejection tests.

## 5. Native notifications

- [x] 5.1 Implement Electron main-process DesktopNotificationService with support/permission status, macOS/Windows/Linux native delivery, click-to-focus routing, and in-app fallback.
- [x] 5.2 Implement expiry, pre-consume, success, failure, sync-error, and reauthentication event builders with safe localized copy and persisted deduplication.
- [x] 5.3 Add notification settings, renderer subscription, focus-account event handling, and notification delivery tests with a mocked Electron Notification.

## 6. IPC and desktop data surface

- [x] 6.1 Extend preload and typed desktop bridge APIs for snapshots, manual refresh, manual consume, settings, notification status, and live snapshot/operation events.
- [x] 6.2 Add main IPC handlers with renderer-input validation and ensure all credential-bearing work stays in the main process.
- [x] 6.3 Extend overview/account payloads and browser-preview fallbacks with reset-card status while preserving existing account metrics behavior.
- [x] 6.4 Add bridge smoke tests for unavailable/browser modes, IPC validation, event delivery, and token-free payloads.

## 7. Accounts UI and settings UI

- [x] 7.1 Add compact reset-card status row to account cards with fresh/stale/loading/empty/unsupported/error states and no false zero state.
- [x] 7.2 Add hover/focus detail popover with card type, expiry, relative countdown, freshness, safe id, last error, refresh, and manual consume actions.
- [x] 7.3 Add subscription quota/reset-card settings section with refresh interval, reminder lead, notification toggle, auto-use mode, grace/confirmation, and copy explaining irreversible use.
- [x] 7.4 Add per-account auto-use override controls and pending-action/cancel/success/failure interaction states without blocking account selection.
- [x] 7.5 Add localized copy, accessibility labels, keyboard behavior, responsive layout, and UI tests for all card and popover states.

## 8. Verification, migration, and delivery

- [x] 8.1 Add end-to-end fake-upstream tests covering startup sync through UI snapshot, expiry notification, automatic consume, re-read, and routing retry.
- [x] 8.2 Add package/build checks for native notification imports, state migration, Windows/macOS/Linux behavior, and no token leakage in logs/artifacts.
- [x] 8.3 Run desktop, gateway, core, and feature-specific tests; fix regressions and document unsupported/private-upstream behavior.
- [x] 8.4 Update CHANGELOG and user-facing help/settings copy, verify release artifacts, and complete a production readiness review.
