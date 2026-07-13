# CLI Auto Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optionally launch Codex CLI by resuming the nth most recent session for the current project.

**Architecture:** Persist a small desktop setting, discover session IDs from Codex's session metadata and index, and inject `resume <id>` into the existing cross-platform launch plan. Resolution failures fall back to a fresh CLI launch with a warning.

**Tech Stack:** Electron, TypeScript, React, Node.js filesystem APIs

## Global Constraints

- Disabled by default; default session number is 1.
- Support macOS, Windows, and Linux through CLI arguments, not keyboard automation.
- Auto-resume failures must not fail CLI launch or account switching.

---

### Task 1: Session discovery

**Files:**
- Modify: `apps/desktop/electron/codex-projects.ts`
- Test: `apps/desktop/electron/codex-projects.test.ts`

- [x] Add tests for cwd-filtered, activity-sorted session selection.
- [x] Implement `findCodexResumeSession(codexHome, cwd, sessionNumber)`.
- [x] Run the focused tests.

### Task 2: Settings and bridge integration

**Files:**
- Create: `apps/desktop/electron/desktop-settings.ts`
- Create: `apps/desktop/electron/desktop-settings.test.ts`
- Modify: `apps/desktop/electron/bridge.ts`
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/src/bridge.ts`

- [x] Add settings read/write validation tests.
- [x] Expose get/save IPC methods.
- [x] Resolve resume arguments before building terminal launch plans, falling back to fresh launch.
- [x] Run bridge and settings tests.

### Task 3: System UI

**Files:**
- Modify: `apps/desktop/src/react-app.tsx`
- Modify: `apps/desktop/src/pages/operations-page.tsx`

- [x] Load the persisted setting on startup.
- [x] Add enable and positive integer controls to System Management.
- [x] Save via the bridge and show normal success/error feedback.
- [x] Run desktop tests and build/package verification.
