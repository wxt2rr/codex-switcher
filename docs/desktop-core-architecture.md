# Desktop Core Rewrite Notes

## Current Architecture

`codex-switcher` now has four layers:

1. `packages/core`
   - typed state model
   - env/account/status overview APIs
   - task abstractions
2. `scripts/core-cli.ts`
   - thin local bridge over core APIs
   - used by CLI compatibility paths, TUI read paths, and desktop shell bridge
3. `plugins/codex-switcher/scripts/codex-switcher`
   - legacy Bash CLI/TUI entrypoint
   - gradually migrated to core-backed read/write paths
4. `apps/desktop`
   - Electron desktop shell
   - Apple-native frontend using local bridge commands

## Migration Behavior

Core still reads from the existing legacy directory layout:

- state pointers: `~/.codex-switcher/current_*`
- env homes: `~/.codex-envs/<env>/home`
- account records: `~/.codex-switcher/env-accounts/<env>/<account>`

Current bridge write paths update legacy-compatible files:

- target pointer writes via `writeLegacyPointers`
- runtime writes via `writeLegacyRuntime`
- env creation via `createLegacyEnv`

This keeps rollback simple:

- if the desktop/core bridge fails, the Bash CLI can still read the same directory layout
- no separate database or opaque desktop-only store has been introduced

## Rollback Model

Rollback remains file-based:

1. stop using desktop or core bridge commands
2. return to `plugins/codex-switcher/scripts/codex-switcher`
3. restore state backup if migration/persistence introduced corruption

The core migration layer already includes backup + restore coverage in `packages/core/src/state/migration.test.ts`.

## GUI Support Scope

Current desktop GUI supports:

- overview state inspection
- env switching for CLI/App targets
- account switching for CLI/App targets
- env creation
- runtime base URL update
- native login / relogin for `auth`, `apikey`, and `sub2api`
- destructive confirmation flows for env deletion and account deletion
- log viewing for `switcher.log` and `token-refresh.log`
- advanced bridged command execution
- operations panel for:
  - proxy show / set / off / test
  - token refresh start / stop / status / run-once
  - doctor status
  - recover run
  - app status
  - app logout
  - cli launch current

The desktop result area now provides structured summaries for:

- proxy results
- token refresh guard and scan results
- doctor results
- recover target resolution
- app status
- log metadata

Each structured view keeps the raw command output directly below it for troubleshooting.

Current desktop GUI does not yet fully cover:

- live log streaming
- richer recent-task history detail views
- release hardening such as app icon, signing, notarization, and distribution automation

## Desktop Build Requirements

Frontend build is verified with:

```bash
npm run desktop:build
```

Full desktop runtime now uses Electron:

- Electron main process
- preload bridge with IPC
- Node-based local command bridge to `scripts/core-cli.ts`
- optional directory packaging through `electron-builder`

Build verification is available in-repo with no Rust dependency. Runtime verification additionally depends on the local Electron binary being installed correctly.

Packaged runtime verification has also been completed with:

```bash
rm -rf apps/desktop/release
npm run package:dir --workspace ./apps/desktop
apps/desktop/release/mac-arm64/codex-switcher.app/Contents/MacOS/codex-switcher
```

The packaged app starts successfully and keeps the renderer, preload bridge, and `app.asar` runtime alive.

## Operator Workflow

Recommended order for local operators:

1. `npm ci`
2. `npm run core:test`
3. `npm run cli:test`
4. `npm run core:build`
5. `npm run desktop:build`
6. `npm run desktop:test`
7. `npm run desktop:dev`
8. `npm run desktop:electron`
9. `npm run package:dir --workspace ./apps/desktop`

## Remaining Risk

The largest remaining desktop runtime risk is release hardening around Electron artifact signing/distribution and cleanup of historical Tauri binary assets.
Core-backed CLI/TUI compatibility has already moved the main env/account/runtime switching flows onto `core-cli.ts`.
