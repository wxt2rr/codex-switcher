# Packaged Runtime Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make installed Windows and macOS desktop applications load bundled core modules and scripts without requiring a source checkout.

**Architecture:** Centralize packaged-versus-workspace path resolution in a pure Electron helper. The main process supplies Electron's resources directory, and all loaders use bundled resources first with lazy workspace fallback.

**Tech Stack:** Electron 31, TypeScript, Node.js test runner, electron-builder

## Global Constraints

- Preserve development execution from the repository.
- Installed execution must not depend on `process.cwd()` or a repository checkout.
- Preserve unrelated working-tree changes.

---

### Task 1: Runtime path resolver

**Files:**
- Create: `apps/desktop/electron/runtime-paths.ts`
- Create: `apps/desktop/electron/runtime-paths.test.ts`

- [ ] Write tests for packaged resources and workspace fallback.
- [ ] Verify the tests fail before implementation.
- [ ] Implement bundled-first resource and repository resolution.
- [ ] Verify the focused tests pass.

### Task 2: Core and bridge integration

**Files:**
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/electron/core-runtime.ts`
- Modify: `apps/desktop/electron/bridge.ts`

- [ ] Set the resources environment variable from Electron main.
- [ ] Replace eager workspace resolution with bundled-first path resolution.
- [ ] Run Electron bridge and core tests.

### Task 3: Packaged resource completeness

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/electron/builder-config.test.ts`

- [ ] Add core ESM metadata and packaged command scripts.
- [ ] Update builder configuration assertions.
- [ ] Run desktop tests and type checking.
- [ ] Build a native directory package and inspect its resource tree.

### Task 4: Release

**Files:**
- Modify: `apps/desktop/package.json`

- [ ] Bump the desktop patch version.
- [ ] Commit only the runtime fix, tests, design, and plan.
- [ ] Push `main` and a new `desktop-v*` tag.
- [ ] Monitor GitHub Actions and confirm macOS and Windows release assets.
