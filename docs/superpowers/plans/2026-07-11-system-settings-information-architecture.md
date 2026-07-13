# System Settings Information Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize system settings into coherent CLI launch and Codex installation groups with native terminal icons and a macOS-style switch.

**Architecture:** Electron enriches detected terminal options with native icon data URLs. The shared Select optionally renders icons, and the operations page composes purpose-built grouped cards without changing persistence handlers.

**Tech Stack:** Electron nativeImage APIs, React, TypeScript, Radix Select, Tailwind CSS

## Global Constraints

- Keep proxy and logs independent.
- Never expose executable paths as image URLs to the renderer.
- Preserve existing save, reset, scan, and rollback behavior.
- Use `#34C759` for the enabled switch.

---

### Task 1: Native terminal icons
- [x] Extend terminal option metadata with icon source and renderer-safe icon URL.
- [x] Decorate IPC results with `app.getFileIcon()` and fallback gracefully.
- [x] Extend shared Select items with optional icon URLs.
- [x] Add focused regression assertions.

### Task 2: Grouped system settings UI
- [x] Replace the two CLI cards with one “CLI 启动” group.
- [x] Replace separate CLI/App cards with one “Codex 安装” group.
- [x] Apply macOS-style switch and responsive layout.
- [x] Add focused UI assertions.

### Task 3: Verification
- [x] Run all desktop tests.
- [x] Build production assets.
- [x] Package macOS arm64 app.
- [x] Run `git diff --check`.
