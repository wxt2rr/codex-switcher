# Auto Resume Settings UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the awkward auto-resume tool row with a clear, compact settings card.

**Architecture:** Render auto resume as a dedicated settings surface with a title-row switch, contextual session-order controls, and an explicit text save button. Track persisted and draft values separately so saving is available only when settings changed.

**Tech Stack:** React, TypeScript, Tailwind CSS

## Global Constraints

- Preserve existing persistence and runtime behavior.
- Use a visual switch instead of a native checkbox.
- Use preset session-order choices 1-5 and a custom positive integer option.
- Disable Save Settings when the draft matches persisted settings.
- Collapse cleanly to one column at narrow widths.

---

### Task 1: Settings card and dirty state

**Files:**
- Modify: `apps/desktop/src/react-app.tsx`
- Modify: `apps/desktop/src/pages/operations-page.tsx`
- Modify: `apps/desktop/src/components/responsive-layout.test.ts`

- [x] Add regression assertions for switch semantics, labeled order control, text save action, and no OperationCard wrapper.
- [x] Track persisted and draft auto-resume settings independently.
- [x] Build the dedicated responsive settings card.
- [x] Run desktop tests, build, and package verification.
