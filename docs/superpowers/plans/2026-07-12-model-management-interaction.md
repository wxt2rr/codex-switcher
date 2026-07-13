# Model Management Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert model management into a list-first add/edit/bind workflow with complete catalog JSON editing.

**Architecture:** Keep persistence and IPC unchanged. Refactor the models page into a full-width list plus separate editor and binding side panels, with local binding drafts and a destructive confirmation dialog.

**Tech Stack:** React, TypeScript, existing desktop list primitives, SidePanel, ConfirmDialog.

## Global Constraints

- Preserve advanced JSON fields while editing core form fields.
- JSON mode uses `{ "models": [entry] }` and accepts exactly one entry.
- Binding changes persist only after explicit save.
- Description is removed from the form.

---

### Task 1: Add interaction regression coverage

- [ ] Assert list-first rendering, side panels, complete JSON wrapper, and removal of description.

### Task 2: Refactor model management page

- [ ] Replace split editor layout with model rows and actions.
- [ ] Add shared add/edit side panel.
- [ ] Add grouped searchable account binding side panel.
- [ ] Add delete confirmation with binding impact.

### Task 3: Verify

- [ ] Run focused tests and TypeScript checks.
- [ ] Run production build and inspect the models page.
