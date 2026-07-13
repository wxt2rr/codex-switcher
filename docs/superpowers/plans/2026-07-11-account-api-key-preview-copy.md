# Account API Key Preview and Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a masked API key in API-key account rows and make the copy button reliably copy the complete key.

**Architecture:** A pure formatter creates the display-only masked value. The renderer calls a preload API backed by Electron's native clipboard, while `ReactApp` owns localized success and failure feedback.

**Tech Stack:** React, TypeScript, Electron IPC, Node test runner

## Global Constraints

- Never render the complete API key.
- Preserve the first four and last four characters and replace the middle with exactly `****`.
- Copy the complete `apiKeyValue`, never the masked preview.
- AUTH accounts do not show an API-key row or API-key copy button.

---

### Task 1: Define failing contracts

- [x] Test masking of normal, short, and blank keys.
- [x] Test forwarding the native clipboard bridge call.
- [x] Test the account row renders masked API-key data and a real button.
- [x] Run the focused tests and confirm failure.

### Task 2: Implement display and native copy

- [x] Implement `maskApiKeyForDisplay`.
- [x] Add `writeClipboardText(value)` across renderer interface, preload, IPC, and Electron clipboard.
- [x] Render Base URL and masked API key as two rows for API-key accounts.
- [x] Make the copy button invoke the full value and show success/error feedback.
- [x] Run focused tests and confirm passage.

### Task 3: Verify and package

- [x] Run all desktop tests.
- [x] Build the production bundle.
- [x] Package the macOS arm64 app directory.
- [x] Run `git diff --check`.
