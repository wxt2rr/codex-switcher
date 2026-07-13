# CLI Auto Resume Design

## Goal

Add a desktop system setting that optionally resumes the nth most recent Codex session for the launched project. The setting is disabled by default and uses `n = 1` by default.

## Behavior

- Persist `{ enabled, sessionNumber }` in `desktop-settings.json`.
- When disabled, CLI launch behavior is unchanged.
- When enabled, resolve sessions from the selected account's `CODEX_HOME` and current launch directory.
- Filter session metadata by matching `cwd`, merge activity timestamps from `session_index.jsonl`, sort newest first, and select index `sessionNumber - 1`.
- Launch `codex resume <session-id>` directly on macOS, Windows, and Linux.
- If no matching nth session exists or session metadata cannot be read, launch a fresh CLI and return a warning without failing account switching.

## UI

Add an Auto Resume card to System Management with an enable switch and a positive integer input. Saving validates and persists the value. Default session number is 1.

## Verification

- Unit tests cover session discovery, cwd filtering, activity ordering, missing/corrupt records, and nth selection.
- Bridge tests cover settings persistence and resume argument injection.
- Desktop tests and production build must pass.
