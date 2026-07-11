# CLI Project Submenu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a scrollable project submenu beneath CLI “New window” that reads projects from the selected account environment and starts Codex in the selected directory.

**Architecture:** Electron owns project discovery because it can read the selected environment and filesystem. The renderer requests project options for the hovered account, renders a nested menu, and passes an optional working directory through preload and IPC to the terminal launch plan. Terminal builders validate and safely quote the selected directory, defaulting new windows to the user home.

**Tech Stack:** Electron IPC, React, TypeScript, Node filesystem APIs, existing desktop test suite.

## Global Constraints

- Do not add a separate project database.
- Read projects from the selected account environment `config.toml`.
- Use `session_index.jsonl` only for recent-use sorting.
- Missing or invalid config must retain home-directory and folder-picker choices.
- Current-window behavior remains unchanged.
- Do not publish a release.

---

### Task 1: Project discovery

**Files:**
- Create: `apps/desktop/electron/codex-projects.ts`
- Test: `apps/desktop/electron/codex-projects.test.ts`
- Modify: `apps/desktop/package.json`

**Interfaces:**
- Produces: `readCodexProjects(codexHome: string): Promise<CodexProject[]>`.
- `CodexProject` contains `path`, `name`, and optional `lastUsedAt`.

- [x] Write tests covering TOML project extraction, path de-duplication, missing-directory filtering, and session-index sorting.
- [x] Run the focused test and verify it fails before implementation.
- [x] Implement the parser with filesystem validation and tolerant session-index parsing.
- [x] Run the focused test and commit the task.

### Task 2: Bridge and working-directory launch

**Files:**
- Modify: `apps/desktop/electron/bridge.ts`
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/src/bridge.ts`
- Test: `apps/desktop/electron/bridge-smoke.test.ts`

**Interfaces:**
- Produces: `listAccountProjects(envName: string, accountName: string)` for the renderer.
- Extends `switchAccount` with optional `workingDirectory` when strategy is `new-window`.
- Produces a directory-picker bridge operation.

- [x] Add failing tests for home-directory fallback and explicit working-directory quoting on macOS and Windows.
- [x] Implement project-list lookup, directory validation, IPC/preload types, and directory picker.
- [x] Pass the working directory to the Unix and Windows terminal launch builders.
- [x] Run bridge tests and commit the task.

### Task 3: Nested hover menu

**Files:**
- Modify: `apps/desktop/src/pages/accounts-page.tsx`
- Modify: `apps/desktop/src/react-app.tsx`
- Modify: `apps/desktop/src/index.css`
- Test: `apps/desktop/src/components/responsive-layout.test.ts`

**Interfaces:**
- Consumes: `bridge.listAccountProjects`, `bridge.pickDirectory`, and extended `switchAccount`.
- Produces: nested “New window” submenu with selected project path.

- [x] Add structural regression assertions for a nested, scrollable project menu.
- [x] Load projects lazily when the CLI menu opens or the selected account changes.
- [x] Render a nested submenu with project name/path, home directory, and folder picker.
- [x] Keep both menu levels open while moving the pointer and close them after selection.
- [x] Run renderer tests and commit the task.

### Task 4: Full verification

**Files:**
- Modify only files required by failures discovered during verification.

- [x] Run `npm run desktop:test` and confirm zero failures.
- [x] Run `npm run desktop:build` and confirm a successful production build.
- [x] Run `git diff --check` and inspect the scoped diff.
- [x] Commit any final focused corrections without publishing.
