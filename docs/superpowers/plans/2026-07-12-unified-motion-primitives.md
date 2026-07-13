# Unified Motion Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mixed animation implementations with one interruptible, token-driven motion system for the desktop application.

**Architecture:** CSS motion primitives own transforms, opacity, timing, easing, and reduced-motion behavior. Radix and business components expose state through `data-state`; custom menus remain mounted briefly for exit transitions. No animation library is added.

**Tech Stack:** React, TypeScript, CSS transitions, Tailwind CSS, Radix UI.

## Global Constraints

- A component must not combine `tw-animate-css` state classes with project motion primitives.
- Dynamic menus, dialogs, tooltips, and notices use interruptible CSS transitions rather than entry keyframes.
- Only `transform` and `opacity` move; color feedback uses explicitly scoped transitions.
- Toggle movement uses `cubic-bezier(0.32, 0.72, 0, 1)` over 240ms.
- Popover enter/exit is 200ms/140ms, tooltip 140ms/100ms, notice 220ms/160ms, dialog 260ms/180ms.
- Reduced motion removes movement while retaining short opacity feedback.

---

### Task 1: Establish the unified motion contract

**Files:**
- Modify: `apps/desktop/src/index.css`
- Modify: `apps/desktop/src/components/responsive-layout.test.ts`

- [ ] Add semantic enter/exit tokens and reusable state-driven primitives.
- [ ] Remove the popover keyframe implementation.
- [ ] Add regression assertions against mixed Radix/Tailwind animation classes.

### Task 2: Migrate shared components

**Files:**
- Modify: `apps/desktop/src/components/ui/select.tsx`
- Modify: `apps/desktop/src/components/ui/tooltip.tsx`
- Modify: `apps/desktop/src/components/ui/button.tsx`
- Modify: `apps/desktop/src/components/admin-primitives.tsx`

- [ ] Connect Radix state to the shared popover and tooltip primitives.
- [ ] Move icon press feedback to the icon child rather than the button surface.
- [ ] Keep dialog blur static while opacity and transform animate.

### Task 3: Migrate business controls

**Files:**
- Modify: `apps/desktop/src/pages/accounts-page.tsx`
- Modify: `apps/desktop/src/pages/operations-page.tsx`
- Modify: `apps/desktop/src/components/account-list-primitives.tsx`

- [ ] Give custom menus an exit lifecycle using delayed unmount.
- [ ] Replace bare transitions with explicit motion classes.
- [ ] Apply the shared toggle and chevron movement primitives.

### Task 4: Verification

- [ ] Run all desktop tests.
- [ ] Run the production build.
- [ ] Run `git diff --check` and scan for mixed or bare motion declarations.
