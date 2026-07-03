# Windows Manual Checklist

Run this checklist on a real Windows machine with Codex installed.

Record the execution result in [docs/windows-manual-checklist-result-template.md](docs/windows-manual-checklist-result-template.md).

Before running the checklist, you can generate both the baseline evidence file and a prefilled result markdown with:

From a source checkout, the shortest entry point is:

```bash
npm run windows:manual:start
```

If you only want to refresh the evidence capture or regenerate the result template from a source checkout, you can also use:

```bash
npm run windows:manual:capture
npm run windows:manual:result-template
```

Run the command below from a repository checkout or from a package contents directory that includes the `scripts/` helper files.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-manual-start.ps1 -EvidencePath .\windows-manual-evidence.txt -ResultPath .\windows-manual-result.md
```

This generates both `windows-manual-evidence.txt` and `windows-manual-result.md`.
If you are validating a source checkout instead of an npm install, append `-InstallSource "source install"`.

To prefill the result markdown with machine metadata, you can also generate a working copy with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-manual-result-template.ps1 -OutputPath .\windows-manual-result.md
```

Use the PowerShell commands above when you are validating from packaged contents that include the helper scripts but do not include the repository `package.json` shortcuts.

## Setup

- [ ] `codex-sw check` returns `check: ok`
- [ ] `codex-sw platform` returns `windows`
- [ ] `codex-sw ops doctor` shows Windows launcher discovery and PowerShell/cmd readiness details

## Shell install paths

- [ ] `node scripts/bin/codex-sw-node.cjs install --shell powershell` writes the launcher and PowerShell profile init block
- [ ] Open a new PowerShell session and confirm `codex-sw check` still returns `check: ok`
- [ ] `node scripts/bin/codex-sw-node.cjs install --shell cmd` writes `cmd-init.bat`
- [ ] Open a new `cmd` session, run `call %USERPROFILE%\cmd-init.bat`, and confirm `codex-sw check` returns `check: ok`
- [ ] `node scripts/bin/codex-sw-node.cjs install --shell windows-terminal` completes successfully
- [ ] Open a new Windows Terminal tab and confirm `codex-sw check` returns `check: ok`

## CLI isolation

- [ ] `codex-sw ac login work --env default`
- [ ] `codex-sw ac login personal --env default`
- [ ] `codex-sw status` shows the selected env/account state without overwriting the other account slot
- [ ] `codex-sw ac use work -t cli` followed by `codex-sw whoami -t cli` prints `default/work`
- [ ] `codex-sw ac use personal -t cli` followed by `codex-sw whoami -t cli` prints `default/personal`

## App switching

- [ ] `codex-sw ac use work -t app && codex-sw app restart-current` opens Codex under `default/work`
- [ ] `codex-sw whoami -t app` prints `default/work`
- [ ] `codex-sw ac use personal -t app && codex-sw app restart-current` reopens Codex under `default/personal`
- [ ] `codex-sw app launch-new` launches an additional managed App instance
- [ ] `codex-sw app status` reports the current managed pid
- [ ] `codex-sw app stop-managed` stops the managed App instance without damaging CLI state

## TUI checks

- [ ] `codex-sw` opens the TUI home screen
- [ ] Home screen shows `Proxy`, `Setup`, `Refresh`, and `Logs`
- [ ] `Setup` shows a Windows recommendation plus concrete init target paths
- [ ] Selecting `cmd`, `PowerShell`, and `Windows Terminal` updates the displayed init target path accordingly
- [ ] `Refresh` runs one token-refresh scan
- [ ] `Logs` opens the token-refresh log view and `q` / `Esc` returns to home

## Recovery and integrity

- [ ] Corrupt a pointer file manually and run `codex-sw ops recover`
- [ ] `codex-sw ops doctor --fix` completes successfully
- [ ] `codex-sw check` passes after recovery

## Token refresh and logs

- [ ] `codex-sw ops token-refresh start` creates or updates the scheduled task
- [ ] `codex-sw ops token-refresh status` shows `enabled` and a valid log path
- [ ] `codex-sw ops token-refresh run-once` prints summary fields (`scanned/skipped/refreshed/changed/failed`)
- [ ] `codex-sw ops token-refresh stop` disables the scheduled task

## Security checks

- [ ] `%USERPROFILE%\.codex-switcher` exists
- [ ] `%USERPROFILE%\.codex-envs` exists
- [ ] `%USERPROFILE%\.codex-switcher\env-accounts` exists
- [ ] no tokens are visible in `%USERPROFILE%\.codex-switcher\switcher.log`
