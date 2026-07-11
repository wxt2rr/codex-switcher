# Desktop Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add restrained, accessible motion feedback across the desktop application.

**Architecture:** Define reusable motion primitives in the shared stylesheet, then apply them at stable shared boundaries: shell page content, record rows, controls, dialogs, menus, and progress indicators. Existing React state remains unchanged.

**Tech Stack:** React, TypeScript, Tailwind CSS v4, Radix UI, Node test runner.

## Global Constraints

- Do not add an animation dependency.
- Respect `prefers-reduced-motion`.
- Avoid floating cards, spring effects, and long stagger sequences.
- Do not publish or tag a release.

---

### Task 1: Shared motion primitives

**Files:**
- Modify: `apps/desktop/src/index.css`
- Test: `apps/desktop/src/components/responsive-layout.test.ts`

- [ ] Add short page, row, popover, and feedback keyframes using opacity and transform.
- [ ] Add active control feedback and reduced-motion overrides.
- [ ] Add assertions for the reduced-motion contract.

### Task 2: Component integration

**Files:**
- Modify: `apps/desktop/src/components/desktop-shell.tsx`
- Modify: `apps/desktop/src/components/admin-primitives.tsx`
- Modify: `apps/desktop/src/components/ui/select.tsx`
- Modify: `apps/desktop/src/pages/accounts-page.tsx`
- Modify: `apps/desktop/src/react-app.tsx`

- [ ] Re-trigger page entry on view changes.
- [ ] Apply popover and dialog motion at shared surfaces.
- [ ] Smooth progress width changes and record-row entry.

### Task 3: Verification

**Files:**
- Test: `apps/desktop/src/components/desktop-shell.test.ts`
- Test: `apps/desktop/src/components/responsive-layout.test.ts`

- [ ] Run the focused component tests.
- [ ] Run the desktop production build and full desktop suite.
- [ ] Commit implementation without publishing.

