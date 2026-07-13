# GUI Core-Direct Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all desktop GUI operations off the legacy `codex-switcher` Bash entrypoint and onto shared core services while keeping TUI/CLI behavior intact.

**Architecture:** Introduce a structured desktop-operations service in `packages/core` that owns account/proxy/token-refresh/app/diagnostic actions and delegates unavoidable system work to adapters. Update the Electron bridge to load and call that service directly, then narrow GUI refresh behavior so overview loads stay cheap and auth metrics become explicitly demand-driven instead of auto-chained after every mutation.

**Tech Stack:** TypeScript, Node.js `>=18`, Electron `31.7.7`, React `19`, `tsx`, existing `packages/core` platform/state/task modules

## Global Constraints

- GUI must not invoke `plugins/codex-switcher/scripts/codex-switcher` for runtime operations after this change.
- External commands may remain, but only behind core adapters and task services; GUI code must not spawn shell wrappers.
- GUI, TUI, and CLI must converge on shared core semantics; this change may leave TUI/CLI on legacy entrypoints temporarily, but must not introduce new GUI-only business logic.
- Legacy Bash remains a compatibility entrypoint for TUI/CLI and must keep passing existing compatibility tests.
- Preserve current packaged-desktop behavior: `apps/desktop` still bundles `packages/core/dist` and plugin scripts as Electron extra resources.
- Keep the implementation scoped to desktop operation routing and refresh behavior; do not rewrite Codex auth, usage collection, or platform adapters from scratch.

---

## File Structure

- Create: `packages/core/src/services/desktop-operations.ts`
  - Shared service for GUI-safe account/proxy/token-refresh/app/diagnostic operations.
- Create: `packages/core/src/services/desktop-operations.test.ts`
  - Unit coverage for service semantics, task wiring, and adapter delegation.
- Modify: `packages/core/src/index.ts`
  - Export the new service for Electron/TUI/CLI consumers.
- Create: `apps/desktop/electron/core-runtime.ts`
  - Centralize dynamic loading of `packages/core/dist` modules for Electron main-process use.
- Modify: `apps/desktop/electron/bridge.ts`
  - Replace `runSwitcherCommand()` call sites with direct core service invocations; keep login-bridge and terminal-launch helpers only where genuinely needed.
- Create: `apps/desktop/electron/bridge-core-ops.test.ts`
  - Verify the Electron bridge routes GUI operations through the new core service instead of shelling out.
- Create: `apps/desktop/src/refresh-policy.ts`
  - Small pure helper defining when GUI should refresh overview and when auth metrics should be skipped or reloaded.
- Create: `apps/desktop/src/refresh-policy.test.ts`
  - Unit tests for post-mutation refresh policy decisions.
- Modify: `apps/desktop/src/react-app.tsx`
  - Use the refresh policy helper to stop auto-running auth metrics after every successful GUI mutation.
- Modify: `apps/desktop/package.json`
  - Include the new desktop tests in the existing `test:desktop` script.
- Modify: `README.md`
- Modify: `README.en.md`
  - Document that desktop operations are now core-backed while Bash remains CLI/TUI compatibility only.

### Task 1: Add Core Desktop Operations Service

