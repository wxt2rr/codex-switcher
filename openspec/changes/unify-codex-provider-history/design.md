## Context

Codex records `model_provider` in session metadata and its local thread index. Changing only `config.toml` changes the active history bucket but does not reclassify older sessions. Direct and gateway execution therefore need one stable provider ID per environment.

## Design

### Stable provider namespace

Introduce one exported constant, `codex_switcher_router`, for managed target materialization. The account name remains the user-facing credential identity. The generated provider block uses the stable ID while its base URL and auth fields follow the selected direct or gateway transport.

### Migration service

Add a small Electron-main migration module that:

1. Resolves the selected environment home.
2. Refuses to run while a managed Codex App instance for that environment is active.
3. Creates a timestamped backup of `state_5.sqlite` (including sidecar files when present) and all affected session JSONL files.
4. Rewrites only `session_meta.payload.model_provider` in rollout JSONL files.
5. Updates `threads.model_provider` in `state_5.sqlite` when the expected table/column exists.
6. Uses atomic replacement and a transaction; on error it restores the backup.
7. Returns counts, backup path, and a partial/failure diagnostic.

The `session_index.jsonl` file is not rewritten because it has no provider field.

### UI and IPC

Expose `syncEnvironmentConversationHistory(envName)` through the Electron bridge. Add a menu action on each environment card named “同步对话索引”, with a confirmation dialog explaining that only local provider metadata changes and that cross-provider resume may still fail. Refresh the environment view and show the returned counts after success.

### Compatibility

If the SQLite schema is absent or unsupported, JSONL migration can still run only when the result is clearly reported as partial; the UI must not claim full synchronization. Existing files are never deleted without a backup.
