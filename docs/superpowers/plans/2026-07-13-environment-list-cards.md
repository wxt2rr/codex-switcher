# Environment List Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the environment page's continuous table-like list with independent row cards matching the model page.

**Architecture:** Reuse the shared `ListStack` and `ListCard` primitives. Keep environment data and callbacks unchanged; only adjust the list container, card presentation, path typography, and responsive structural tests.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Node test runner, Vite/Electron

## Global Constraints

- Preserve the title, toolbar, search, create action, and three summary statistics.
- Preserve all environment callbacks, side panels, dialogs, routing, and empty states.
- Do not modify the usage trend chart as part of this change.
- Preserve unrelated uncommitted workspace changes.

---

### Task 1: Lock the independent-card contract

**Files:**
- Test: `apps/desktop/src/components/responsive-layout.test.ts`

**Interfaces:**
- Consumes: the environment page source as the existing `environments` fixture.
- Produces: structural assertions for `ListStack`, standalone `ListCard`, path typography, and removed table treatments.

- [ ] **Step 1: Add failing assertions**

Require the environment page to import and render `ListStack`, use a standalone `responsive-environment-row` card, render the path with `font-mono`, and omit `!rounded-none`, `!shadow-none`, alternating row backgrounds, and the continuous `overflow-auto ... border ... bg-white` list wrapper.

- [ ] **Step 2: Run the focused structural test**

Run from `apps/desktop`: `npm exec -- tsx --test src/components/responsive-layout.test.ts`

Expected: FAIL because the environment page still uses the continuous table-like container.

### Task 2: Convert the environment list presentation

**Files:**
- Modify: `apps/desktop/src/pages/environments-page.tsx`

**Interfaces:**
- Consumes: `ListStack`, `ListCard`, existing `EnvCard` props and callbacks.
- Produces: independent environment row cards with identity, path, and action regions.

- [ ] **Step 1: Update shared primitive imports**

Add `ListStack` to the environment page import from `account-list-primitives`.

- [ ] **Step 2: Restyle each environment card**

Remove forced square corners, removed shadows, and alternating backgrounds. Keep `responsive-record-row responsive-environment-row grid min-h-[94px] items-center gap-5`. Render `env.path` with `title={env.path}` and `font-mono text-[11px] text-slate-500`.

- [ ] **Step 3: Replace the continuous list wrapper**

Render the empty state and mapped `EnvCard` records inside `<ListStack>`. Do not add another bordered or rounded surface around the stack.

- [ ] **Step 4: Run focused tests**

Run from `apps/desktop`: `npm exec -- tsx --test src/components/responsive-layout.test.ts`

Expected: all responsive layout tests pass.

### Task 3: Verify behavior and responsive presentation

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: the updated environment page.
- Produces: test, build, and visual verification evidence.

- [ ] **Step 1: Run complete desktop verification**

Run from `apps/desktop`: `npm run test:desktop`

Run from `apps/desktop`: `npm run build`

Expected: both commands exit successfully.

- [ ] **Step 2: Inspect desktop and compact layouts**

Open the environment page at the default desktop viewport and at a compact width. Confirm cards are separate, paths do not overlap actions, all five actions remain reachable, and the empty-state contract remains aligned with the model page.

- [ ] **Step 3: Review the scoped diff**

Run: `git diff --check`

Expected: no whitespace errors and no environment behavior callbacks changed.