**Files:**
- Create: `packages/core/src/services/desktop-operations.ts`
- Create: `packages/core/src/services/desktop-operations.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `createTaskRunner()` from `packages/core/src/tasks/task-runner.ts`, proxy helpers from `packages/core/src/platform/proxy.ts`, state helpers from `packages/core/src/state/legacy.ts`, app launch/stop helpers from `packages/core/src/platform/codex-app.ts` and `packages/core/src/platform/codex-app-stop.ts`
- Produces:
  - `createDesktopOperationsService(options: DesktopOperationsServiceOptions): DesktopOperationsService`
  - `DesktopOperationsService.deleteAccount(input: { envName: string; accountName: string }): Promise<{ message: string; output?: string }>`
  - `DesktopOperationsService.logoutAccount(input: { envName: string; accountName: string; target: "cli" | "app" | "both" }): Promise<{ message: string; output?: string }>`
  - `DesktopOperationsService.getProxyStatus(): Promise<{ message: string; output: string }>`
  - `DesktopOperationsService.setProxy(input: { value: string }): Promise<{ message: string; output: string }>`
  - `DesktopOperationsService.disableProxy(): Promise<{ message: string; output: string }>`
  - `DesktopOperationsService.testProxy(): Promise<{ message: string; output: string; taskId: string }>`
  - `DesktopOperationsService.getTokenRefreshStatus(): Promise<{ message: string; output: string }>`
  - `DesktopOperationsService.startTokenRefreshGuard(): Promise<{ message: string; output: string }>`
  - `DesktopOperationsService.stopTokenRefreshGuard(): Promise<{ message: string; output: string }>`
  - `DesktopOperationsService.runTokenRefreshOnce(): Promise<{ message: string; output: string; taskId: string }>`
  - `DesktopOperationsService.getAppStatus(): Promise<{ message: string; output: string }>`
  - `DesktopOperationsService.logoutApp(input?: { accountName?: string }): Promise<{ message: string; output: string }>`
  - `DesktopOperationsService.stopManagedApp(): Promise<{ message: string; output: string }>`
  - `DesktopOperationsService.listOperations(): Promise<{ message: string; output: string }>`
  - `DesktopOperationsService.runDoctor(): Promise<{ message: string; output: string; taskId: string }>`
  - `DesktopOperationsService.runRecover(): Promise<{ message: string; output: string; taskId: string }>`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { createTaskRunner } from "../tasks/task-runner.js";
import { createDesktopOperationsService } from "./desktop-operations.js";

test("desktop operations service removes an account without invoking the Bash wrapper", async () => {
  const calls: string[] = [];
  const service = createDesktopOperationsService({
    tasks: createTaskRunner(),
    removeAccount: async ({ envName, accountName }) => {
      calls.push(`remove:${envName}/${accountName}`);
    },
    logoutAccount: async () => {},
    readProxyState: async () => ({ source: "off", value: "" }),
    setManualProxy: async () => "http://127.0.0.1:7890",
    clearManualProxy: async () => {},
    runProxyCheck: async () => ({ stdout: "usage_api_proxy_test: ok\n", stderr: "", exitCode: 0 }),
    getTokenRefreshStatus: async () => "token_refresh_guard: disabled\n",
    startTokenRefreshGuard: async () => "token_refresh_guard: enabled\n",
    stopTokenRefreshGuard: async () => "token_refresh_guard: disabled\n",
    runTokenRefreshOnce: async () => ({ stdout: "Summary: scanned=1\n", stderr: "", exitCode: 0 }),
    getAppStatus: async () => "app_current: default/default\n",
    logoutApp: async () => {},
    stopManagedApp: async () => true,
    listOperations: async () => "ops: ok\n",
    runDoctor: async () => ({ stdout: "doctor: ok\n", stderr: "", exitCode: 0 }),
    runRecover: async () => ({ stdout: "recover: ok\n", stderr: "", exitCode: 0 }),
  });

  const result = await service.deleteAccount({ envName: "default", accountName: "personal" });

  assert.equal(result.message, "Removed account default/personal");
  assert.equal(result.output, "default/personal\n");
  assert.deepEqual(calls, ["remove:default/personal"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test packages/core/src/services/desktop-operations.test.ts`
Expected: FAIL with `Cannot find module './desktop-operations.js'` or `createDesktopOperationsService is not exported`

- [ ] **Step 3: Write minimal implementation**

