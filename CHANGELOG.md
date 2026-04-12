# Changelog

## 0.4.1 - 2026-04-12

- Refined README wording for a more conversational background/auth mechanism explanation.
- Moved command reference from plugin docs to root README in table format.
- Standardized README title to `codex-switcher`.
- Removed legacy package-name migration notices from docs.

## 0.4.0 - 2026-04-12

- Changed npm package name to `@wangxt0223/codex-switcher` (CLI command remains `codex-sw`).
- Updated `upgrade` implementation to install the scoped package by default.
- Added `CODEX_SWITCHER_NPM_PACKAGE` env override for custom package source.
- Updated README/docs to reflect new package install/publish references.

## 0.3.2 - 2026-04-12

- Added built-in self-upgrade command: `codex-sw upgrade` (supports `--dry-run`).
- Updated `--help` and README/docs to include upgrade usage.

## 0.3.1 - 2026-04-12

- Added strict App profile guard: `app open/use` now requires existing and logged-in profile.
- Added `import-default` to migrate data from `~/.codex` into a profile.
- Added `--sync|--no-sync` for `login`, `use`, and `switch` with overwrite sync (excluding `auth.json`).
- Updated `--help` and README docs for sync and migration workflows.

## 0.3.0 - 2026-04-12

- Added `codex-sw` namespaced entrypoint (kept `codex-switcher` compatibility).
- Added concurrency lock to protect profile pointer mutations.
- Added safer App lifecycle handling with managed PID tracking.
- Added status exit code conventions (`0/1/2`).
- Added pointer recovery command: `codex-sw recover`.
- Added init/bootstrap command: `codex-sw init`.
- Added doctor auto-fix mode: `codex-sw doctor --fix`.
- Added log redaction scanner in `check` / `doctor`.
- Added install/uninstall scripts and CI workflow.
- Added expanded smoke tests.
- Added npm release helper: `npm run release:npm`.
- Added `publishConfig` (public + npmjs registry) and publish guide docs.
- Added `import-default` command to migrate existing `~/.codex` data into a profile.
- Changed `app open/use` to require existing and logged-in profile (no silent auto-create).
- Added `login --sync` and `use/switch --sync` overwrite sync (all files except `auth.json`).
