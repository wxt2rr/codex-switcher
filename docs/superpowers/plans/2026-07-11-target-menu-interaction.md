# Target Menu Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CLI/App labels non-actionable while preserving hover menus and correctly closing the project submenu.

**Architecture:** Keep the existing split control and hover-open behavior. Remove the primary action from the label half, retain arrow click toggling, and make submenu visibility derive from hovering the `new-window` item only.

**Tech Stack:** React, TypeScript

## Global Constraints

- Hovering anywhere on the CLI/App control opens its menu.
- Clicking the CLI/App label performs no launch or switch action.
- Clicking the arrow toggles the menu.
- The project submenu exists only while `new-window` is hovered.
- Selecting `current-window` closes both menus before dispatching the action.

---

### Task 1: Target control interaction

**Files:**
- Modify: `apps/desktop/src/pages/accounts-page.tsx`
- Modify: `apps/desktop/src/components/responsive-layout.test.ts`

- [x] Add source-level regression assertions for a non-action label and item leave cleanup.
- [x] Replace the label button action with a presentation-only element.
- [x] Close the project submenu when leaving `new-window` and before selecting another item.
- [x] Run desktop tests and build/package verification.