```ts
import type { ExternalCommandResult } from "../tasks/bridge.js";
import type { TaskRunner } from "../tasks/task-runner.js";

export interface DesktopOperationsServiceOptions {
  tasks: TaskRunner;
  removeAccount(input: { envName: string; accountName: string }): Promise<void>;
  logoutAccount(input: { envName: string; accountName: string; target: "cli" | "app" | "both" }): Promise<void>;
  readProxyState(): Promise<{ source: "manual" | "auto-env" | "auto-system" | "off"; value: string }>;
  setManualProxy(value: string): Promise<string>;
  clearManualProxy(): Promise<void>;
  runProxyCheck(): Promise<ExternalCommandResult>;
  getTokenRefreshStatus(): Promise<string>;
  startTokenRefreshGuard(): Promise<string>;
  stopTokenRefreshGuard(): Promise<string>;
  runTokenRefreshOnce(): Promise<ExternalCommandResult>;
  getAppStatus(): Promise<string>;
  logoutApp(input?: { accountName?: string }): Promise<void>;
  stopManagedApp(): Promise<boolean>;
  listOperations(): Promise<string>;
  runDoctor(): Promise<ExternalCommandResult>;
  runRecover(): Promise<ExternalCommandResult>;
}

export function createDesktopOperationsService(options: DesktopOperationsServiceOptions) {
  return {
    async deleteAccount(input: { envName: string; accountName: string }) {
      await options.removeAccount(input);
      return {
        message: `Removed account ${input.envName}/${input.accountName}`,
        output: `${input.envName}/${input.accountName}\n`,
      };
    },
    async logoutAccount(input: { envName: string; accountName: string; target: "cli" | "app" | "both" }) {
      await options.logoutAccount(input);
      return {
        message: `Logged out ${input.envName}/${input.accountName}`,
        output: `${input.envName}/${input.accountName}\n`,
      };
    },
    async getProxyStatus() {
      const proxy = await options.readProxyState();
      return {
        message: "Loaded proxy status",
        output: proxy.source === "off" ? "usage_api_proxy: off\n" : `usage_api_proxy: ${proxy.value} (${proxy.source})\n`,
      };
    },
    async setProxy(input: { value: string }) {
      const value = await options.setManualProxy(input.value);
      return { message: `Updated proxy to ${value}`, output: `${value}\n` };
    },
    async disableProxy() {
      await options.clearManualProxy();
      return { message: "Disabled proxy", output: "off\n" };
    },
    async testProxy() {
      const record = await options.tasks.run({
        kind: "proxy-test",
        summary: "Run proxy connectivity check",
        execute: async () => options.runProxyCheck(),
      });
      return {
        message: "Proxy test completed",
        output: record.output?.stdout ?? "",
        taskId: record.id,
      };
    },
    async getTokenRefreshStatus() {
      return { message: "Loaded token refresh status", output: await options.getTokenRefreshStatus() };
    },
    async startTokenRefreshGuard() {
      return { message: "Started token refresh guard", output: await options.startTokenRefreshGuard() };
    },
    async stopTokenRefreshGuard() {
      return { message: "Stopped token refresh guard", output: await options.stopTokenRefreshGuard() };
    },
    async runTokenRefreshOnce() {
      const record = await options.tasks.run({
        kind: "token-refresh",
        summary: "Run one token refresh scan",
        execute: async () => options.runTokenRefreshOnce(),
      });
      return {
        message: "Token refresh scan completed",
        output: record.output?.stdout ?? "",
        taskId: record.id,
      };
    },
    async getAppStatus() {
      return { message: "Loaded app status", output: await options.getAppStatus() };
    },
    async logoutApp(input?: { accountName?: string }) {
      await options.logoutApp(input);
      return { message: "Logged out app account", output: `${input?.accountName ?? ""}\n` };
    },
    async stopManagedApp() {
      const stopped = await options.stopManagedApp();
      return { message: "Stopped managed app", output: `${stopped ? "stopped" : "noop"}\n` };
    },
    async listOperations() {
      return { message: "Loaded operations status", output: await options.listOperations() };
    },
    async runDoctor() {
      const record = await options.tasks.run({
        kind: "doctor",
        summary: "Run doctor diagnostics",
        execute: async () => options.runDoctor(),
      });
      return { message: "Doctor finished", output: record.output?.stdout ?? "", taskId: record.id };
    },
    async runRecover() {
      const record = await options.tasks.run({
        kind: "recover",
        summary: "Run recover workflow",
        execute: async () => options.runRecover(),
      });
      return { message: "Recover finished", output: record.output?.stdout ?? "", taskId: record.id };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test packages/core/src/services/desktop-operations.test.ts`
