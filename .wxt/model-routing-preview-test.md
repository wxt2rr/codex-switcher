# model-gateway-preview-test

## Goal
- Make model testing use the same account binding and Gateway route compilation as saving, while keeping unsaved tests isolated from persisted account bindings and the live Gateway configuration.

## Why Complex
- Crosses the model catalog store, Electron bridge, usage router manager, Gateway route preview, and model test UI.

## Scope
- Related modules/classes: account model binding projection, Gateway state compilation, UsageRouterManager model test flow, model test request types and buttons.
- Related files: `apps/desktop/electron/model-catalog-store.ts`, `apps/desktop/electron/gateway-model-bindings.ts`, `apps/desktop/electron/bridge.ts`, `apps/desktop/electron/usage-router-manager.ts`, `apps/desktop/src/bridge.ts`, `apps/desktop/src/components/account-model-exposure-panel.tsx`, `apps/desktop/src/pages/models-page.tsx`.
- Compatibility: existing saved binding and direct model test requests continue to work; preview data is server-only and is not accepted from the renderer as credentials.

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Extract a pure catalog binding projection shared by save and preview | `model-catalog-store.ts` | model catalog tests | done | `projectAccountBindingsFromCatalog` now backs the persisted setter; focused tests pass.` |
| 2 | Build server-side preview route/gateway inputs from the projected binding | `bridge.ts`, `gateway-model-bindings.ts` | gateway binding tests | done | `bridge.test` typecheck passes; preview builder projects the current account provider and compiles the same gateway binding.` |
| 3 | Execute an isolated Gateway preview request with cleanup | `usage-router-manager.ts`, `usage-router-service.ts` | router/bridge tests | done | `usage-router-manager.test.ts` preview case passes; temporary gateway preview and route are removed while saved route ids remain unchanged.` |
| 4 | Pass stable catalog model ids from both model UIs | `bridge.ts`, `src/bridge.ts`, UI components | desktop type/build tests | done | `modelId` is passed from model and account model pickers; Electron and web TypeScript checks pass.` |
| 5 | Run focused tests and record residual risks | all above | focused test commands, type checks, desktop build, diff check | done | `npx tsx --test electron/model-catalog-store.test.ts electron/usage-router-manager.test.ts electron/usage-router-service.test.ts` passed 67 tests, including manual selection after an empty discovery, local Gateway provider identity, and gzip relay. `npm run desktop:build` and `git diff --check` passed. The full desktop suite still has an unrelated aggregate account-pool capability mismatch failure; that case passes in isolation. |

## Rules
- Simultaneously only one task may be `in_progress`.
- Update this file after each task with verification evidence.
- Preview requests must never persist account bindings or replace the live Gateway document.
