## Why

Codex Desktop filters local conversation history by the active `model_provider`. The switcher currently writes `custom` for direct accounts and `codex_switcher_router` for gateway accounts, so the same environment is split into two visible conversation lists even though the session files remain in one Codex home.

## What Changes

- Use `codex_switcher_router` as the stable provider namespace for accounts managed by the switcher.
- Keep account display names independent from the Codex provider namespace.
- Add a safe environment action that migrates existing local session metadata and the Codex thread index to the stable provider namespace.
- Back up affected files and report migration counts and failures.
- Keep direct and gateway transports configurable without changing the provider namespace.

## Capabilities

### New Capabilities

- `provider-history-sync`: Stable per-environment Codex provider identity and safe local conversation-index migration.

### Modified Capabilities

None.

## Impact

- Core target-home configuration materialization.
- Electron bridge/preload IPC and environment page UI.
- Local Codex session JSONL and `state_5.sqlite` migration using the existing `sql.js` dependency.
- New migration backups under the switcher state directory.