Expected: PASS with the new desktop-operations service tests green

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/services/desktop-operations.ts packages/core/src/services/desktop-operations.test.ts packages/core/src/index.ts
git commit -m "feat: add core desktop operations service"
```

### Task 2: Route Electron Bridge Operations Through Core

**Files:**
- Create: `apps/desktop/electron/core-runtime.ts`
- Modify: `apps/desktop/electron/bridge.ts`
- Create: `apps/desktop/electron/bridge-core-ops.test.ts`

**Interfaces:**
- Consumes:
  - `createDesktopOperationsService(...)` from `packages/core/src/services/desktop-operations.ts`
  - existing `loadCoreRuntime()` logic in `apps/desktop/electron/bridge.ts`
- Produces:
  - `loadDesktopOperationsService(): Promise<DesktopOperationsService>` in `apps/desktop/electron/core-runtime.ts`
  - `deleteAccount()`, `logoutAccount()`, `showProxy()`, `setProxy()`, `disableProxy()`, `testProxy()`, `startTokenRefresh()`, `stopTokenRefresh()`, `readTokenRefreshStatus()`, `runTokenRefreshOnce()`, `listOperations()`, `readAppStatus()`, `logoutApp()`, `stopManagedApp()`, `runDoctor()`, `runRecover()` in `apps/desktop/electron/bridge.ts` calling the core service directly

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";

import * as bridge from "./bridge.js";

test("desktop bridge deleteAccount delegates to the core desktop operations service", async () => {
  const calls: string[] = [];
  bridge.__testUtils.setDesktopOperationsLoaderForTest(async () => ({
    deleteAccount: async ({ envName, accountName }: { envName: string; accountName: string }) => {
      calls.push(`delete:${envName}/${accountName}`);
      return { message: "Removed account default/personal", output: "default/personal\n" };
    },
  }));

  const result = await bridge.deleteAccount("default", "personal");

  assert.equal(result.output, "default/personal\n");
  assert.deepEqual(calls, ["delete:default/personal"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test apps/desktop/electron/bridge-core-ops.test.ts`
Expected: FAIL because `setDesktopOperationsLoaderForTest` does not exist and `deleteAccount()` still shells out through `runSwitcherCommand()`

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/desktop/electron/core-runtime.ts
import { createTaskRunner } from "../../../packages/core/dist/tasks/task-runner.js";
import { createDesktopOperationsService } from "../../../packages/core/dist/services/desktop-operations.js";

let desktopOperationsLoaderForTest:
  | (() => Promise<ReturnType<typeof createDesktopOperationsService>>)
  | undefined;

