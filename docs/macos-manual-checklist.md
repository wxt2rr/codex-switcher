# macOS Manual Checklist

Run this checklist on a macOS machine with Codex.app installed.

## Setup

- [ ] `codex-sw check` returns `check: ok`

## CLI isolation

- [ ] `codex-sw ac login work --env default`
- [ ] `codex-sw ac login personal --env default`
- [ ] `codex-sw status` shows both accounts logged in when selected as current env/account

## App switching

- [ ] `codex-sw ac use work -t app && codex-sw app restart-current` opens App
- [ ] `codex-sw whoami -t app` prints `default/work`
- [ ] `codex-sw ac use personal -t app && codex-sw app restart-current` restarts App under `default/personal`

## Recovery and integrity

- [ ] Corrupt pointer file manually and run `codex-sw ops recover`
- [ ] `codex-sw ops doctor --fix` completes successfully
- [ ] `codex-sw check` passes after recovery

## Token refresh and logs

- [ ] `codex-sw ops token-refresh start` enables launchd job
- [ ] `codex-sw ops token-refresh status` shows `enabled` and a valid log path
- [ ] `codex-sw ops token-refresh run-once` prints summary fields (`scanned/skipped/refreshed/changed/failed`)
- [ ] Open TUI and enter `Logs`; log content is visible and `q`/`Esc` returns to home
- [ ] `codex-sw ops token-refresh stop` disables launchd job

## Security checks

- [ ] `~/.codex-switcher` permission is `700`
- [ ] `~/.codex-envs` permission is `700`
- [ ] `~/.codex-switcher/env-accounts` permission is `700`
- [ ] no tokens are visible in `~/.codex-switcher/switcher.log`
