# Icon Button Hover Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add consistent hover names to all icon-only desktop buttons without changing layout or click behavior.

**Architecture:** Use the native `title` attribute as the shared lightweight tooltip contract. The shared icon action component covers responsive list actions; raw icon buttons mirror their localized `aria-label` into `title`.

**Tech Stack:** React 19, TypeScript, Node test runner.

## Global Constraints

- Reuse the existing localized accessible label.
- Do not change button dimensions, responsive behavior, or click handlers.
- Do not replace existing rich help popovers.

---

### Task 1: Shared icon action contract

**Files:**
- Modify: `apps/desktop/src/components/account-list-primitives.tsx`
- Modify: `apps/desktop/src/components/responsive-layout.test.ts`

- [x] Add a failing source-contract assertion for `title={label}`.
- [x] Set `title={label}` on `IconActionButton`.
- [x] Run the responsive layout test.

### Task 2: Raw icon-only controls

**Files:**
- Modify: `apps/desktop/src/components/desktop-shell.tsx`
- Modify: `apps/desktop/src/components/account-list-primitives.tsx`
- Modify: `apps/desktop/src/pages/accounts-page.tsx`
- Modify: `apps/desktop/src/pages/environments-page.tsx`
- Modify: `apps/desktop/src/pages/overview-page.tsx`
- Modify: `apps/desktop/src/pages/usage-page.tsx`

- [x] Mirror each raw icon button's localized `aria-label` into `title`.
- [x] Run web TypeScript validation.
- [x] Run the desktop regression suite excluding the known unrelated builder target assertion.
