import assert from "node:assert/strict";
import test from "node:test";
import {
  AppEnvironmentBadgeManager,
  createEnvironmentBadgeIdentity,
  managedRecordToBadgeInstance,
  type AppEnvironmentBadgeAdapter,
} from "./app-environment-badges.js";

test("environment identity is stable and uppercases Latin initials", () => {
  assert.equal(createEnvironmentBadgeIdentity("wangxt").label, "W");
  assert.equal(createEnvironmentBadgeIdentity("公司").label, "公");
  assert.deepEqual(createEnvironmentBadgeIdentity("wangxt"), createEnvironmentBadgeIdentity("wangxt"));
});

test("managed records use environment scope and reject unusable records", () => {
  assert.equal(managedRecordToBadgeInstance({ instanceId: "1", pid: 12, targetKey: "personal/account" })?.environment, "personal");
  assert.equal(managedRecordToBadgeInstance({ instanceId: "2", pid: 0, targetKey: "personal" }), null);
  assert.equal(managedRecordToBadgeInstance({ instanceId: "3", pid: 12 }), null);
});

test("manager only persists enable after permission and clears on disable", async () => {
  let enabled = false;
  let permission: "denied" | "granted" = "denied";
  let clearCalls = 0;
  const adapter: AppEnvironmentBadgeAdapter = {
    platform: "macos", supported: true,
    checkPermission: async () => permission,
    requestPermission: async () => permission,
    sync: async (instances) => ({ applied: instances.length, unresolved: 0 }),
    clear: async () => { clearCalls += 1; },
  };
  const manager = new AppEnvironmentBadgeManager({
    adapter,
    readEnabled: async () => enabled,
    saveEnabled: async (value) => { enabled = value; },
    listInstances: async () => [{ instanceId: "1", pid: 42, targetKey: "personal" }],
  });
  assert.equal((await manager.setEnabled(true)).enabled, false);
  permission = "granted";
  assert.deepEqual(await manager.setEnabled(true), {
    enabled: true, supported: true, platform: "macos", permission: "granted", applied: 1, unresolved: 0,
  });
  assert.equal((await manager.setEnabled(false)).enabled, false);
  assert.equal(clearCalls, 1);
});

test("adapter failures become partial status without rejecting", async () => {
  const manager = new AppEnvironmentBadgeManager({
    adapter: {
      platform: "windows", supported: true,
      checkPermission: async () => "not-required",
      requestPermission: async () => "not-required",
      sync: async () => { throw new Error("native helper missing"); },
      clear: async () => undefined,
    },
    readEnabled: async () => true,
    saveEnabled: async () => undefined,
    listInstances: async () => [{ instanceId: "1", pid: 42, targetKey: "company" }],
  });
  const status = await manager.sync();
  assert.equal(status.enabled, true);
  assert.equal(status.unresolved, 1);
  assert.match(status.message ?? "", /helper missing/);
});

test("revoked permission disables and clears an enabled manager", async () => {
  let enabled = true;
  let clears = 0;
  const manager = new AppEnvironmentBadgeManager({
    adapter: {
      platform: "macos", supported: true,
      checkPermission: async () => "denied",
      requestPermission: async () => "denied",
      sync: async () => ({ applied: 1, unresolved: 0 }),
      clear: async () => { clears += 1; },
    },
    readEnabled: async () => enabled,
    saveEnabled: async (value) => { enabled = value; },
    listInstances: async () => [{ instanceId: "1", pid: 42, targetKey: "personal" }],
  });
  const status = await manager.sync();
  assert.equal(status.enabled, false);
  assert.equal(enabled, false);
  assert.equal(clears, 1);
});
