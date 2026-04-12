# codex-switcher

[中文](README.md) | English

`codex-switcher` is a lightweight switcher for Codex CLI and Codex App.
It now uses an `env + account` model: env for shared data, account for isolated `auth.json`.

## Background

I originally used Codex for personal work while my company account lived in Cursor, so there was no conflict.  
After the company migrated from Cursor to Codex, my personal and company Codex accounts started conflicting on the same machine, and switching became unreliable.

After inspecting local behavior, I found Codex's local auth model is straightforward: if account-local data is isolated per directory, account switching becomes stable. Based on that, I built `codex-switcher` with Codex to manage, switch, and isolate all my Codex accounts.

## Codex Local Auth Model (Summary)

The following is based on observed local behavior and filesystem layout:

- Both `Codex CLI` and `Codex App` read the same root directory: `CODEX_HOME` (default is usually `~/.codex`).
- Auth state is primarily persisted in `CODEX_HOME/auth.json`.
- Session/history/state data is also stored under the same `CODEX_HOME` (for example `history.jsonl`, `sessions/`, `state_*.sqlite`).
- So when multiple accounts share one `CODEX_HOME`, auth/session data can overwrite or contaminate each other.

`codex-switcher` solves this by decoupling shared data from auth credentials.  
Built-in `env=default` maps to `~/.codex`, and same-env account switch only swaps `auth.json`.

## Install

### Option A: npm (global)

```bash
npm i -g @wangxt0223/codex-switcher
codex-switcher check
```

### Option B: from source checkout

```bash
./scripts/install.sh
codex-switcher check
```

## Quick start

```bash
codex-switcher account login personal --env default
codex-switcher account login work --env default
codex-switcher account use personal --env default

codex-switcher env create project-a --empty
codex-switcher account login corp --env project-a
codex-switcher account use corp --env project-a
```

## Sync options

- Same-env account switch only replaces `auth.json`; no shared data sync is needed.
- `account login --sync` (cross-env setup) can sync default-env data into target env (excluding `auth.json`).
- `use/switch` defaults to `--launch=auto`: on an interactive terminal, `codex` starts automatically after switch.
- `use/switch --launch`: launch `codex` CLI immediately after switching.
- `use/switch --no-launch`: switch account pointer only, without launching `codex`.
- `use/switch -- <codex args...>`: run `codex` with args right after switch (implies launch).

## Command reference

Commands below use `codex-sw` (all are equivalent under `codex-switcher`):

| Category | Command | Description |
| --- | --- | --- |
| Env | `codex-sw env list` | List all envs with CLI/App current markers |
| Env | `codex-sw env create <env> [--empty\|--from-default\|--from-env <src>]` | Create env from empty/default/another env |
| Env | `codex-sw env use <env> [--target cli\|app\|both]` | Switch env pointer for CLI/App |
| Env | `codex-sw env remove <env> [--force]` | Remove env |
| Env | `codex-sw env current [cli\|app]` | Show current env pointer |
| Env | `codex-sw env path [env]` | Print exportable `CODEX_HOME` path |
| Account | `codex-sw account list [--env <env>]` | List accounts in env with current markers |
| Account | `codex-sw account add <account> [--env <env>]` | Add account slot |
| Account | `codex-sw account remove <account> [--env <env>] [--force]` | Remove account slot |
| Account | `codex-sw account login <account> [--env <env>] [--target cli\|app\|both] [--sync\|--no-sync]` | Login account and persist auth |
| Account | `codex-sw account use <account> [--env <env>] [--target cli\|app\|both] [--sync\|--no-sync]` | Switch to account |
| Account | `codex-sw account logout [account] [--env <env>] [--target cli\|app\|both]` | Logout account |
| Account | `codex-sw account current [cli\|app]` | Show current env/account pointer |
| Usage proxy | `codex-sw proxy [<host:port>\|off\|test]` | Configure/test usage API proxy (only affects `list`) |
| Query/Run | `codex-sw list` | Show `ENV/HOME/ACCOUNT/EMAIL/PLAN/5H/WEEKLY/SOURCE` |
| Query/Run | `codex-sw status` | Show login status for current CLI/App pointers |
| Query/Run | `codex-sw current [cli\|app]` | Show current env/account |
| Query/Run | `codex-sw exec -- <codex args...>` | Run `codex` under current CLI env/account |
| Compat | `codex-sw login [account] [--sync\|--no-sync]` | Compatibility alias for CLI login |
| Compat | `codex-sw logout [account]` | Compatibility alias for CLI logout |
| Compat | `codex-sw use <account> [--sync\|--no-sync] [--launch\|--no-launch] [-- <codex args...>]` | Compatibility alias for CLI switch |
| Compat | `codex-sw switch <account> [--sync\|--no-sync] [--launch\|--no-launch] [-- <codex args...>]` | Same as `use` |
| Compat | `codex-sw add <account>` | Compatibility alias for `account add` |
| Compat | `codex-sw remove <account> [--force]` | Compatibility alias for `account remove` |
| Compat | `codex-sw import-default <env> [--with-auth] [--force]` | Import default env data into target env |
| App | `codex-sw app open [account] [-- <app args...>]` | Open Codex App under account |
| App | `codex-sw app use <account> [-- <app args...>]` | Switch App account (alias of open) |
| App | `codex-sw app logout [account]` | Logout App account |
| App | `codex-sw app status` | Show managed App process status |
| App | `codex-sw app stop` | Stop managed App process |
| App | `codex-sw app current` | Show current App env/account |
| Maintenance | `codex-sw init [--shell zsh\|bash] [--dry-run]` | Initialize PATH bootstrap |
| Maintenance | `codex-sw upgrade [--dry-run]` | Upgrade from npm |
| Maintenance | `codex-sw recover [--dry-run]` | Recover corrupted pointers |
| Maintenance | `codex-sw version` | Print current tool version |
| Maintenance | `codex-sw check` | Basic health checks |
| Maintenance | `codex-sw doctor [--fix]` | Deep diagnostics and optional auto-fix |
| Maintenance | `codex-sw --help` | Show full help |

Plugin-level docs:
- Chinese: `plugins/codex-switcher/README.md`
- English: `plugins/codex-switcher/README.en.md`

## Development

```bash
npm run check
```

## Publish to npm

```bash
npm login --registry https://registry.npmjs.org/
npm run release:npm
```

## Upgrade

```bash
codex-switcher upgrade
```

## Docs

- `docs/macos-manual-checklist.md`
- `docs/upgrade.md`
- `docs/publish.md`
