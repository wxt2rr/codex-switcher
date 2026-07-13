# Usage Refresh and Routed Base URL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make statistics refresh with a moving time window and configurable frequency, while displaying original Base URLs and a routed badge for proxied accounts.

**Architecture:** Put reusable refresh-window and scheduling rules in `refresh-policy.ts`, while `UsagePage` owns its interval UI and in-flight guard. Add a non-starting route lookup to `UsageRouterManager`, enrich overview accounts in the Electron bridge, and render the optional route metadata in account rows.

**Tech Stack:** Electron 31, React 19, TypeScript, Node test runner.

## Global Constraints

- Default usage refresh frequency is 5 seconds.
- Presets are 1, 3, 5, and 10 seconds; custom values are integers from 1 through 3600.
- Every refresh computes a new `from` and `to` from the current timestamp.
- Overview loading must not start a stopped router service.
- Runtime Base URLs remain localhost while routing is enabled.
- Route metadata contains no credentials or request/response bodies.

---

### Task 1: Moving refresh policy

**Files:**
- Modify: `apps/desktop/src/refresh-policy.ts`
- Modify: `apps/desktop/src/refresh-policy.test.ts`

**Interfaces:**
- Produces: `REFRESH_INTERVAL_PRESETS`
- Produces: `normalizeRefreshSeconds(value: number): number`
- Produces: `buildUsageFilter(input, now): UsageFilter`
- Produces: `shouldScheduleUsageRefresh(visibilityState, requestInFlight): boolean`

- [x] Add failing tests proving two different `now` values produce advanced `from/to`, refresh seconds clamp to 1..3600, and hidden/in-flight states pause polling.
- [x] Implement the pure policy functions while preserving existing account-refresh exports.
- [x] Run `npx tsx --test src/refresh-policy.test.ts`; expect all policy tests to pass.

### Task 2: Account-style usage refresh controls

**Files:**
- Modify: `apps/desktop/src/pages/usage-page.tsx`
- Modify: `apps/desktop/src/components/responsive-layout.test.ts`

**Interfaces:**
- Consumes: Task 1 policy functions.

- [x] Add source-contract assertions for manual refresh, interval presets, custom input, and `buildUsageFilter` usage.
- [x] Add 5-second interval state, preset/custom UI, and an in-flight ref.
- [x] Rebuild the filter inside every refresh call using `Date.now()`.
- [x] Pause hidden or overlapping scheduled refreshes while keeping manual refresh immediate.
- [x] Run focused responsive tests and web TypeScript validation.

### Task 3: Non-starting route metadata lookup

**Files:**
- Modify: `apps/desktop/electron/usage-router-manager.ts`
- Modify: `apps/desktop/electron/usage-router-manager.test.ts`
- Modify: `apps/desktop/electron/bridge.ts`

**Interfaces:**
- Produces: `UsageRouterManager.listRoutesIfRunning(): Promise<RouteTarget[]>`
- Produces on overview account: `route?: { enabled: true; originalBaseUrl: string; localBaseUrl: string }`

- [x] Add a failing manager test proving `listRoutesIfRunning` returns an empty list without invoking `launchService`.
- [x] Add a state-bound admin request path and implement `listRoutesIfRunning`.
- [x] Enrich overview accounts from enabled routes, swallowing route lookup failures so overview loading remains available.
- [x] Run manager and Electron TypeScript tests.

### Task 4: Routed account display

**Files:**
- Modify: `apps/desktop/src/desktop-model.ts`
- Modify: `apps/desktop/src/pages/accounts-page.tsx`
- Modify: `apps/desktop/src/components/responsive-layout.test.ts`

**Interfaces:**
- Consumes: optional `AccountSummary.route` metadata from Task 3.

- [x] Add source-contract assertions for `originalBaseUrl`, `localBaseUrl`, and the localized routed label.
- [x] Add the optional route type to `AccountSummary`.
- [x] Prefer `route.originalBaseUrl` for displayed Base URL.
- [x] Add a `已开启代理 / Routed` badge whose title contains `route.localBaseUrl`.
- [x] Run focused tests and web TypeScript validation.

### Task 5: Regression verification

**Files:**
- Verify: `apps/desktop/src/pages/usage-page.tsx`
- Verify: `apps/desktop/src/pages/accounts-page.tsx`
- Verify: `apps/desktop/electron/usage-router-manager.ts`

- [x] Run the desktop regression suite excluding the known unrelated builder-target assertion; expect zero failures.
- [x] Run `npm run build --workspace ./apps/desktop`; expect a successful production bundle.