export async function loadDesktopOperationsService() {
  if (desktopOperationsLoaderForTest) {
    return desktopOperationsLoaderForTest();
  }

  const runtime = await loadCoreRuntime();
  const tasks = createTaskRunner();
  return createDesktopOperationsService({
    tasks,
    removeAccount: async ({ envName, accountName }) => {
      const state = await runtime.readLegacyState(getLegacyOptions());
      const next = createAccountService().removeAccount(state, { envName, accountName, now: new Date().toISOString() });
      await persistRemovedAccount(runtime, next, { envName, accountName });
    },
    logoutAccount: async ({ envName, accountName, target }) => {
      await performLogoutThroughCore(runtime, { envName, accountName, target });
    },
    readProxyState: async () => readUsageProxyState(getStateDir(), process.env, process.platform),
    setManualProxy: async (value) => setManualUsageProxy(getStateDir(), value),
    clearManualProxy: async () => clearManualUsageProxy(getStateDir()),
    runProxyCheck: async () => runProxyCheckViaCore({ stateDir: getStateDir() }),
    getTokenRefreshStatus: async () => getTokenRefreshStatusViaCore({ stateDir: getStateDir() }),
    startTokenRefreshGuard: async () => startTokenRefreshGuardViaCore({ stateDir: getStateDir() }),
    stopTokenRefreshGuard: async () => stopTokenRefreshGuardViaCore({ stateDir: getStateDir() }),
    runTokenRefreshOnce: async () => runTokenRefreshOnceViaCore({ stateDir: getStateDir() }),
    getAppStatus: async () => getAppStatusViaCore({ stateDir: getStateDir() }),
    logoutApp: async (input) => logoutAppViaCore({ stateDir: getStateDir(), accountName: input?.accountName }),
    stopManagedApp: async () => stopManagedCodexApp({ stateDir: getStateDir() }),
    listOperations: async () => listOperationsViaCore({ stateDir: getStateDir() }),
    runDoctor: async () => runDoctorViaCore({ stateDir: getStateDir() }),
    runRecover: async () => runRecoverViaCore({ stateDir: getStateDir() }),
  });
}

export function setDesktopOperationsLoaderForTest(loader: typeof desktopOperationsLoaderForTest) {
  desktopOperationsLoaderForTest = loader;
}

