# codex-switcher

[中文](README.md) | English

Profile-based account switcher for Codex CLI and Codex App.

## Core idea

- One profile = one isolated `CODEX_HOME` directory: `~/.codex-profiles/<profile>`
- CLI commands run under selected CLI profile
- App is restarted under selected App profile
- Current pointers are stored in `~/.codex-switcher/current_cli` and `~/.codex-switcher/current_app`

## Commands

```bash
codex-switcher add <profile>
codex-switcher remove <profile> [--force]
codex-switcher list
codex-switcher import-default <profile> [--with-auth] [--force]
codex-switcher use <profile> [--sync|--no-sync]
codex-switcher switch <profile> [--sync|--no-sync]
codex-switcher current [cli|app]
codex-switcher status

codex-switcher exec -- <codex args...>
codex-switcher login [profile] [--sync|--no-sync]
codex-switcher logout [profile]
codex-switcher env [profile]

codex-switcher app open [profile]
codex-switcher app use <profile>
codex-switcher app logout [profile]
codex-switcher app status
codex-switcher app stop

codex-switcher init [--shell zsh|bash]
codex-switcher upgrade [--dry-run]
codex-switcher recover
codex-switcher check
codex-switcher doctor [--fix]
```

## Typical flow

```bash
codex-switcher add work
codex-switcher add personal

codex-switcher use work --sync
codex-switcher login --sync
codex-switcher exec -- login status

codex-switcher switch personal --sync
codex-switcher app use personal
```

## Migrate Existing App/CLI Data

If your existing data is in `~/.codex`, import it into a profile first:

```bash
codex-switcher import-default work
```

This copies records/projects/history but excludes `auth.json` by default.
If you want to carry login state too:

```bash
codex-switcher import-default work --with-auth
```

## Sync Behavior

- `login --sync`: overwrite sync from default `~/.codex` to target profile, excluding `auth.json`.
- `use/switch --sync`: overwrite sync from current CLI profile to target profile, excluding `auth.json`.
- `--no-sync`: explicit no-sync mode (default behavior).

Examples:

```bash
codex-switcher login work --sync
codex-switcher switch personal --sync
codex-switcher use work --no-sync
```

## Upgrade

```bash
codex-switcher upgrade
```

## Notes

- Codex App is single-instance on macOS; switching App profile requires restart.
- `codex-switcher app stop` only stops app instances started and tracked by `codex-switcher`.
- `codex-switcher app open/use <profile>` requires that profile already exists and is logged in.
- `--sync` uses overwrite strategy (not merge): source overwrites target for all files except `auth.json`.
- `codex-switcher status` exit codes:
  - `0`: both current profiles logged in
  - `1`: at least one current profile not logged in
  - `2`: pointer/profile integrity issue (run `codex-switcher recover`)

## Validation

```bash
./plugins/codex-switcher/scripts/test-switcher.sh
```

## Compatibility command

`codex-sw` is kept as a compatibility entrypoint and maps to the same implementation.
