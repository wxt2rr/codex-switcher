# System Auth Slot: Official Auth and API Key

## Goal

Make the `default` environment's system slot independent from ordinary accounts while supporting both official ChatGPT Auth and API Key runtime configuration.

## Why Complex

The current `default/default` value is synthesized as a fallback account, can also be read as a real account, participates in identity synchronization, and is used by desktop remote-control projection. The change crosses persisted state, legacy migration, target projection, Electron bridge APIs, and the accounts UI.

## Scope

- Add an environment-owned system authorization slot.
- Keep ordinary accounts isolated from the system slot.
- Migrate legacy `env-accounts/default/default` data without deleting credentials.
- Support official Auth and API Key configuration for the system slot.
- Exclude the system slot from ordinary account synchronization and account actions.
- Preserve existing target and remote-control compatibility.

## Task List

- [x] Add typed system-slot state and validation.
- [x] Read/write system-slot files and migrate legacy `default/default` data with the legacy directory retained as a recoverable backup.
- [x] Exclude system slot from auth identity synchronization and ordinary account lists.
- [x] Add bridge commands for system Auth/API Key configuration and unbinding.
- [x] Add dedicated system-slot UI and keep ordinary account UI unchanged.
- [x] Verify core tests, desktop tests, typecheck, and desktop build.

## Verify

- Legacy state loads with a distinct system slot and no synthetic ordinary `default` account.
- Binding/unbinding Auth and API Key never mutates ordinary accounts.
- Ordinary account synchronization never copies into the system slot.
- Codex target projection continues to resolve the system slot for official remote Auth.
- Existing state files remain readable and migration creates a recoverable backup.

## Status/Evidence

- Status: complete.
- Evidence: `npm run check` exits 0; `npm run core:test` reports 184 passed; `npm run desktop:test` reports 628 passed and 1 skipped; and `npm run core:build`, `npm run desktop:build`, and `git diff --check` pass. Legacy `default/default` is now read as `EnvState.systemAuth`, while the original directory is left untouched as a recoverable backup. The target-home writer and CLI/App launchers project an active system slot's Auth/API Key instead of preserving stale account credentials.
