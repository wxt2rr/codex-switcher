# codex-switcher

[中文](README.md) | English

`codex-switcher` now uses an **env + account** model for Codex CLI / Codex App switching.

## Core Model

- Built-in default env: `default`, mapped to `~/.codex` (override via `CODEX_SWITCHER_DEFAULT_HOME`).
- Custom env data root: `~/.codex-envs/<env>/home` (shared history/sessions/config data).
- Account auth root: `~/.codex-switcher/env-accounts/<env>/<account>/auth.json`.
- Switching accounts in the same env only swaps `auth.json`; no sync is needed.
- Current pointers:
  - `~/.codex-switcher/current_cli_env`
  - `~/.codex-switcher/current_cli_account`
  - `~/.codex-switcher/current_app_env`
  - `~/.codex-switcher/current_app_account`

## Commands

```bash
codex-switcher env list
codex-switcher env create <env> [--empty|--from-default|--from-env <src>]
codex-switcher env use <env> [--target cli|app|both]
codex-switcher env remove <env> [--force]
codex-switcher env current [cli|app]
codex-switcher env path [env]

codex-switcher account list [--env <env>]
codex-switcher account add <account> [--env <env>]
codex-switcher account remove <account> [--env <env>] [--force]
codex-switcher account login <account> [--env <env>] [--target cli|app|both] [--sync|--no-sync]
codex-switcher account use <account> [--env <env>] [--target cli|app|both] [--sync|--no-sync]
codex-switcher account logout [account] [--env <env>] [--target cli|app|both]
codex-switcher account current [cli|app]

codex-switcher proxy [<host:port>|off|test]

codex-switcher list
codex-switcher status
codex-switcher current [cli|app]
codex-switcher exec -- <codex args...>
codex-switcher login [account] [--sync|--no-sync]
codex-switcher logout [account]

codex-switcher app open [account] [-- <app args...>]
codex-switcher app use <account> [-- <app args...>]
codex-switcher app logout [account]
codex-switcher app status
codex-switcher app stop
codex-switcher app current

codex-switcher version
```

## Typical Flow

```bash
# 1) Login two accounts under default env (default=~/.codex)
codex-switcher account login personal --env default
codex-switcher account login work --env default

# 2) Same-env account switch (auth.json swap only)
codex-switcher account use personal --env default
codex-switcher account use work --env default

# 3) Create a dedicated env and switch accounts there
codex-switcher env create project-a --empty
codex-switcher account login corp --env project-a
codex-switcher account use corp --env project-a
```

## list Output

`codex-switcher list` prints:

`ENV / HOME / ACCOUNT / EMAIL / PLAN / 5H USAGE / WEEKLY USAGE / SOURCE`

Usage data strategy:

- API first (`chatgpt.com/backend-api/wham/usage`)
- Auto fallback to local `sessions/*.jsonl` on API failure
- `5H USAGE` / `WEEKLY USAGE` reset time is unified to `MM-DD HH:MM` (example: `89% (04-19 11:45)`)
- `SOURCE` is shown as a dedicated column (`api` or `local`)
- You can configure a dedicated proxy for this usage API via `codex-switcher proxy 127.0.0.1:7899` (only affects `list`)
- If no manual proxy is configured, env/system proxy settings are auto-detected for usage API requests

## Compatibility Commands

Legacy commands (`add/remove/use/switch/login/logout/import-default`) are kept and mapped to the new model.

## Validation

```bash
./plugins/codex-switcher/scripts/test-switcher.sh
```
