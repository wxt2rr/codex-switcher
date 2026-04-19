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

## Quick Start (TUI First)

### Option 1: TUI (Recommended)

```bash
# Open TUI directly (same as codex-sw tui)
codex-sw
```

#### Screenshot Placeholders (replace later)

- Home:
  `![TUI Home](docs/images/tui-home.png)`
- Switch flow:
  `![TUI Switch](docs/images/tui-switch.png)`
- Status:
  `![TUI Status](docs/images/tui-status.png)`

### Option 2: CLI (Secondary)

```bash
# Login two accounts in default env
codex-sw ac login personal --env default
codex-sw ac login work --env default

# Switch CLI account and launch codex
codex-sw ac use personal -t cli

# Switch App account and launch App
codex-sw ac use work -t app

# Create env and use account in that env
codex-sw env new project-a --empty
codex-sw ac login corp --env project-a
codex-sw ac use corp --env project-a -t both
```

## What `env` and `account` mean

- `env`: one local workspace directory (shared data like sessions/cache/config).
  - In my setup, I currently use 3 envs: one for company work, one for personal work, and one for my own agent workflows. This keeps history and config isolated across contexts.
- `account`: one identity in that env (practically the account `auth.json`).
  - In my personal env, I keep 3 accounts. Switching accounts within the same env does not lose current history/config; it only switches quota/identity.
- Typical patterns:
  - Same project, different identities: `one env + multiple accounts`
  - Different projects: `multiple envs` (and accounts per env if needed)

## Scenario-Based Onboarding (copy/paste)

### Scenario 1: You already use Codex and have a default `~/.codex`

Goal: stay in `default`, add accounts, and switch directly.

```text
$ codex-sw check
version: 0.7.1
check: ok

$ codex-sw ac login work --env default --mode auth
Logged in account: default/work

$ codex-sw ac use work --env default -t cli
Switched cli account to: default/work
```

### Scenario 2: Fresh machine, never logged in to Codex

Goal: create env first, login account, then switch into ready state.

```text
$ codex-sw check
version: 0.7.1
check: ok

$ codex-sw env new project-a --empty
Created env: project-a

$ codex-sw ac login corp --env project-a --mode auth
Logged in account: project-a/corp

$ codex-sw ac use corp --env project-a -t both
Switched both account to: project-a/corp

$ codex-sw whoami -t both
cli: project-a/corp
app: project-a/corp
```

### Scenario 3: API key mode (interactive input)

Goal: skip web login, save an API key account, then use it immediately.

```text
$ codex-sw ac login my-api --env default --mode apikey
Enter OpenAI API key: sk-xxxxxxxxxxxxxxxx
API key saved successfully for account: default/my-api
Logged in account: default/my-api

$ codex-sw ac use my-api --env default -t cli
Switched cli account to: default/my-api
```

### Scenario 4: Same machine, company account for CLI and personal for App

```text
$ codex-sw ac login company --env default --mode auth
Logged in account: default/company

$ codex-sw ac login personal --env default --mode auth
Logged in account: default/personal

$ codex-sw ac use company --env default -t cli
Switched cli account to: default/company

$ codex-sw ac use personal --env default -t app
Switched app account to: default/personal

$ codex-sw whoami -t both
cli: default/company
app: default/personal
```

## Core Commands

| Command | Description |
| --- | --- |
| `codex-sw env ls` | List envs |
| `codex-sw env new <env> [--empty\|--from <src-env\|default>]` | Create env |
| `codex-sw env use <env> [-t cli\|app\|both]` | Switch env |
| `codex-sw env rm <env> [--force]` | Remove env (double `y/n` confirmation) |
| `codex-sw ac ls [--env <env>]` | Show account overview |
| `codex-sw ac login <account> [--env <env>] [-t cli\|app\|both] [--sync\|--no-sync] [--mode auth\|apikey]` | Login account |
| `codex-sw ac use <account> [--env <env>] [-t cli\|app\|both] [--sync\|--no-sync] [--launch\|--no-launch] [-- <codex args...>]` | Switch account |
| `codex-sw ac logout [account] [--env <env>] [-t cli\|app\|both]` | Logout account |
| `codex-sw ac rm <account> [--env <env>] [--force]` | Remove account (double `y/n` confirmation) |
| `codex-sw whoami [-t cli\|app\|both]` | Show current env/account |
| `codex-sw status` | Show login status |
| `codex-sw lang [en]` | UI language (English-only) |
| `codex-sw` | Open interactive TUI by default (same as `codex-sw tui`) |
| `codex-sw tui` | Open interactive TUI (can execute all CLI commands) |
| `codex-sw version` | Show version |
| `codex-sw check` | Health check |
| `codex-sw upgrade [--dry-run]` | Upgrade tool |
| `codex-sw --help` | Show core help |
| `codex-sw --help-all` | Show full help |
