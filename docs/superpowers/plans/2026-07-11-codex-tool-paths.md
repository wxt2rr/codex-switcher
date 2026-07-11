# Codex Tool Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reliable cross-platform Codex CLI/App detection and editable installation paths.

**Architecture:** A focused Electron settings module owns persistence, detection, and validation. IPC exposes status and mutations to an Operations-page editor, while bridge actions consume the same effective paths.

**Tech Stack:** Electron, TypeScript, React, Node.js filesystem/process APIs

## Global Constraints

- CLI and App paths remain separate.
- Manual values are not persisted until validation succeeds.
- Existing environment-variable overrides remain supported.
- Preserve unrelated working-tree changes.

---

### Task 1: Settings and detection service

- [ ] Add failing tests for PATH discovery, manual overrides, reset, and invalid paths.
- [ ] Implement persisted settings and cross-platform detection.
- [ ] Run focused tests.

### Task 2: Desktop action integration

- [ ] Add IPC methods for read, detect, save, and reset.
- [ ] Replace synchronous fixed CLI selection with the resolved executable.
- [ ] Pass resolved App path to App operations and diagnostics.
- [ ] Add regression tests for macOS and Windows.

### Task 3: Operations-page editor

- [ ] Add CLI and App path rows with status, input, detect, save, and reset controls.
- [ ] Add localized labels and responsive styling.
- [ ] Run UI and bridge tests.

### Task 4: Release

- [ ] Run full desktop tests and build.
- [ ] Package and inspect the app.
- [ ] Bump to `0.1.6`, commit, tag, push, and verify Release assets.
