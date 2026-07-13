# Environment Routing and Usage Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add environment-wide routing for non-AUTH accounts through a durable local proxy and provide near-real-time Token usage statistics grouped by Base URL, account, environment, and model.

**Architecture:** A detached Electron-managed Node service owns the local HTTP proxy and SQLite database. Environment routing stores every account's upstream Base URL, rewrites non-AUTH account Base URLs to route-specific localhost paths, restores them on disable, and exposes status/statistics through local admin endpoints consumed by Electron IPC. The renderer uses the existing management-page design system and refreshes statistics within one second.

**Tech Stack:** Electron 31, Node HTTP/fetch, TypeScript, sql.js SQLite, React 19, SVG charts, existing core runtime state adapters.

## Global Constraints

- AUTH accounts must never be routed or rewritten.
- Never persist API keys, request bodies, or response bodies.
- Every routed account must retain its exact original Base URL for restoration.
- Route identity must include environment, account, and normalized upstream Base URL.
- Statistics latency target is at most one second after response usage becomes available.
- Closing the desktop window must not stop enabled routing.
- Missing upstream usage remains unknown and is never estimated.
- Actual cost remains unavailable until a Base URL pricing profile is configured.

---

### Task 1: Usage domain and SQLite repository

**Files:**
- Create: `apps/desktop/electron/usage-routing-model.ts`
- Create: `apps/desktop/electron/usage-routing-model.test.ts`
- Create: `apps/desktop/electron/usage-store.ts`
- Create: `apps/desktop/electron/usage-store.test.ts`

- [x] Define route, usage, filter, aggregate, and pricing interfaces.
- [x] Test route URL generation, common OpenAI usage extraction, and Base URL normalization.
- [x] Implement SQLite schema and indexed aggregate queries.
- [x] Verify repository persistence and grouping by Base URL/model.

### Task 2: Durable local routing service

**Files:**
- Create: `apps/desktop/electron/usage-router-service.ts`
- Create: `apps/desktop/electron/usage-router-service.test.ts`
- Modify: `apps/desktop/scripts/rename-electron-output.cjs`

- [x] Start a localhost-only proxy and admin API on an available port.
- [x] Route `/routes/:routeId/*` to the stored upstream while streaming request and response bodies.
- [x] Capture JSON and SSE final usage without retaining content.
- [x] Write request status, latency, Token fields, and dimensions to SQLite.
- [x] Persist service PID, port, and admin token for desktop reconnection.

### Task 3: Environment route lifecycle

**Files:**
- Create: `apps/desktop/electron/usage-router-manager.ts`
- Create: `apps/desktop/electron/usage-router-manager.test.ts`
- Modify: `apps/desktop/electron/bridge.ts`

- [x] Reconnect to or spawn the detached service.
- [x] Enable all non-AUTH accounts in an environment and store original Base URLs.
- [x] Rewrite account runtime Base URLs to route-specific localhost URLs.
- [x] Disable routing and restore all original Base URLs transactionally.
- [x] Synchronize active CLI/App target homes after enable or disable.

### Task 4: IPC and renderer models

**Files:**
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/electron/preload.ts`
- Modify: `apps/desktop/src/bridge.ts`
- Modify: `apps/desktop/src/desktop-model.ts`

- [x] Expose route status, toggle, usage snapshot, and pricing profile operations.
- [x] Add browser-preview responses and bridge forwarding tests.

### Task 5: Unified environment page

**Files:**
- Modify: `apps/desktop/src/pages/environments-page.tsx`
- Modify: `apps/desktop/src/index.css`
- Modify: `apps/desktop/src/react-app.tsx`

- [x] Match the account page title, toolbar, statistics cards, and striped list container.
- [x] Add an environment route toggle to the action area.
- [x] Disable the toggle when the environment has no non-AUTH accounts.
- [x] Show proxy port and routed-account count when enabled.

### Task 6: Near-real-time usage statistics page

**Files:**
- Create: `apps/desktop/src/pages/usage-page.tsx`
- Create: `apps/desktop/src/components/usage-charts.tsx`
- Modify: `apps/desktop/src/components/desktop-shell.tsx`
- Modify: `apps/desktop/src/react-app.tsx`
- Modify: `apps/desktop/src/desktop-model.ts`

- [x] Add the Usage navigation item and filters for date, environment, account, Base URL, and model.
- [x] Render request, Token, cost, cache-rate, model distribution, trend, and Base URL summaries.
- [x] Load a snapshot on entry and merge updates at a one-second maximum interval.
- [x] Add empty, partial-usage, and error states.

### Task 7: Integration verification

**Files:**
- Modify: `apps/desktop/package.json`
- Test: `apps/desktop/electron/*.test.ts`
- Test: `apps/desktop/src/**/*.test.ts`

- [x] Run focused red/green tests for every task.
- [x] Run desktop tests excluding the known unrelated macOS target assertion if it remains inconsistent with package configuration.
- [x] Build the production desktop bundle.
- [x] Start a mock upstream, route requests through localhost, verify streamed output, SQLite rows, aggregates, disable restoration, and service survival after the controlling client disconnects.
