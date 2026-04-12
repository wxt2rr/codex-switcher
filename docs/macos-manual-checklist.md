# macOS Manual Checklist

Run this checklist on a macOS machine with Codex.app installed.

## Setup

- [ ] `codex-sw check` returns `check: ok`
- [ ] `codex-sw account add work --env default` and `codex-sw account add personal --env default` succeed

## CLI isolation

- [ ] `codex-sw account use work --env default && codex-sw login`
- [ ] `codex-sw account use personal --env default && codex-sw login`
- [ ] `codex-sw status` shows both accounts logged in when selected as current env/account

## App switching

- [ ] `codex-sw app use work` opens App
- [ ] `codex-sw app current` prints `default/work`
- [ ] `codex-sw app use personal` restarts App under `default/personal`
- [ ] `codex-sw app status` reports running when app is open
- [ ] `codex-sw app stop` stops managed app process

## Recovery and integrity

- [ ] Corrupt pointer file manually and run `codex-sw recover`
- [ ] `codex-sw doctor --fix` completes successfully
- [ ] `codex-sw check` passes after recovery

## Security checks

- [ ] `~/.codex-switcher` permission is `700`
- [ ] `~/.codex-envs` permission is `700`
- [ ] `~/.codex-switcher/env-accounts` permission is `700`
- [ ] no tokens are visible in `~/.codex-switcher/switcher.log`
