# Emil Motion Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop app feel faster and more coherent by applying Emil Kowalski and Apple interaction principles to shared buttons, selects, popovers, dialogs, notifications, page transitions, and reduced-motion behavior.

**Architecture:** Keep the existing React, Tailwind CSS, and Radix stack. Centralize strong easing and duration tokens in `index.css`, make shared primitives consume precise transition properties, separate centered dialog motion from trigger-anchored popover motion, and remove decorative motion from frequently visited cards and rows.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Radix UI, Node test runner.

## Global Constraints

- Do not introduce a new animation dependency.
- UI motion stays below 300ms.
- Animate only transform and opacity for spatial motion.
- Buttons respond on press with subtle scale feedback.
- Trigger-anchored menus use direction-aware transform origins; centered dialogs use a centered origin.
- Reduced-motion mode keeps color and opacity feedback while removing spatial movement.
- Preserve all business behavior and page layout.

---

### Task 1: Lock the motion contract with regression tests

**Files:**
- Modify: `apps/desktop/src/components/responsive-layout.test.ts`

**Interfaces:**
- Consumes: existing source-text UI contract tests.
- Produces: assertions preventing `transition-all`, decorative record animation, fixed popover origin, and movement-heavy reduced-motion behavior.

- [ ] Add failing assertions for precise button/select transitions, press scale, direction-aware popover origin, separate dialog motion, static record rows, and reduced-motion overrides.
- [ ] Run `npx tsx --test apps/desktop/src/components/responsive-layout.test.ts` and confirm failure.

### Task 2: Refine global motion tokens and shared primitives

**Files:**
- Modify: `apps/desktop/src/index.css`
- Modify: `apps/desktop/src/components/ui/button.tsx`
- Modify: `apps/desktop/src/components/ui/select.tsx`

**Interfaces:**
- Produces: `--ease-out`, `--ease-in-out`, crisp duration tokens, `.motion-dialog-enter`, direction-aware `.motion-popover-enter`, and interruptible `.motion-notice-enter`.

- [ ] Replace weak or unbounded transitions with exact properties and strong custom easing.
- [ ] Add `active:scale-[0.97]` to shared buttons with a 140ms transform response.
- [ ] Give Radix selects origin-aware content motion and explicit trigger transitions.
- [ ] Replace toast keyframe entry with an interruptible transition and `@starting-style`.

### Task 3: Reduce frequent decorative motion and distinguish dialogs

**Files:**
- Modify: `apps/desktop/src/components/admin-primitives.tsx`
- Modify: `apps/desktop/src/components/desktop-shell.tsx`
- Modify: `apps/desktop/src/index.css`

**Interfaces:**
- Consumes: Task 2 motion classes and tokens.
- Produces: static frequently visited cards/rows, a 220ms sidebar, centered dialog animation, and a lightweight page fade.

- [ ] Remove repeated entrance animations from headers, toolbars, cards, summary panels, and record rows.
- [ ] Switch dialogs from popover motion to centered dialog motion.
- [ ] Shorten sidebar movement to 220ms with strong ease-in-out and replace remaining `transition-all` declarations in the shell.
- [ ] Keep page switching as a short opacity-only transition.

### Task 4: Verify the complete desktop application

**Files:**
- Test: `apps/desktop/src/components/responsive-layout.test.ts`
- Test: `apps/desktop/src/components/desktop-shell.test.ts`

**Interfaces:**
- Produces: build and regression evidence for the complete change.

- [ ] Run `npx tsx --test apps/desktop/src/components/responsive-layout.test.ts apps/desktop/src/components/desktop-shell.test.ts`.
- [ ] Run `npm run build --workspace ./apps/desktop`.
- [ ] Run `npm run test:desktop --workspace ./apps/desktop`.
- [ ] Run `git diff --check`.
