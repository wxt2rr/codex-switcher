import assert from "node:assert/strict";
import test from "node:test";

import { AppWindowLaunchError, assertCanMultiOpen, buildAppWindowLaunchPlan, executeAppWindowLaunchPlan, launchAndPersistAdditionalAppWindow, resolveCurrentAppWindowCount } from "./app-window-lifecycle.js";

test("tracked live windows override a stale persisted multi-open count", () => {
  assert.equal(resolveCurrentAppWindowCount(3, 1), 1);
  assert.equal(resolveCurrentAppWindowCount(3, 0), 1);
  assert.equal(resolveCurrentAppWindowCount(3, undefined), 3);
});

test("macOS and Windows executable targets restart the environment and restore every window", () => {
  assert.deepEqual(buildAppWindowLaunchPlan({ mode: "reconcile", desiredCount: 3, packagedWindowsTarget: false }), {
    stopPackagedProcesses: false,
    materializePackagedHome: false,
    actions: ["restart", "new", "new"],
  });
});

test("Windows packaged targets stop and materialize once before repeated activation", () => {
  assert.deepEqual(buildAppWindowLaunchPlan({ mode: "reconcile", desiredCount: 3, packagedWindowsTarget: true }), {
    stopPackagedProcesses: true,
    materializePackagedHome: true,
    actions: ["new", "new", "new"],
  });
});

test("multi-open always launches one additional window without replacing existing windows", () => {
  for (const packagedWindowsTarget of [false, true]) {
    assert.deepEqual(buildAppWindowLaunchPlan({ mode: "additional", desiredCount: 8, packagedWindowsTarget }), {
      stopPackagedProcesses: false,
      materializePackagedHome: false,
      actions: ["new"],
    });
  }
});

test("multi-open requires the active App account and respects the window cap", () => {
  const valid = { target: "app" as const, envName: "project", accountName: "active",
    activeEnvName: "project", activeAccountName: "active", currentCount: 2, maximumCount: 8 };
  assert.doesNotThrow(() => assertCanMultiOpen(valid));
  assert.throws(() => assertCanMultiOpen({ ...valid, accountName: "inactive" }), /Only the active App account/);
  assert.throws(() => assertCanMultiOpen({ ...valid, target: "cli" }), /only supported for App/);
  assert.throws(() => assertCanMultiOpen({ ...valid, currentCount: 8 }), /up to 8 windows/);
});

test("multi-open persists only after the additional window launches successfully", async () => {
  const calls: string[] = [];
  const saved = await launchAndPersistAdditionalAppWindow({ currentCount: 2, maximumCount: 8,
    launch: async () => { calls.push("launch"); },
    saveCount: async (count) => { calls.push(`save:${count}`); return count; } });
  assert.equal(saved, 3);
  assert.deepEqual(calls, ["launch", "save:3"]);

  calls.length = 0;
  await assert.rejects(launchAndPersistAdditionalAppWindow({ currentCount: 2, maximumCount: 8,
    launch: async () => { calls.push("launch"); throw new Error("launch failed"); },
    saveCount: async (count) => { calls.push(`save:${count}`); return count; } }), /launch failed/);
  assert.deepEqual(calls, ["launch"]);
});

test("window reconciliation reports the successful count when a later launch fails", async () => {
  const plan = buildAppWindowLaunchPlan({ mode: "reconcile", desiredCount: 3, packagedWindowsTarget: false });
  let newCalls = 0;
  await assert.rejects(
    executeAppWindowLaunchPlan(plan, {
      restart: async () => undefined,
      launchNew: async () => { newCalls += 1; if (newCalls === 2) throw new Error("second launch failed"); },
    }),
    (error) => error instanceof AppWindowLaunchError && error.launchedCount === 2,
  );
});
