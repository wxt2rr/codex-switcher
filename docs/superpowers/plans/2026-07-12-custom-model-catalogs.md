# Custom Model Catalogs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable custom Codex model definitions, form/JSON editing, many-to-many account bindings, and account-specific merged catalogs at launch.

**Architecture:** Keep reusable model definitions and account bindings in a dedicated desktop settings file rather than duplicating catalog JSON inside account runtime state. On every target-home application, merge `codex debug models --bundled` with the selected account's bound models, atomically write a generated catalog, and manage `model_catalog_json` in `config.toml`; remove the setting when no models are bound.

**Tech Stack:** TypeScript, Node.js filesystem/process APIs, Electron IPC, React, existing desktop UI primitives, Node test runner.

## Global Constraints

- Form and JSON modes edit one canonical catalog entry and always persist JSON.
- A custom model can bind to many accounts and an account can bind to many models.
- Bound accounts receive official bundled models plus their enabled custom models.
- Accounts without bindings have `model_catalog_json` removed and use Codex's bundled catalog.
- Catalog writes are atomic and model slugs cannot collide with bundled or other custom models.
- Existing user changes in the dirty worktree must remain untouched.

---

### Task 1: Model catalog domain and persistence

**Files:**
- Create: `apps/desktop/electron/model-catalog-store.ts`
- Test: `apps/desktop/electron/model-catalog-store.test.ts`

- [ ] Define custom-model, binding, snapshot, validation, CRUD, and atomic JSON persistence interfaces.
- [ ] Test malformed JSON, duplicate slugs, CRUD, and many-to-many bindings.
- [ ] Implement the minimal store and make focused tests pass.

### Task 2: Account-specific catalog materialization

**Files:**
- Create: `apps/desktop/electron/account-model-catalog.ts`
- Test: `apps/desktop/electron/account-model-catalog.test.ts`
- Modify: `apps/desktop/electron/bridge.ts`

- [ ] Test merging bundled and bound entries, collision rejection, atomic output, and config cleanup.
- [ ] Resolve the configured Codex CLI and read official definitions with `debug models --bundled`.
- [ ] Run catalog synchronization after every target-home apply and before launching Codex.

### Task 3: Electron API

**Files:**
- Modify: `apps/desktop/electron/bridge.ts`
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/src/bridge.ts`

- [ ] Add list/save/delete model and save account-binding IPC operations.
- [ ] Return typed snapshots and actionable validation errors.
- [ ] Extend bridge smoke tests for all new channels.

### Task 4: Models UI and account binding

**Files:**
- Create: `apps/desktop/src/pages/models-page.tsx`
- Modify: `apps/desktop/src/react-app.tsx`
- Modify: `apps/desktop/src/components/desktop-shell.tsx`
- Modify: `apps/desktop/src/desktop-model.ts`
- Modify: `apps/desktop/src/i18n.ts`

- [ ] Add a Models navigation destination and reusable model list.
- [ ] Add one editor with Form and JSON modes backed by the same canonical entry.
- [ ] Add account-binding checkboxes showing the many-to-many relationship.
- [ ] Refresh the snapshot after mutations and report success/error through the existing notice system.

### Task 5: Verification

**Files:**
- Modify: `apps/desktop/package.json`

- [ ] Add focused tests to the desktop suite.
- [ ] Run focused model tests and verify the red/green behavior.
- [ ] Run `npm run core:build`, `npm run desktop:test`, and `npm run desktop:build`.
- [ ] Review the final diff against every global constraint and report residual risks.
