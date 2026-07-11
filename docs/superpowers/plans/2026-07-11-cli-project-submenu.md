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

- [ ] Write tests covering TOML project extraction, path de-duplication, missing-directory filtering, and session-index sorting.
- [ ] Run the focused test and verify it fails before implementation.
- [ ] Implement the parser with filesystem validation and tolerant session-index parsing.
- [ ] Run the focused test and commit the task.

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

- [ ] Add failing tests for home-directory fallback and explicit working-directory quoting on macOS and Windows.
- [ ] Implement project-list lookup, directory validation, IPC/preload types, and directory picker.
- [ ] Pass the working directory to the Unix and Windows terminal launch builders.
- [ ] Run bridge tests and commit the task.

### Task 3: Nested hover menu

**Files:**
- Modify: `apps/desktop/src/pages/accounts-page.tsx`
- Modify: `apps/desktop/src/react-app.tsx`
- Modify: `apps/desktop/src/index.css`
- Test: `apps/desktop/src/components/responsive-layout.test.ts`

**Interfaces:**
- Consumes: `bridge.listAccountProjects`, `bridge.pickDirectory`, and extended `switchAccount`.
- Produces: nested “New window” submenu with selected project path.

- [ ] Add structural regression assertions for a nested, scrollable project menu.
- [ ] Load projects lazily when the CLI menu opens or the selected account changes.
- [ ] Render a right-side submenu with project name/path, home directory, and folder picker.
- [ ] Keep both menu levels open while moving the pointer and close them after selection.
- [ ] Run renderer tests and commit the task.

### Task 4: Full verification

**Files:**
- Modify only files required by failures discovered during verification.

- [ ] Run `npm run desktop:test` and confirm zero failures.
- [ ] Run `npm run desktop:build` and confirm a successful production build.
- [ ] Run `git diff --check` and inspect the scoped diff.
- [ ] Commit any final focused corrections without publishing.
