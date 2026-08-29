# Changelog

## 0.8.17 - 2026-08-29

- Added automatic migration across all configured environments for Codex 0.149 authentication changes.
- Removed legacy root-level API-key auth fields while preserving `model_provider`, explicit provider authentication, and `auth.json` data.
- Safely repairs matching provider-level authentication settings and leaves ambiguous configurations unchanged.

## 0.8.16 - 2026-08-02

- Updated the built-in DeepSeek presets to match the official catalog JSON and updated MiMo defaults to the Xiaomi preset JSON.
- Fixed the Models page so built-in DeepSeek and MiMo provider presets are seeded and visible even before a provider account is created.

## 0.8.14 - 2026-08-02

- Added Xiaomi MiMo as a provider-first API key account flow with locked official Responses Base URL and automatic model binding for `mimo-v2.5-pro` and `mimo-v2.5`.
- Added MiMo model catalog presets and official Base URL detection, including Token Plan endpoint recognition.
- Fixed custom model account counts so stale bindings from deleted accounts no longer inflate the displayed binding total.
- Improved provider preset synchronization so DeepSeek and MiMo accounts keep generated `models.json` aligned with the active account.

## 0.8.13 - 2026-08-01

- Added provider-first account creation so OpenAI keeps the existing login/import modes while DeepSeek uses an API-key-only flow.
- Added DeepSeek provider presets with locked official Base URL and automatic default model binding for `deepseek-v4-flash` and `deepseek-v4-pro`.

## 0.8.12 - 2026-08-01

- Added DeepSeek official Codex Responses model catalog filling for supported models and kept existing provider selection logic intact.
- Extended the independent model flow so active accounts can pick up DeepSeek model metadata without overwriting user-owned config.

## 0.8.11 - 2026-05-13

- Fixed `status` card layout so account blocks wrap earlier and remain readable when one environment has many accounts.

## 0.8.10 - 2026-05-12

- Added explicit `app restart-current` and `app launch-new` commands for Codex App control, and changed account switching to switch only by default.
- Added API key login base URL selection, persisted auth metadata, and runtime `OPENAI_BASE_URL` injection for custom API-compatible endpoints.
- Added `sub2api` login mode to import token JSON into managed `auth.json` account slots.
- Improved TUI API key login, Home navigation, menu redraw behavior, and quiet success handling after returning to Home.
- Fixed TUI interactive menus that could fall back to numeric `Choose:` prompts, and fixed environment removal from the current CLI env by using force removal.

## 0.8.9 - 2026-05-09

- Fixed auth login and API key login flows to resolve the Codex binary via resolve_codex_bin, so global npm installs no longer fail with 'codex: command not found'.

## 0.8.8 - 2026-05-07

- Optimized token refresh log timestamp display and added an EMAIL column to refresh log rows.

## 0.8.7 - 2026-05-07

- 新增 TUI 菜单项 Refresh Account Token，支持手动触发一次 token 刷新。
- 修复 TUI 上下选择错位叠印问题（菜单重绘行数与项目数同步）。
- 优化 token 刷新流程：改为预热请求驱动，增加 need_relogin 状态与可观测输出。

## 0.8.6 - 2026-04-24

- 1. 支持显示AUTH TOKEN过期时间
- 2.支持AUTH TOKEN自动续期
- 支持重新登录

## 0.8.4 - 2026-04-21

- 1. 优化status展示UI

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
- Unified App switching into explicit `app restart-current` / `app launch-new`; restored top-level `app` command group.
- Removed legacy top-level account commands: `login/logout/add/remove/use/switch`.
- Updated smoke tests and docs to the new command model.

## 0.6.6 - 2026-04-13

- Removed legacy account-related top-level commands: `login/logout/add/remove/use/switch`.
- Added `ac` as first-class short alias for `account` (`ac` and `account` are equivalent groups).
- Removed launch behavior from `ac/account use`; launch control is now explicit under `app`.
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