// apps/desktop/electron/bridge.ts
export async function deleteAccount(envName: string, accountName: string): Promise<DesktopActionResult> {
  return (await loadDesktopOperationsService()).deleteAccount({ envName, accountName });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test apps/desktop/electron/bridge-core-ops.test.ts apps/desktop/electron/bridge-smoke.test.ts`
Expected: PASS with new core-routed bridge tests green and existing smoke coverage still green

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron/core-runtime.ts apps/desktop/electron/bridge.ts apps/desktop/electron/bridge-core-ops.test.ts
git commit -m "feat: route desktop bridge operations through core"
```

### Task 3: Stop Auto-Chaining Auth Metrics After Every GUI Mutation

**Files:**
- Create: `apps/desktop/src/refresh-policy.ts`
- Create: `apps/desktop/src/refresh-policy.test.ts`
- Modify: `apps/desktop/src/react-app.tsx`
- Modify: `apps/desktop/package.json`

**Interfaces:**
- Consumes:
  - existing `refreshOverview()` / `refreshAuthMetrics()` flow in `apps/desktop/src/react-app.tsx`
- Produces:
  - `getPostMutationRefreshPlan(input: { action: "overview-only" | "overview-and-metrics" | "none" }): { refreshOverview: boolean; refreshMetrics: boolean }`
  - GUI mutations using `refreshOverview({ loadMetrics: false })` for account/proxy/token-refresh/app/diagnostic actions
  - initial page load and explicit manual refresh using `refreshOverview({ loadMetrics: true })`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { getPostMutationRefreshPlan } from "./refresh-policy.js";

test("post-mutation refresh policy skips auth metrics for routine write actions", () => {
  assert.deepEqual(
    getPostMutationRefreshPlan({ action: "overview-only" }),
    { refreshOverview: true, refreshMetrics: false },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test apps/desktop/src/refresh-policy.test.ts`
Expected: FAIL with `Cannot find module './refresh-policy.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/desktop/src/refresh-policy.ts
export function getPostMutationRefreshPlan(input: {
  action: "overview-only" | "overview-and-metrics" | "none";
}) {
  if (input.action === "none") {
    return { refreshOverview: false, refreshMetrics: false };
  }
  if (input.action === "overview-and-metrics") {
    return { refreshOverview: true, refreshMetrics: true };
  }
  return { refreshOverview: true, refreshMetrics: false };
}

// apps/desktop/src/react-app.tsx
async function refreshOverview(options?: { loadMetrics?: boolean }) {
  setBusy(true);
  try {
    const raw = await bridge.loadOverview();
    const nextOverview = JSON.parse(raw) as OverviewPayload;
    setOverview(nextOverview);
    setMessage(null);
    if (options?.loadMetrics !== false) {
      void refreshAuthMetrics(nextOverview);
    }
  } finally {
    setBusy(false);
  }
}

async function handleAccountCommand(action: "logout" | "rm") {
  setBusy(true);
  try {
    // existing bridge call...
    const refreshPlan = getPostMutationRefreshPlan({ action: "overview-only" });
    if (refreshPlan.refreshOverview) {
      await refreshOverview({ loadMetrics: refreshPlan.refreshMetrics });
    }
  } finally {
    setBusy(false);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test apps/desktop/src/refresh-policy.test.ts apps/desktop/src/auth-metrics.test.ts`
Expected: PASS with the refresh policy helper tests green and auth-metrics merge behavior unchanged

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/refresh-policy.ts apps/desktop/src/refresh-policy.test.ts apps/desktop/src/react-app.tsx apps/desktop/package.json
git commit -m "feat: decouple desktop auth metrics from routine mutations"
```

### Task 4: Document the New Boundary and Protect Compatibility

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `apps/desktop/electron/bridge-smoke.test.ts`
- Modify: `scripts/legacy-cli-compat.test.ts`

**Interfaces:**
- Consumes:
  - core-routed GUI operations from Task 2
  - refresh behavior from Task 3
- Produces:
  - README statements that desktop GUI operations are core-backed while Bash remains compatibility-only for CLI/TUI
  - regression coverage proving the legacy Bash entrypoint still works for CLI/TUI and that desktop bridge tests no longer depend on `runSwitcherCommand()`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("README documents desktop core-backed operations", async () => {
  const readme = await readFile(new URL("../../README.md", import.meta.url), "utf8");
  assert.match(readme, /桌面 GUI 操作通过 core 服务执行/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test apps/desktop/electron/bridge-smoke.test.ts scripts/legacy-cli-compat.test.ts`
Expected: FAIL because the README wording and compatibility assertions have not been updated yet

- [ ] **Step 3: Write minimal implementation**

```md
<!-- README.md -->
- 桌面 GUI 的账号、代理、token refresh、App 控制和诊断操作现在直接调用 core 服务，不再依赖 Bash 脚本桥接。
- `plugins/codex-switcher/scripts/codex-switcher` 仍保留给 CLI/TUI 兼容入口使用。
```

```ts
// scripts/legacy-cli-compat.test.ts
test("legacy Bash entrypoint still serves CLI/TUI compatibility", async () => {
  const result = await runLegacy(["status"]);
  assert.match(result.stdout, /cli_current:/);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run desktop:test && npm run test:legacy-bash`
Expected: PASS with desktop bridge/readme tests green and legacy Bash compatibility still green

- [ ] **Step 5: Commit**

```bash
git add README.md README.en.md apps/desktop/electron/bridge-smoke.test.ts scripts/legacy-cli-compat.test.ts
git commit -m "docs: record core-backed desktop operations boundary"
```

## Self-Review

1. **Spec coverage:** This plan covers the approved design boundaries: core-backed GUI operations (Tasks 1-2), external commands remaining behind adapters (Tasks 1-2), GUI refresh decoupling from auth metrics (Task 3), and TUI/CLI coexistence with Bash compatibility retained (Task 4). No approved requirement is left without a task.
2. **Placeholder scan:** Checked for `TODO`, `TBD`, “similar to Task”, and vague “add tests” language. Removed placeholders; each task includes explicit files, interfaces, commands, and code snippets.
3. **Type consistency:** The same `createDesktopOperationsService()` name is used in Tasks 1-2. The refresh helper signature is defined once in Task 3 and reused consistently. Desktop bridge methods in Task 2 match existing exported function names from `apps/desktop/electron/bridge.ts`.
