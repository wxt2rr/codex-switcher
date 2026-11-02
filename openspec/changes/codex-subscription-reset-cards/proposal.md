## Why

Codex/ChatGPT subscription accounts can hold vendor-issued rate-limit reset credits, but codex-switcher currently reads only the normal five-hour and weekly usage windows. Users therefore cannot see how many reset cards they have, when they expire, or safely use them when an account is exhausted. The app also has no background subscription-quota monitor or native system notification channel, so important expiry and automatic-consumption events are easy to miss.

## What Changes

- Add a production-grade Codex subscription client that reads usage windows and reset-credit metadata from the authenticated account, with proxy support, timeouts, backoff, schema-tolerant parsing, and redacted diagnostics.
- Persist account-scoped reset-card snapshots, refresh state, consumption history, idempotency records, and notification deduplication state without persisting access tokens.
- Run a main-process background scheduler that synchronizes eligible subscription accounts on startup, account mutations, a bounded interval, and system-resume/focus events.
- Show reset-card count and a keyboard-accessible detail popover on account cards, including card type, id-safe label, expiry, status, freshness, and actionable error states.
- Add configurable expiry reminders, automatic-consumption triggers, per-account overrides, pre-consumption notification/grace behavior, and a manual consume flow with confirmation.
- Add native macOS, Windows, and Linux desktop notifications with an in-app fallback, click-to-focus behavior, throttling, deduplication, and permission/support status.
- Integrate automatic consumption with gateway account-pool admission and failover so a reset is considered only after current candidates are re-evaluated; direct-mode expiry handling remains safe and explicit.
- Re-read usage and reset cards before every destructive consume, use an idempotency key, serialize per-account operations, refresh routing state after success, and emit audit/operation records.
- Add migrations, fixtures, unit/integration tests, fake upstream tests, cross-platform notification tests, and failure/recovery coverage.

## Capabilities

### New Capabilities

- `codex-reset-card-management`: Read, display, consume, and automatically manage Codex subscription reset cards with explicit safety rules.
- `subscription-quota-sync`: Persist and refresh subscription usage/reset snapshots with deduplicated account identity, caching, backoff, and recovery.
- `desktop-system-notifications`: Deliver cross-platform native notifications with preferences, deduplication, click handling, and in-app fallback.
- `reset-card-account-ui`: Expose reset-card status, details, manual refresh, settings, and account-level auto-use controls in the desktop UI.

### Modified Capabilities

- None.

## Impact

- Electron main process, preload bridge, desktop settings/state persistence, account overview payloads, account page, settings page, operation/audit reporting, and gateway account-pool routing.
- Existing profile usage collection and provider quota abstractions will gain a shared subscription-specific path; generic API-key providers remain unchanged.
- New private upstream calls require the existing Codex auth files, account identifiers, and configured usage proxy. Reset-card consumption remains local-admin-only and is never exposed through the external Agent/Gateway API.
- No new runtime service is required; the feature runs inside the existing Electron main process and survives restarts through versioned local state.
