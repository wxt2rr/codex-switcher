# codex-switcher

[中文](README.md) | English

`codex-switcher` manages Codex CLI / Codex App switching with an `env + account` model.

## Background

I originally used Codex for personal work while my company account lived in Cursor, so there was no conflict.  
After the company migrated from Cursor to Codex, my personal and company Codex accounts started conflicting on the same machine, and switching became unreliable.

After checking local behavior, I found the key is simple: keep account-local data isolated by directory.  
Based on that, I built `codex-switcher` to manage, switch, and isolate multiple Codex accounts.

## Codex Local Auth Model (Summary)

Codex stores auth state, session history, and local runtime data under `CODEX_HOME` (usually `~/.codex`).  
When multiple accounts share the same directory, auth/session data can overwrite each other.

`codex-switcher` separates shared data from account credentials:  
switching accounts within the same env only replaces `auth.json`, while keeping other shared files unchanged.

## Install

### npm global install

```bash
npm i -g @wangxt0223/codex-switcher
codex-sw check
```

### Install from source

```bash
./scripts/install.sh
codex-sw check
```

## Quick Start

```bash
# Login two accounts in default env
codex-sw ac login personal --env default
codex-sw ac login work --env default

# Switch CLI account and launch codex
codex-sw ac use personal -t cli --launch

# Switch App account and launch App
codex-sw ac use work -t app --launch

# Create env and use account in that env
codex-sw env new project-a --empty
codex-sw ac login corp --env project-a
codex-sw ac use corp --env project-a -t both
```

## Core Commands

| Command | Description |
| --- | --- |
| `codex-sw env ls` | List envs |
| `codex-sw env new <env> [--empty\|--from <src-env\|default>]` | Create env |
| `codex-sw env use <env> [-t cli\|app\|both]` | Switch env |
| `codex-sw ac ls [--env <env>]` | Show account overview and usage (same as `ops list`) |
| `codex-sw ac login <account> [--env <env>] [-t cli\|app\|both] [--sync\|--no-sync]` | Login account |
| `codex-sw ac use <account> [--env <env>] [-t cli\|app\|both] [--sync\|--no-sync] [--launch\|--no-launch] [-- <codex args...>]` | Switch account |
| `codex-sw ac logout [account] [--env <env>] [-t cli\|app\|both]` | Logout account |
| `codex-sw whoami [-t cli\|app\|both]` | Show current env/account |
| `codex-sw status` | Show login status |
| `codex-sw version` | Show version |
| `codex-sw check` | Health check |
| `codex-sw upgrade [--dry-run]` | Upgrade tool |
| `codex-sw --help` | Show core help |
| `codex-sw --help-all` | Show full help |

## Operations Commands

| Command | Description |
| --- | --- |
| `codex-sw ops list` | Show account list and usage (same as `ac ls`) |
| `codex-sw ops proxy [<host:port>\|off\|test]` | Configure/test usage API proxy |
| `codex-sw ops exec -- <codex args...>` | Run codex in current CLI context |
| `codex-sw ops import-default <env> [--with-auth] [--force]` | Import default env data |
| `codex-sw ops init [--shell zsh\|bash] [--dry-run]` | Initialize command bootstrap |
| `codex-sw ops recover [--dry-run]` | Recover pointers |
| `codex-sw ops doctor [--fix]` | Deep diagnostics and fix |

## Development

```bash
npm run check
```

## Release

```bash
npm login --registry https://registry.npmjs.org/
npm run release:npm
```
