# Compact CLI Auto Resume Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oversized CLI auto-resume settings panel with a compact system row that auto-saves changes.

**Architecture:** Keep visual draft handling in `OperationsPage` and persistence in `ReactApp`. The row uses the same two-column structure as the other system settings, shows the order control only while enabled, and rolls back optimistic changes when persistence fails.

**Tech Stack:** React, TypeScript, Tailwind CSS, Node test runner

## Global Constraints

- Preserve arbitrary positive resume order values.
- Do not change the existing CLI session lookup or launch behavior.
- Remove the explicit save button and persist switch/order changes automatically.
- Disable only the auto-resume controls while that setting is being saved.

---

### Task 1: Lock the compact UI contract

**Files:**
- Modify: `apps/desktop/src/components/responsive-layout.test.ts`

**Interfaces:**
- Consumes: source code for `OperationsPage` and `ReactApp`
- Produces: regression assertions for compact layout and automatic persistence

- [x] **Step 1: Replace the old nested-panel assertions**

Assert that the auto-resume row uses `OperationCard`, contains a switch and compact order copy, exposes `autoResumeSaving`, and no longer contains `保存设置`, `autoResumeDirty`, or the nested gray settings panel.

- [x] **Step 2: Run the focused test and confirm it fails**

Run: `node --import tsx --test apps/desktop/src/components/responsive-layout.test.ts`

Expected: FAIL because the current page still renders the nested panel and manual save button.

### Task 2: Implement compact auto-saving controls

**Files:**
- Modify: `apps/desktop/src/pages/operations-page.tsx`
- Modify: `apps/desktop/src/react-app.tsx`

**Interfaces:**
- Consumes: `CliAutoResumeSettings`, `bridge.setCliAutoResumeSettings(settings)`
- Produces: `onCliAutoResumeChange(next)` for persisted updates and `autoResumeSaving` for the local disabled state

- [x] **Step 1: Render the setting with `OperationCard`**

Use a single row. Put a compact `最近第 [number] 个` input and switch on the right, hiding the number input while disabled. Keep one switch across all breakpoints.

- [x] **Step 2: Keep numeric editing local until commit**

Synchronize a local positive-integer draft from props. Commit it on blur or Enter so multi-digit values are not saved one keystroke at a time.

- [x] **Step 3: Auto-save and roll back in `ReactApp`**

Optimistically show the next value, save it through the bridge, update the saved value on success, and restore the previous saved value on failure. Use a dedicated `autoResumeSaving` state instead of the page-wide busy state.

- [x] **Step 4: Run the focused test and confirm it passes**

Run: `node --import tsx --test apps/desktop/src/components/responsive-layout.test.ts`

Expected: PASS.

### Task 3: Verify and package

**Files:**
- Verify only

**Interfaces:**
- Consumes: completed desktop source
- Produces: tested build and refreshed macOS app bundle

- [x] **Step 1: Run all desktop tests**

Run: `npm run test:desktop --workspace ./apps/desktop`

Expected: all tests pass.

- [x] **Step 2: Build and package the desktop app**

Run: `npm run build --workspace ./apps/desktop`

Run: `npm run package:mac:dir --workspace ./apps/desktop`

Expected: both commands exit successfully and refresh `apps/desktop/release/mac-arm64/codex-switcher.app`.

- [x] **Step 3: Check the patch**

Run: `git diff --check`

Expected: no whitespace errors.
