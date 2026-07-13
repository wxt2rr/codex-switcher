# Adaptive Account Menu Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make account menus flip upward whenever their natural height cannot fit below the trigger's visible scroll boundary.

**Architecture:** Keep placement math as a pure function and improve the React hook's DOM measurements. The hook will find the nearest truly scrollable vertical ancestor, intersect it with the browser viewport, measure natural menu height, and refresh when layout changes.

**Tech Stack:** React 19, TypeScript, Node test runner, Vite/Electron desktop app

## Global Constraints

- Default placement is downward when the menu fits.
- Preserve an 8px trigger gap and an 8px visible-boundary inset.
- Do not add a positioning dependency or change menu launch behavior.
- Preserve unrelated uncommitted workspace changes.

---

### Task 1: Make boundary and height measurement testable

**Files:**
- Modify: `apps/desktop/src/components/adaptive-menu-placement.ts`
- Test: `apps/desktop/src/components/adaptive-menu-placement.test.ts`

**Interfaces:**
- Produces: `isVerticalScrollBoundary(overflowY: string): boolean`
- Preserves: `resolveAdaptiveMenuLayout(input): AdaptiveMenuLayout`

- [ ] **Step 1: Write failing tests**

Add assertions that `auto`/`scroll` ancestors are boundaries while `hidden`/`clip` layout ancestors are not. Add an 8px-inset placement case matching a bottom trigger.

- [ ] **Step 2: Run the focused test and confirm failure**

Run from `apps/desktop`: `npm exec -- tsx --test src/components/adaptive-menu-placement.test.ts`

Expected: FAIL because `isVerticalScrollBoundary` is not exported and the current default inset is 24px.

- [ ] **Step 3: Implement the boundary predicate and placement defaults**

Export the pure predicate, use it from `findVerticalScrollBoundary`, and change the default boundary padding to 8px. Keep the viewport/scroll-boundary intersection in the hook.

- [ ] **Step 4: Run the focused test**

Run from `apps/desktop`: `npm exec -- tsx --test src/components/adaptive-menu-placement.test.ts`

Expected: all adaptive placement tests pass.

### Task 2: Recalculate after menu content changes

**Files:**
- Modify: `apps/desktop/src/components/adaptive-menu-placement.ts`
- Test: `apps/desktop/src/components/responsive-layout.test.ts`

**Interfaces:**
- Consumes: `useAdaptiveMenuLayout(open, rootRef, menuRef)`
- Produces: the same hook API with resize-driven recalculation

- [ ] **Step 1: Add a structural regression assertion**

Assert that the adaptive hook observes the menu and trigger with `ResizeObserver` and disconnects during cleanup.

- [ ] **Step 2: Run the regression test and confirm failure**

Run from `apps/desktop`: `npm exec -- tsx --test src/components/responsive-layout.test.ts`

Expected: FAIL because the hook does not yet use `ResizeObserver`.

- [ ] **Step 3: Add resize observation and natural-height measurement**

Measure `Math.max(menu.getBoundingClientRect().height, menu.scrollHeight)` and observe both trigger and menu. Retain scroll and window resize listeners; disconnect the observer in cleanup.

- [ ] **Step 4: Run desktop verification**

Run: `npm --prefix apps/desktop run test:desktop`

Run: `npm --prefix apps/desktop run build`

Expected: both commands exit successfully.

### Task 3: Visual bottom-edge check

**Files:**
- No source changes expected

- [ ] **Step 1: Start the desktop web development server**

Run: `npm --prefix apps/desktop run dev -- --host 127.0.0.1`

- [ ] **Step 2: Inspect desktop and compact viewports**

Open the accounts page, scroll the last account action trigger near the visible bottom, open the CLI menu, and confirm `data-menu-placement="up"` with no clipping. Also confirm a middle-row menu remains `down`.

- [ ] **Step 3: Review final diff**

Run: `git diff --check`

Expected: no whitespace errors; only the scoped placement files and documentation are attributable to this task.
