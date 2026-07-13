# Dialog Select Click-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require manual clicks to open account dialog selects while preserving hover-open selects elsewhere.

**Architecture:** Add an opt-out flag to the shared form `Select`. When disabled, omit both the hover-open handler and pointer-intent tracking; account SidePanel select instances opt out explicitly.

**Tech Stack:** React, TypeScript, Radix Select, Node test runner

## Global Constraints

- Shared selects keep hover-open behavior by default.
- All selects inside account edit/create and runtime SidePanels open only on click.
- Selection, keyboard, focus, and outside-click behavior remain provided by Radix Select.

---

### Task 1: Add regression coverage

**Files:**
- Modify: `apps/desktop/src/components/responsive-layout.test.ts`

- [x] Assert the shared Select exposes `openOnHover = true` and gates hover behavior.
- [x] Assert the account SidePanel selects pass `openOnHover={false}`.
- [x] Run the focused test and confirm it fails before implementation.

### Task 2: Implement scoped click-only behavior

**Files:**
- Modify: `apps/desktop/src/components/form-primitives.tsx`
- Modify: `apps/desktop/src/pages/accounts-page.tsx`

- [x] Add the `openOnHover?: boolean` prop with a default of `true`.
- [x] Skip hover event binding and pointer-intent tracking when the prop is false.
- [x] Set `openOnHover={false}` on every Select inside the account SidePanels.
- [x] Run the focused test and confirm it passes.

### Task 3: Verify and package

**Files:**
- Verify only

- [x] Run all desktop tests.
- [x] Build the production desktop bundle.
- [x] Package the macOS arm64 directory app.
- [x] Run `git diff --check`.
