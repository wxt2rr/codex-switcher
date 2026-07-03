# Windows Support Audit

Last updated: 2026-07-02

## Goal

Prove how far `codex-switcher` has progressed toward Windows-native support for `cmd`, `PowerShell`, and `Windows Terminal`, without regressing current macOS behavior.

## Proven by Current Repository Evidence

### CLI and TUI command surface

- Windows-facing command surface is documented in [README.md](README.md) and [README.en.md](README.en.md).
- Cross-platform CLI/TUI coverage is exercised by `npm run test:cross-platform`.
- GitHub Actions also runs that suite on `windows-latest`, `macos-latest`, and `ubuntu-latest` via [.github/workflows/ci.yml](../.github/workflows/ci.yml).
- Current evidence from the latest local run:
  - `npm run test:cross-platform`
  - Result: passed with one intentional lifecycle-sensitive skip in the current Codex App environment

### Windows shell targets

- `powershell`, `cmd`, and `windows-terminal` install/init flows are covered by:
  - [scripts/node-cli.test.ts](../scripts/node-cli.test.ts)
  - [scripts/install-wrapper.test.ts](../scripts/install-wrapper.test.ts)
  - [packages/core/src/tui/setup.test.ts](../packages/core/src/tui/setup.test.ts)
- TUI setup diagnostics and target path rendering are covered in the same test set.

### Desktop bridge behavior

- Desktop bridge Windows launch planning and cross-platform wording are covered by:
  - [apps/desktop/electron/bridge-smoke.test.ts](../apps/desktop/electron/bridge-smoke.test.ts)
  - `npm run desktop:test`
- macOS desktop regression coverage is also enforced in GitHub Actions via `.github/workflows/ci.yml`.
- Current evidence from the latest local run:
  - `npm run desktop:test`
  - Result: passed

### Windows validation handoff assets

- Manual checklist: [windows-manual-checklist.md](windows-manual-checklist.md)
- Result template: [windows-manual-checklist-result-template.md](windows-manual-checklist-result-template.md)
- Baseline evidence capture: [../scripts/windows-manual-capture.ps1](../scripts/windows-manual-capture.ps1)
- Prefilled result generator: [../scripts/windows-manual-result-template.ps1](../scripts/windows-manual-result-template.ps1)
- One-command launcher: [../scripts/windows-manual-start.ps1](../scripts/windows-manual-start.ps1)

### Guard coverage for the handoff assets

- Checklist guard: [../scripts/windows-manual-checklist.test.ts](../scripts/windows-manual-checklist.test.ts)
- Capture script guard: [../scripts/windows-manual-capture.test.ts](../scripts/windows-manual-capture.test.ts)
- Start script guard: [../scripts/windows-manual-start.test.ts](../scripts/windows-manual-start.test.ts)
- Result template doc guard: [../scripts/windows-manual-result-template.test.ts](../scripts/windows-manual-result-template.test.ts)
- Result template generator guard: [../scripts/windows-manual-result-template-script.test.ts](../scripts/windows-manual-result-template-script.test.ts)
- Package publish guard: [../scripts/package-files.test.ts](../scripts/package-files.test.ts)

## Intentionally Limited or Deferred

- One lifecycle-sensitive test remains skipped in the current Codex App environment:
  - `node-cli supports app stop-managed without bash`
  - Reason: avoid real quit/restart confirmation dialogs from blocking the Codex session
  - To re-enable it from an external terminal, run: `npm run test:lifecycle`
- This skip does not remove all stop-managed coverage:
  - injected-path coverage still exists in [scripts/node-cli.test.ts](../scripts/node-cli.test.ts)
  - stop-plan coverage exists in [packages/core/src/platform/codex-app-stop.test.ts](../packages/core/src/platform/codex-app-stop.test.ts)

## Remaining Unproven Requirement

The repository still lacks authoritative runtime evidence from a real Windows machine.

That means the following claim is not yet fully proven:

- "`codex-switcher` is fully Windows-supported in real execution for `cmd`, `PowerShell`, and `Windows Terminal`."

## What Would Close the Gap

Run the one-command Windows validation flow on a real Windows machine:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-manual-start.ps1 -EvidencePath .\windows-manual-evidence.txt -ResultPath .\windows-manual-result.md
```

Then complete the remaining checklist items in [windows-manual-checklist.md](windows-manual-checklist.md), attach the generated evidence file, and fill the final verdict in [windows-manual-checklist-result-template.md](windows-manual-checklist-result-template.md) or the generated `windows-manual-result.md`.

## Current Audit Verdict

- Repository implementation: strong
- Automated cross-platform evidence: strong
- Windows handoff assets: strong
- Real Windows runtime proof: missing

Overall status: not yet complete, but blocked only on external Windows execution evidence rather than obvious repository gaps.
