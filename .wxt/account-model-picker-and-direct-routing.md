# Gateway account model fallback picker and direct routing

## Goal
- When model discovery fails, let the user select any model already in the catalog and bind a provider-scoped copy to the current account. Keep the source catalog record unchanged and provide a help affordance that opens Models.
- When account pooling is disabled, send a Gateway request to its selected route without route cooldown or fallback attempts. Keep pool health/cooldown behavior inside pool requests.

## Why Complex
- Crosses the model catalog store, Electron bridge, account exposure UI, app navigation, and Gateway routing behavior.
- Changes persisted model bindings and request routing semantics.

## Scope
- Related modules/classes: account model catalog and discovery, account model exposure panel, account/model navigation, Gateway route health and fallback.
- Related files: `apps/desktop/electron/model-catalog-store.ts`, `apps/desktop/electron/bridge.ts`, `apps/desktop/electron/usage-router-service.ts`, `apps/desktop/src/components/account-model-exposure-utils.ts`, `apps/desktop/src/components/account-model-exposure-panel.tsx`, `apps/desktop/src/pages/accounts-page.tsx`, `apps/desktop/src/pages/models-page.tsx`, `apps/desktop/src/react-app.tsx`.
- Compatibility: preserve successful discovery and existing model selections; never mutate the source model record; keep account-pool failover/cooldown behavior.

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Add atomic catalog adoption that creates/reuses a current-provider model identity and binds selected models to the account. | `model-catalog-store.ts`, `bridge.ts` | Inspect source/target identity and binding flow; desktop TypeScript compile. | done | Added one-write adoption with Base URL-scoped custom-provider identity, extraction of the upstream ID from legacy `provider:model` slugs, and protocol/display metadata refresh on reuse. Electron typecheck reports no diagnostics in the catalog/bridge changes; its only errors are the unrelated middleware `Buffer`/`BodyInit` errors listed below. |
| 2 | On failed discovery, show all catalog models and failure detail; add question-mark help that opens Models. | exposure utils/panel, accounts page, React app, Models page | Inspect fallback filtering, help navigation, and provider labels; desktop TypeScript compile. | done | Failed or empty discovery enables all catalog candidates; failure text and clickable question-mark help are wired to Models; web TypeScript compile and `git diff --check` pass. |
| 3 | Restrict Gateway route cooldown and failure fallback to enabled account-pool requests. | `usage-router-service.ts` | Inspect no-pool candidate availability and proxy fallback inputs; desktop TypeScript compile. | done | No-pool requests bypass cooldown filtering and pass no fallback routes; Electron typecheck reports only two unrelated `Buffer`/`BodyInit` errors in the existing middleware response wrapper at lines 369 and 379. |

## Rules
- Keep only one task in progress at a time.
- Update each task status and evidence immediately after its implementation and verification.
- Do not modify unrelated existing worktree changes.
- Do not add or run tests in this task; use static inspection and TypeScript compilation for verification.
