# Windows Manual Checklist Result Template

Use this template after running [windows-manual-checklist.md](windows-manual-checklist.md) on a real Windows machine.

You can generate this file together with baseline command evidence via `scripts/windows-manual-start.ps1`, or generate only the prefilled working copy with `scripts/windows-manual-result-template.ps1`.

From a source checkout, the shortcut commands are `npm run windows:manual:start` and `npm run windows:manual:result-template`.
Use the raw PowerShell helper commands when you are validating from packaged contents that include `scripts/` but not the repository npm scripts.

## Session Metadata

- Date:
- Operator:
- Machine:
- Windows version:
- Codex version:
- codex-switcher version:
- Install source:
  - [ ] npm global install
  - [ ] source install
- Shells verified:
  - [ ] PowerShell
  - [ ] cmd
  - [ ] Windows Terminal

## Checklist Result

- [ ] Setup
- [ ] Shell install paths
- [ ] CLI isolation
- [ ] App switching
- [ ] TUI checks
- [ ] Gateway and plugin isolation
- [ ] Packaging and update recovery
- [ ] Recovery and integrity
- [ ] Token refresh and logs
- [ ] Security checks

## Command Evidence

If you used `scripts/windows-manual-capture.ps1`, note whether you ran it from a repository checkout or from a package contents directory, attach `windows-manual-evidence.txt` and the generated `windows-sandbox.json` when the AppContainer helper was available, then paste or summarize the most important outputs here. If the helper was unavailable, preserve the explicit `SKIPPED` line instead of treating the smoke as passed:

```text
codex-sw check:

codex-sw platform:

codex-sw ops doctor:

codex-sw app status:

codex-sw ops token-refresh status:
```

## Notes by Section

### Setup

- Outcome:
- Evidence:

### Shell install paths

- Outcome:
- Evidence:

### CLI isolation

- Outcome:
- Evidence:

### App switching

- Outcome:
- Evidence:

### TUI checks

- Outcome:
- Evidence:

### Gateway and plugin isolation

- Outcome:
- Evidence file: `windows-sandbox.json`
- `writeDenied`:
- `homeReadDenied`:
- `networkDenied`:
- `markerAbsent`:
- `filesystemWriteGranted`:

### Packaging and update recovery

- Outcome:
- Installer path:
- Package verification:
- Authenticode status:
- Upgrade dry-run:
- Failed-boot rollback result:

### Recovery and integrity

- Outcome:
- Evidence:

### Token refresh and logs

- Outcome:
- Evidence:

### Security checks

- Outcome:
- Evidence:

## Open Issues

- Issue:
- Impact:
- Reproduction:
- Suggested next step:

## Final Verdict

- [ ] Passed without blockers
- [ ] Passed with minor caveats
- [ ] Failed and needs code changes

Summary:
