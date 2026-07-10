# Desktop GitHub Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a GitHub Pre-release containing the macOS and Windows installers after both native packaging jobs succeed for a `desktop-v*` tag.

**Architecture:** Native jobs continue uploading workflow Artifacts. A dependent Ubuntu release job downloads and merges both Artifacts, validates the staged assets, and uses the GitHub CLI to create or update one tag-bound Pre-release.

**Tech Stack:** GitHub Actions, GitHub CLI, Electron Builder, Node.js 20, npm workspaces.

## Global Constraints

- Default workflow permission remains `contents: read`.
- Only the release job receives `contents: write`.
- Release publication runs only for refs matching `refs/tags/desktop-v*`.
- Both native jobs must succeed before publication starts.
- Unsigned installers are published as a Pre-release.
- Reruns replace duplicate assets instead of failing.
- Desktop package version and release tag are `0.1.3` / `desktop-v0.1.3`.

---

### Task 1: Extend the workflow contract test

**Files:**
- Modify: `scripts/desktop-package-workflow.test.ts`

**Interfaces:**
- Produces: assertions for `release`, `needs`, tag-only condition, job-level write permission, artifact download, `--prerelease`, generated notes, verified tag, and replacement upload.

- [ ] **Step 1: Add release-job assertions before changing YAML.**
- [ ] **Step 2: Run `npm run test:desktop-package-workflow`.**

Expected: failure because the workflow has no release job.

### Task 2: Add the aggregate release job

**Files:**
- Modify: `.github/workflows/desktop-package.yml`

**Interfaces:**
- Consumes: `codex-switcher-macos-arm64` and `codex-switcher-windows-x64` Artifacts.
- Produces: a tag-bound GitHub Pre-release with all staged files.

- [ ] **Step 1: Add an Ubuntu job with `needs: [package-macos, package-windows]` and a `desktop-v*` tag condition.**
- [ ] **Step 2: Grant `contents: write` only to that job and map `secrets.GITHUB_TOKEN` to `GH_TOKEN`.**
- [ ] **Step 3: Download both Artifacts with the current official `actions/download-artifact` major and `merge-multiple: true`.**
- [ ] **Step 4: Fail when no DMG, ZIP, EXE, or blockmap is staged.**
- [ ] **Step 5: Create a generated-notes Pre-release when absent; otherwise upload all staged assets with `--clobber`.**
- [ ] **Step 6: Run the workflow contract test and parse the YAML.**

### Task 3: Version and documentation

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `package-lock.json`
- Modify: `apps/desktop/README.md`

**Interfaces:**
- Produces: desktop version `0.1.3` and instructions that Releases contain installers while Actions Artifacts remain available.

- [ ] **Step 1: Update package and lockfile workspace versions to `0.1.3`.**
- [ ] **Step 2: Document the Pre-release asset flow and unsigned status.**
- [ ] **Step 3: Run desktop tests and production build.**

### Task 4: Publish and verify

**Files:**
- Commit only the workflow, contract test, version, documentation, spec, and plan for this change.

**Interfaces:**
- Produces: tag `desktop-v0.1.3`, successful native jobs, and a GitHub Pre-release containing both platform installers.

- [ ] **Step 1: Run `git diff --cached --check` and commit the scoped files.**
- [ ] **Step 2: Create and push immutable tag `desktop-v0.1.3` with `main`.**
- [ ] **Step 3: Watch the workflow until all jobs finish.**
- [ ] **Step 4: Query the GitHub Release API and verify DMG, macOS ZIP, Windows EXE, and blockmap assets.**
