# codex-switcher

[中文](README.md) | English

`codex-switcher` is a lightweight profile switcher for Codex CLI and Codex App.
It isolates accounts by running each profile in its own `CODEX_HOME` directory.

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

`codex-switcher` solves this by assigning each account its own `CODEX_HOME` (`~/.codex-profiles/<profile>`) and switching that directory for CLI/App operations.

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
codex-switcher add work
codex-switcher add personal

codex-switcher use work --sync
codex-switcher login --sync
codex-switcher exec -- login status

codex-switcher switch personal --sync
codex-switcher app use personal
```

## Sync options

- `login --sync`: sync `~/.codex` into the target profile (excluding `auth.json`).
- `use/switch --sync`: sync current CLI profile into target profile (excluding `auth.json`).
- `--no-sync`: keep strict isolation without data copy (default).

## Command reference

See plugin guide:
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
