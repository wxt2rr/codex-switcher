# Subscription reset cards - production implementation

## Goal
- Deliver a production-grade Codex subscription reset-card feature across the Electron main process, typed IPC bridge, account/settings UI, notifications, persistence, scheduler, automatic consumption, and gateway admission safeguards.

## Why Complex
- Crosses Electron main/preload/renderer, private upstream HTTP, durable state, gateway routing, native notifications, UI, and automated verification.
- Requires concurrency, idempotency, migration, platform-specific behavior, and security boundaries.

## Scope
- Related modules: `apps/desktop/electron`, `apps/desktop/src`, existing gateway/account routing, OpenSpec change `codex-subscription-reset-cards`.
- Compatibility: existing account metrics and gateway APIs remain unchanged; reset-card consume is desktop-only and token-free in renderer/state.

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Domain model and upstream client | reset-card model, identity utils, subscription client | Electron typecheck and focused tests | done | `npm run desktop:build`; 13 focused tests passed, including identity, proxy forwarding, HTTP classification, parser fixtures, idempotency, and redaction. |
| 2 | Durable state and settings | subscription state store | Focused state tests | done | `codex-subscription-state.test.ts`: 5 tests passed, including multi-instance serialization, unsupported-version backup diagnostics, migration, corruption recovery, and per-account settings. |
| 3 | Background synchronization manager | quota manager, account discovery | Manager tests + typecheck | done | `subscription-quota-manager.test.ts`: 5 tests passed for one-flight, stale/backoff/retry-after, cross-environment dedupe, mutation refresh, and normalized usage callbacks; Electron main wires focus/resume hooks. |
| 4 | Consumption and routing safety | policy, manager, gateway admission | Policy/routing tests | done | Policy, per-account mutex, confirmation-required IPC, pending cancellation, gateway admission guard, and external-route rejection tests pass. |
| 5 | Native notifications | notification service and main lifecycle | Notification unit tests | done | Native/fallback delivery, click routing, safe event copy, persisted manager dedupe, and mocked Notification tests pass. |
| 6 | IPC and desktop data surface | preload, bridge, main handlers | Bridge smoke/typecheck | done | Typed preload/main/renderer APIs, strict IPC validation, browser-safe fallbacks, live events, and token-free bridge smoke tests; desktop build passed. |
| 7 | Accounts and settings UI | React views/components/styles | Web typecheck/UI tests | done | Account status/detail popover, refresh/consume/pending controls, per-account policy overrides, settings copy, accessibility states, and responsive/UI assertions; desktop full suite passed. |
| 8 | Integration, migration, delivery | E2E fixtures, changelog, build checks | Full test/build suite | done | Fake-upstream E2E, gateway admission replay, notification/security tests, cross-platform suite, core/gateway builds, desktop build, and 581-test desktop suite (580 passed, 1 explicit installed-Codex E2E skip). |

## Rules
- Only one task is `in_progress` at a time.
- Every completed task must include executed verification evidence.
- Do not persist or expose access/refresh tokens or raw reset-credit ids outside protected main-process state.
- Do not expose reset-card consumption through Gateway/Agent HTTP endpoints.
