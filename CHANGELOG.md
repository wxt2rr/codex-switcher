# Changelog

## 0.8.3 - 2026-04-20

- 1. 优化status展示UI

## 0.8.2 - 2026-04-20

- 1. 支持更新提示
- 2.简化命令交互

## 0.8.1 - 2026-04-19

- 1. 支持代理设置

## 0.8.0 - 2026-04-19

- 1. 支持TUI模式，默认改为TUI
- 2. 支持账号status状态展示

## 0.7.7 - 2026-04-19

- TUI-first flow, status dashboard performance and layout improvements, and interaction polish.

## 0.7.6 - 2026-04-19

- Redesigned TUI around Home + Switch CLI/APP + Accounts workflow for faster account/env operations.
- Added language-aware TUI interactions (zh/en/ja), quick action trigger (k/Ctrl+K), and command catalog integration.

## 0.7.5 - 2026-04-19

- Added interactive TUI mode via 'codex-sw tui' with dashboard, command catalog, and custom command runner covering all CLI features.
- Updated docs and tests for TUI support while keeping CLI behavior unchanged.

## 0.7.4 - 2026-04-19

- Added automatic update check on every command and show upgrade hint when a newer npm version exists.
- Added env/account remove command entrypoints with double y/n confirmation.

## 0.7.3 - 2026-04-18

- 1. 支持apiKey授权方式
- 2. 支持删除命令

## 0.7.2 - 2026-04-18

- Added `ac login --mode auth|apikey` with `auth` as default.
- Added interactive API key login flow for `--mode apikey` (prompt for key, save success message, then usable via `ac use`).
- Updated smoke tests to cover API key interactive login and `--with-api-key` invocation path.
- Reworked Chinese/English README onboarding into scenario-first examples with expected command outputs.

## 0.7.1 - 2026-04-13

- Moved health/upgrade out of ops namespace to top-level commands: `check`, `upgrade`.
- Aligned `ac ls` with legacy `list`-style full table output, including `LAST ACTIVITY`.
- Added `ac ls --env <env>` table filtering and smoke-test coverage for `ac ls == ops list`.
- Updated docs to clarify `ac ls` and `ops list` parity.

## 0.7.0 - 2026-04-13

- Simplified command tree to core groups: `env`, `ac`/`account`, `whoami`, `status`, `version`.
- Added `ops` namespace for operational commands: `list/proxy/exec/import-default/init/upgrade/recover/check/doctor`.
- Renamed env/account subcommands to compact forms: `env ls/new/use`, `ac ls/login/use/logout`.
- Added `-t` short option as alias of `--target` for env/account target selection.
- Unified App switching into `ac use -t app --launch`; removed top-level `app` command group.
- Removed legacy top-level account commands: `login/logout/add/remove/use/switch`.
- Updated smoke tests and docs to the new command model.

## 0.6.6 - 2026-04-13

- Removed legacy account-related top-level commands: `login/logout/add/remove/use/switch`.
- Added `ac` as first-class short alias for `account` (`ac` and `account` are equivalent groups).
- Extended `ac/account use` with launch behavior parity (`--launch|--no-launch|-- <codex args...>`, default `auto`).
- Updated Chinese/English README docs and manual checklist to use latest `env + account(ac)` command style.
- Added smoke-test assertions to ensure legacy top-level commands fail with `unknown command`.

## 0.6.5 - 2026-04-12

- Removed `LAST ACTIVITY` from `list` default output columns.
- `list` now prints: `ENV / HOME / ACCOUNT / EMAIL / PLAN / 5H USAGE / WEEKLY USAGE / SOURCE`.
- Updated command help text, Chinese/English README docs, and smoke-test assertions for the new column layout.

## 0.6.4 - 2026-04-12

- Updated `list` output columns to include `HOME` and a dedicated `SOURCE` column (`api`/`local`).
- Changed `LAST ACTIVITY` to absolute `MM-DD HH:MM` format and aligned weekly reset display to the same date+time style.
- Improved last-activity fallback behavior: when API omits activity timestamp, fallback to local session-derived time.
- Updated Chinese/English README and plugin docs for the latest `list` output schema.
- Updated smoke tests for `HOME`/`SOURCE` columns and absolute-time assertions.
- Removed accidental package self-dependency from `package.json`.

## 0.6.3 - 2026-04-12

- Changed `list` email rendering to show plain email only (removed `(account)` prefix).
- Reworked root Chinese/English README command reference into full command tables based on current capabilities.
- Updated smoke-test assertions for the new email column format.

## 0.6.2 - 2026-04-12

- Added usage-API proxy auto-detection (manual proxy > env proxy > macOS system proxy).
- Added `proxy` source display: `(manual)`, `(auto:env)`, `(auto:system)`, or `off`.
- Kept proxy scope limited to usage API calls used by `list`/`proxy test`.
- Added smoke-test coverage for env-proxy auto-detection and isolated proxy behavior.

## 0.6.1 - 2026-04-12

- Fixed symlink invocation path resolution for `codex-sw` / `codex-switcher`, so global npm installs can always find bundled scripts.
- Fixed `list` row field reuse bug that could leak previous row values into later rows.
- Improved usage API request compatibility by adding `ChatGPT-Account-Id` and browser-like headers, while keeping local sessions fallback.
- Added smoke-test coverage for symlink launch path behavior.

## 0.6.0 - 2026-04-12

- Refactored core model from profile-based switching to `env + account` with built-in `default=~/.codex`.
- Added env/account command groups: `env {list|create|use|remove|current|path}` and `account {list|add|remove|login|use|logout|current}`.
- Added per-env account auth slots at `~/.codex-switcher/env-accounts/<env>/<account>/auth.json`.
- Same-env account switch now swaps `auth.json` only and ignores `--sync`.
- `list` now shows usage columns with API-first fetch and local sessions fallback, and appends source marker `(api|local)`.
- Updated Chinese/English README and plugin docs to match the new env/account flow.
- Updated upgrade and manual checklist docs to remove legacy profile terminology.

## 0.5.1 - 2026-04-12

- Added `version: <semver>` output in `codex-sw check` for quick runtime version verification.
- Added smoke-test assertion to verify `check` includes the version line.

## 0.5.0 - 2026-04-12

- Added automatic Codex CLI launch behavior for `use/switch` in interactive shells (`--launch=auto`).
- Added explicit `--launch` / `--no-launch` controls for `use/switch`.
- Added support for `use/switch -- <codex args...>` to switch profile and run Codex command in one step.
- Improved non-interactive UX with explicit auto-launch skip hint.
- Added smoke-test coverage for launch/no-launch behavior and argument conflict handling.
- Updated Chinese/English docs to describe launch semantics and new command forms.

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
