# Sidebar Header and Environment Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the macOS sidebar toggle with the traffic lights, simplify its visual treatment, lower the brand, and remove redundant environment-row captions.

**Architecture:** Keep platform-specific class decisions in `desktop-shell-layout.ts`, render the macOS toggle independently from the brand row, and preserve the shared non-macOS row. Simplify only the environment row content while retaining its responsive grid contract.

**Tech Stack:** React 19, TypeScript, Tailwind CSS utilities, Node test runner.

## Global Constraints

- Preserve sidebar widths and navigation behavior.
- Keep the macOS toggle outside the draggable region.
- Preserve environment grid columns, responsive priorities, actions, routing status, and row striping.
- Do not modify Windows/Linux vertical spacing beyond the transparent toggle background.

---

### Task 1: Platform-aware sidebar header

**Files:**
- Modify: `apps/desktop/src/components/desktop-shell-layout.ts`
- Modify: `apps/desktop/src/components/desktop-shell.test.ts`
- Modify: `apps/desktop/src/components/desktop-shell.tsx`

**Interfaces:**
- Produces: `getDesktopShellSidebarToggleClass(platform?: string): string`
- Produces: `getDesktopShellSidebarBrandRowClass(platform?: string): string`

- [x] Add failing assertions that macOS returns an absolute top-row toggle class and lowered brand-row class while Windows returns shared-row classes.
- [x] Implement the two class helpers.
- [x] Render the macOS toggle outside the brand row, apply the no-drag class, and use a transparent rest state with subtle hover background.
- [x] Keep one shared-row toggle on non-macOS.
- [x] Run `npx tsx --test src/components/desktop-shell.test.ts`; expect all shell tests to pass.

### Task 2: Simplified environment rows

**Files:**
- Modify: `apps/desktop/src/pages/environments-page.tsx`
- Modify: `apps/desktop/src/components/responsive-layout.test.ts`

**Interfaces:**
- Consumes: existing `responsive-environment-row`, `responsive-priority-tertiary`, and `responsive-priority-secondary` classes.

- [x] Add failing assertions that environment rows no longer contain `CODEX_HOME` or the targets caption markup.
- [x] Remove both captions and vertically center the path and target badges.
- [x] Run `npx tsx --test src/components/responsive-layout.test.ts`; expect all responsive tests to pass.

### Task 3: Regression verification

**Files:**
- Verify: `apps/desktop/src/components/desktop-shell.tsx`
- Verify: `apps/desktop/src/pages/environments-page.tsx`

- [x] Run `npx tsc -p tsconfig.web.json --noEmit`; expect exit code 0.
- [x] Run the desktop suite excluding the known unrelated builder-target assertion; expect zero failures (70 tests after adding the new shell contract).
- [x] Run `npm run build --workspace ./apps/desktop`; expect the production bundle to build successfully.

### Task 4: Collision-free collapsed macOS toggle

**Files:**
- Modify: `apps/desktop/src/components/desktop-shell-layout.ts`
- Modify: `apps/desktop/src/components/desktop-shell.test.ts`
- Modify: `apps/desktop/src/components/desktop-shell.tsx`

**Interfaces:**
- Replaces: `getDesktopShellSidebarToggleClass(platform?: string): string`
- Produces: `getDesktopShellSidebarToggleClass(platform: string | undefined, expanded: boolean): string`

- [x] Add failing assertions that expanded macOS uses `right-4 top-0`, collapsed macOS uses `left-1/2 top-8 -translate-x-1/2`, and Windows remains non-absolute.
- [x] Accept the expanded state in `getDesktopShellSidebarToggleClass` and return the matching position classes.
- [x] Pass `sidebarExpanded` from `DesktopShell` into the helper.
- [x] Run the focused shell tests and web TypeScript validation.
- [x] Run the desktop regression suite and production build.
