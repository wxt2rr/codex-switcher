# CLI Default Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scan, select, persist, and use a default CLI terminal on macOS and Windows.

**Architecture:** A focused Electron module owns terminal discovery and settings persistence. Bridge APIs expose scan/select state to React, while terminal launch builders consume the persisted normalized terminal ID and downgrade unsupported current-window requests to new windows.

**Tech Stack:** Electron, Node.js, TypeScript, React, Tailwind CSS

## Global Constraints

- Do not render an automatic option.
- Show only detected terminal applications.
- Persist selection immediately.
- Keep existing iTerm and Terminal behavior unchanged.
- Preserve the agreed platform priority order.

---

### Task 1: Terminal discovery and persistence

- [x] Add failing discovery, priority, invalid-selection fallback, and persistence tests.
- [x] Implement `cli-terminal-settings.ts`.
- [x] Verify focused tests.

### Task 2: Bridge and launch integration

- [x] Add bridge/preload/IPC contracts for get, rescan, and select.
- [x] Pass the selected terminal into launch planning.
- [x] Add Warp, Ghostty, PowerShell 7, Windows Terminal, Windows PowerShell, and Command Prompt plans.
- [x] Verify launch-plan regression tests.

### Task 3: System settings UI

- [x] Add state loading, auto-save with rollback, and rescan behavior.
- [x] Render a compact click-only dropdown and rescan button.
- [x] Verify UI contract tests.

### Task 4: Complete verification

- [x] Run all desktop tests.
- [x] Build production assets.
- [x] Package macOS arm64 app.
- [x] Run `git diff --check`.
