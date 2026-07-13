# Desktop Motion Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make desktop motion calm and consistent, remove press jitter, and give notices enough readable time with graceful dismissal.

**Architecture:** Centralize timing in CSS motion tokens, keep press feedback only on compact icon controls, and use small presence wrappers for UI that needs an exit phase before unmounting. Toast timing is tone-aware and pauses while hovered.

**Tech Stack:** React, TypeScript, Tailwind CSS, CSS transitions, Node test runner.

## Global Constraints

- Ordinary buttons, selects, and navigation rows must not scale on press.
- Icon-only buttons may use a subtle `0.98` press scale.
- Toasts remain visible for 4 seconds, errors for 6 seconds, pause on hover, and exit in 140ms.
- Popovers use an 0.98 initial scale and dialogs use 220ms enter / 160ms exit.
- High-frequency page navigation must not replay a page entrance animation.
- Reduced-motion behavior remains supported.

---

### Task 1: Motion contract and regression coverage

**Files:**
- Modify: `apps/desktop/src/components/responsive-layout.test.ts`
- Modify: `apps/desktop/src/index.css`

- [ ] Update motion assertions to reject broad press scaling and require asymmetric notice/dialog timing.
- [ ] Define semantic motion duration variables and calm entrance/exit states.
- [ ] Run the focused desktop UI tests.

### Task 2: Stable controls

**Files:**
- Modify: `apps/desktop/src/components/ui/button.tsx`
- Modify: `apps/desktop/src/components/ui/select.tsx`
- Modify: `apps/desktop/src/components/desktop-shell.tsx`

- [ ] Remove press scale from ordinary buttons, selects, and navigation rows.
- [ ] Retain a subtle press response only on icon-sized controls.
- [ ] Remove the repeated page entrance animation from navigation.

### Task 3: Notice lifecycle

**Files:**
- Create: `apps/desktop/src/components/desktop-notice.tsx`
- Modify: `apps/desktop/src/components/desktop-shell.tsx`
- Modify: `apps/desktop/src/react-app.tsx`

- [ ] Move notice visibility into an interruptible component.
- [ ] Add 4s/6s tone-aware durations, hover pause, and a 140ms exit phase.
- [ ] Clear the owning notice only after the exit transition finishes.

### Task 4: Dialog presence and verification

**Files:**
- Create: `apps/desktop/src/components/use-delayed-unmount.ts`
- Modify: `apps/desktop/src/components/admin-primitives.tsx`

- [ ] Keep dialogs mounted for their 160ms exit transition.
- [ ] Apply open/closed data states to overlay and surface.
- [ ] Run all desktop tests, production build, and `git diff --check`.
