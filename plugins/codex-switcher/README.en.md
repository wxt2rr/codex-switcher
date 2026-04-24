# codex-switcher

[中文](README.md) | English

`codex-switcher` uses an `env + account` model for Codex CLI / Codex App.

## Commands

```bash
codex-switcher env ls
codex-switcher env new <env> [--empty|--from <src-env|default>]
codex-switcher env use <env> [-t cli|app|both]
codex-switcher env rm <env> [--force]

codex-switcher ac ls [--env <env>]
codex-switcher ac login <account> [--env <env>] [-t cli|app|both] [--sync|--no-sync] [--mode auth|apikey]
codex-switcher ac relogin [account] [--env <env>] [-t cli|app|both] [--sync|--no-sync] [--mode auth|apikey]
codex-switcher ac use <account> [--env <env>] [-t cli|app|both] [--sync|--no-sync] [--launch|--no-launch] [-- <codex args...>]
codex-switcher ac logout [account] [--env <env>] [-t cli|app|both]
codex-switcher ac rm <account> [--env <env>] [--force]

codex-switcher whoami [-t cli|app|both]
codex-switcher status
codex-switcher lang [zh|en|ja]
codex-switcher tui
codex-switcher version
codex-switcher check
codex-switcher upgrade [--dry-run]

codex-switcher ops list
codex-switcher ops proxy [<host:port>|off|test]
codex-switcher ops exec -- <codex args...>
codex-switcher ops import-default <env> [--with-auth] [--force]
codex-switcher ops init [--shell zsh|bash] [--dry-run]
codex-switcher ops recover [--dry-run]
codex-switcher ops doctor [--fix]
codex-switcher ops token-refresh <start|stop|status|run-once>
```

## Validation

```bash
./plugins/codex-switcher/scripts/test-switcher.sh
```
