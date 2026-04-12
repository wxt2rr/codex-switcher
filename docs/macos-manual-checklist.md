# macOS Manual Checklist

Run this checklist on a macOS machine with Codex.app installed.

## Setup

- [ ] `codex-sw check` returns `check: ok`
- [ ] `codex-sw add work` and `codex-sw add personal` succeed

## CLI isolation

- [ ] `codex-sw use work && codex-sw login`
- [ ] `codex-sw use personal && codex-sw login`
- [ ] `codex-sw status` shows both profiles logged in when selected as current

## App switching

- [ ] `codex-sw app use work` opens App
- [ ] `codex-sw app current` prints `work`
- [ ] `codex-sw app use personal` restarts App under `personal`
- [ ] `codex-sw app status` reports running when app is open
- [ ] `codex-sw app stop` stops managed app process

## Recovery and integrity

- [ ] Corrupt pointer file manually and run `codex-sw recover`
- [ ] `codex-sw doctor --fix` completes successfully
- [ ] `codex-sw check` passes after recovery

## Security checks

- [ ] `~/.codex-switcher` permission is `700`
- [ ] `~/.codex-profiles` permission is `700`
- [ ] no tokens are visible in `~/.codex-switcher/switcher.log`
