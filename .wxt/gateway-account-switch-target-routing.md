# Gateway account switch target routing

## Goal
- Ensure App/CLI target files continue using the environment Gateway URL whenever the selected environment is in Gateway mode, regardless of which account is selected or updated.

## Why Complex
- The behavior crosses target-home projection, Electron account switching, and persisted Gateway synchronization; the fix needs regression coverage for both direct-route accounts and Gateway-mode accounts.

## Scope
- Related modules/classes: target-home projection, Electron bridge account switching and Gateway synchronization.
- Related files: `packages/core/src/system/target-home.ts`, `apps/desktop/electron/bridge.ts`, associated tests.
- Compatibility: direct routing remains unchanged when the environment is not in Gateway mode; account credentials and model defaults remain account-specific.

## Task List
| ID | Task | Files/Modules | Verify | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Add a Gateway-aware target-home projection so selected accounts cannot overwrite the active environment Gateway URL with a direct route. | `packages/core/src/system/target-home.ts`, `apps/desktop/electron/bridge.ts` | Core/desktop tests and typecheck. | done | `applyTargetHomeState` accepts a Gateway ingress override; bridge target application resolves the active environment Gateway URL. |
| 2 | Add regression coverage for account switching in Gateway and direct modes. | target-home/bridge tests | Focused test run and diff check. | done | Core suite: 163 passing; desktop bridge core suite: 31 passing; targeted Gateway binding test: 1 passing. The direct-mode test remains unchanged and the new Gateway override test covers `/routes` plus compatibility-route state. Desktop `tsc` reports only the two pre-existing Buffer/BodyInit errors in `usage-router-service.ts`. |
| 3 | Review account mutation paths and document residual behavior. | `apps/desktop/electron/bridge.ts` | Static inspection and test evidence. | done | Gateway route resynchronization now restores upstream URLs from persisted route records and avoids the direct account-route synchronizer while a Gateway is active. |

## Rules
- Keep only one task in progress.
- Do not modify unrelated existing worktree changes.
- Preserve direct account routing when no environment Gateway is enabled.
