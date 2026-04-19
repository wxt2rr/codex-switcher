# codex-switcher

中文 | [English](README.en.md)

`codex-switcher` 使用 `env + account` 模型管理 Codex CLI / Codex App。

## 命令

```bash
codex-switcher env ls
codex-switcher env new <env> [--empty|--from <src-env|default>]
codex-switcher env use <env> [-t cli|app|both]
codex-switcher env rm <env> [--force]

codex-switcher ac ls [--env <env>]
codex-switcher ac login <account> [--env <env>] [-t cli|app|both] [--sync|--no-sync] [--mode auth|apikey]
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
```

## 验证

```bash
./plugins/codex-switcher/scripts/test-switcher.sh
```
