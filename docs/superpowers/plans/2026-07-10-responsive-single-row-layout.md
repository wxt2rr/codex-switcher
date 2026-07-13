# Responsive Single-Row Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every desktop management page use the available width while keeping record content and actions on one row, degrading action labels to icons before horizontal scrolling is needed.

**Architecture:** Use a full-width shared page container as the responsive query boundary. Shared CSS classes define single-row grids and compact action behavior; each page marks secondary fields and action labels so the same priority-based degradation applies consistently.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, native CSS container queries, Node test runner, Electron/Vite.

## Global Constraints

- Record action areas must never wrap below the record content.
- Action text collapses before secondary record information is hidden.
- At the hard minimum width, the list region scrolls horizontally instead of wrapping records.
- Preserve existing interactions, menus, accessibility labels, themes, and user changes.

---

### Task 1: Shared responsive layout contract

**Files:**
- Modify: `apps/desktop/src/index.css`
- Modify: `apps/desktop/src/components/account-list-primitives.tsx`
- Create: `apps/desktop/src/components/responsive-layout.test.ts`

**Interfaces:**
- Consumes: existing page and card primitives.
- Produces: `.admin-page-content`, `.responsive-record-row`, `.responsive-action`, `.responsive-action-label`, and priority visibility classes.

- [ ] **Step 1: Write a failing source-level regression test**

Assert that shared primitives expose a full-width container, icon-label hooks, non-wrapping actions, and a horizontal overflow fallback.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npx tsx --test apps/desktop/src/components/responsive-layout.test.ts`
Expected: FAIL because the responsive contract is absent.

- [ ] **Step 3: Implement the shared responsive CSS contract**

Add a named inline-size container, remove the `1520px` page cap, keep action groups on one line, collapse `.responsive-action-label` at the compact threshold, hide explicitly marked secondary fields at narrower thresholds, and apply horizontal scrolling only below the hard minimum.

- [ ] **Step 4: Run the focused test**

Run: `npx tsx --test apps/desktop/src/components/responsive-layout.test.ts`
Expected: PASS.

### Task 2: Accounts page single-row layout

**Files:**
- Modify: `apps/desktop/src/pages/accounts-page.tsx`
- Modify: `apps/desktop/src/components/responsive-layout.test.ts`

**Interfaces:**
- Consumes: shared responsive layout classes.
- Produces: account rows with fixed single-row actions and accessible icon-only compact controls.

- [ ] **Step 1: Extend the regression test for account rows**

Assert the account page uses the page container, single-row grid, priority markers, and icon-bearing Edit/Actions controls.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npx tsx --test apps/desktop/src/components/responsive-layout.test.ts`
Expected: FAIL on account-specific assertions.

- [ ] **Step 3: Convert account rows and toolbar**

Replace viewport breakpoint grids and wrapping action groups with the shared contract. Add Pencil and Ellipsis icons to controls that previously had text only, wrap optional labels with `.responsive-action-label`, and keep menus functional.

- [ ] **Step 4: Run the focused test**

Run: `npx tsx --test apps/desktop/src/components/responsive-layout.test.ts`
Expected: PASS.

### Task 3: Environment, overview, and operations pages

**Files:**
- Modify: `apps/desktop/src/pages/environments-page.tsx`
- Modify: `apps/desktop/src/pages/overview-page.tsx`
- Modify: `apps/desktop/src/pages/operations-page.tsx`
- Modify: `apps/desktop/src/components/responsive-layout.test.ts`

**Interfaces:**
- Consumes: shared responsive layout classes and responsive action primitive.
- Produces: consistent single-row record layouts on every management page.

- [ ] **Step 1: Extend regression coverage for all pages**

Assert each page opts into the responsive record contract and no record action group uses `flex-wrap`.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npx tsx --test apps/desktop/src/components/responsive-layout.test.ts`
Expected: FAIL on remaining page assertions.

- [ ] **Step 3: Apply the responsive contract to each page**

Keep all card actions in the first row, mark lower-priority path/auth/usage details, and use compact icon actions at the shared threshold.

- [ ] **Step 4: Run the focused test**

Run: `npx tsx --test apps/desktop/src/components/responsive-layout.test.ts`
Expected: PASS.

### Task 4: Build and visual verification

**Files:**
- Verify: `apps/desktop/src/**`

**Interfaces:**
- Consumes: completed responsive pages.
- Produces: build and multi-width visual evidence.

- [ ] **Step 1: Run desktop tests**

Run: `npm run desktop:test`
Expected: all tests pass.

- [ ] **Step 2: Build the desktop application**

Run: `npm run desktop:build`
Expected: TypeScript and Vite build exit 0.

- [ ] **Step 3: Verify representative widths**

Run the Vite desktop UI and inspect accounts, environments, overview, and operations with the sidebar expanded and collapsed at approximately 1680, 1440, 1200, 1024, and 800 CSS pixels. Confirm records remain single-line, actions never wrap, labels collapse before details, and only the record list scrolls at the hard minimum.
