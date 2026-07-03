# Windows Handoff

This document is the handoff package for continuing `codex-switcher` Windows-native validation work on a real Windows machine.

## Goal

Finish the last unproven part of the current migration:

- verify real Windows execution for `cmd`
- verify real Windows execution for `PowerShell`
- verify real Windows execution for `Windows Terminal`
- confirm macOS-safe changes remain intact while collecting Windows evidence

## Current Repository State

- Repository-side implementation is in place for Windows-native CLI/TUI flows.
- macOS keeps the legacy Bash-default workflow.
- Automated repository evidence is currently green:
  - `npm run test:cross-platform`
  - `npm run desktop:test`
- One lifecycle-sensitive CLI test is intentionally skipped by default inside Codex App.
- That lifecycle-sensitive coverage can be re-enabled from an external terminal with:

```bash
npm run test:lifecycle
```

## Primary Source Files

Review these first in the Windows session:

- [windows-support-audit.md](./windows-support-audit.md)
- [windows-manual-checklist.md](./windows-manual-checklist.md)
- [windows-manual-checklist-result-template.md](./windows-manual-checklist-result-template.md)

## What To Run On Windows

From a repository checkout:

```bash
npm ci
npm run test:cross-platform
npm run test:lifecycle
npm run windows:manual:start
```

The key repository commands are:

- `npm run test:cross-platform`
- `npm run test:lifecycle`
- `npm run windows:manual:start`

If validation is happening from packaged contents instead of a source checkout, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-manual-start.ps1 -EvidencePath .\windows-manual-evidence.txt -ResultPath .\windows-manual-result.md
```

## Expected Artifacts

The Windows session should produce or update:

- `windows-manual-evidence.txt`
- `windows-manual-result.md`

Use those outputs to complete the checklist verdict.

## What To Tell Codex On Windows

Start a new Codex session on Windows in this repository and send a prompt like:

```text
Continue the Windows-native support handoff for codex-switcher. Read docs/windows-handoff.md first, then use docs/windows-support-audit.md and docs/windows-manual-checklist.md as the source of truth. Run the safe automated checks first, then execute the real Windows validation flow, collect evidence, and update the result document.
```

## Completion Criteria

The Windows continuation should only claim completion after:

- `npm run test:cross-platform` passes on Windows
- `npm run test:lifecycle` is executed from an external terminal
- the manual checklist is completed on a real Windows machine
- `windows-manual-evidence.txt` is attached or preserved
- `windows-manual-result.md` contains a final verdict

## Notes

- Do not remove the macOS Bash-default behavior while validating Windows support.
- Do not treat repository tests alone as final proof.
- The remaining gap is real-machine evidence, not obvious repository implementation work.
