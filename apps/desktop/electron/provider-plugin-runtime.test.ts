import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeProviderPluginRuntime,
  getProviderPluginAdapter,
  listProviderPluginMarket,
  listProviderPlugins,
  refreshProviderPluginMarket,
} from "./provider-plugin-runtime.js";
import { PluginMarket } from "../../../packages/gateway/dist/index.js";

test("desktop provider plugin runtime keeps an empty installation state lazy", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-desktop-plugin-runtime-"));
  try {
    assert.deepEqual(await listProviderPlugins(stateDir), []);
    assert.equal(await getProviderPluginAdapter(stateDir, "missing-provider"), undefined);
  } finally {
    await closeProviderPluginRuntime();
  }
});

test("desktop provider plugin market reads explicit sources and rejects unsupported URLs", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-desktop-plugin-market-"));
  try {
    const cachePath = PluginMarket.cachePath(stateDir);
    await mkdir(join(stateDir, "plugins"), { recursive: true });
    await writeFile(cachePath, `${JSON.stringify([{
      id: "provider-demo", name: "Demo", version: "1.0.0", apiVersion: 1,
      entry: "index.js", permissions: ["provider"], source: { kind: "npm", spec: "provider-demo@1.0.0" }, updatedAt: Date.now(),
    }])}\n`, "utf8");
    const entries = await listProviderPluginMarket(stateDir);
    assert.equal(entries[0]?.source?.kind, "npm");
    await assert.rejects(refreshProviderPluginMarket(stateDir, "file:///tmp/plugins.json"), /http or https/);
  } finally {
    await closeProviderPluginRuntime();
  }
});
