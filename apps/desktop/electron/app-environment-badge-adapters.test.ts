import assert from "node:assert/strict";
import test from "node:test";
import { MacDockBadgeAdapter, type MacBadgeNativeModule } from "./app-environment-badge-adapters.js";

function nativeModule(checks: boolean[]): MacBadgeNativeModule {
  return {
    isTrustedAccessibilityClient: () => checks.shift() ?? false,
    getBundleIdentifier: () => "com.wangxt.codex-switcher",
    getCodexDockRects: () => [],
    setEnvironmentBadges: () => 0,
    clearEnvironmentBadges: () => undefined,
  };
}

test("macOS permission request resets only the current denied bundle before prompting", async () => {
  const resets: string[] = [];
  const adapter = new MacDockBadgeAdapter("/tmp/app-environment-badge-adapters.test.cjs", {
    native: nativeModule([false, false]),
    resetAccessibilityPermission: async (bundleIdentifier) => { resets.push(bundleIdentifier); },
  });
  assert.equal(await adapter.requestPermission(), "denied");
  assert.deepEqual(resets, ["com.wangxt.codex-switcher"]);
});

test("macOS permission request preserves an already trusted entry", async () => {
  const resets: string[] = [];
  const adapter = new MacDockBadgeAdapter("/tmp/app-environment-badge-adapters.test.cjs", {
    native: nativeModule([true]),
    resetAccessibilityPermission: async (bundleIdentifier) => { resets.push(bundleIdentifier); },
  });
  assert.equal(await adapter.requestPermission(), "granted");
  assert.deepEqual(resets, []);
});

test("macOS badge sync forwards process ids for native Dock item matching", async () => {
  let received: Array<{ pid: number; label: string; color: string }> = [];
  const adapter = new MacDockBadgeAdapter("/tmp/app-environment-badge-adapters.test.cjs", {
    native: {
      ...nativeModule([]),
      setEnvironmentBadges: (instances) => {
        received = instances;
        return instances.length;
      },
    },
  });

  const result = await adapter.sync([
    { instanceId: "instance-2", pid: 2468, environment: "wangxt", label: "W", color: "#0A84FF" },
  ]);

  assert.equal(result.applied, 1);
  assert.deepEqual(received, [{ pid: 2468, label: "W", color: "#0A84FF" }]);
});
