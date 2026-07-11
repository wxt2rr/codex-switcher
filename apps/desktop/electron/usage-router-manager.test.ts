import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { UsageRouterManager } from "./usage-router-manager.js";
import { startUsageRouterService } from "./usage-router-service.js";

test("environment routing skips AUTH accounts and restores exact upstream URLs", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-manager-"));
  let service: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;
  const manager = new UsageRouterManager({
    stateDir, serviceEntryPath: "unused",
    launchService: async () => { service = await startUsageRouterService({ stateDir: join(stateDir, "usage-router") }); },
  });
  const values = new Map<string, string>();
  const update = async (account: string, baseUrl: string) => { values.set(account, baseUrl); };
  try {
    const enabled = await manager.enableEnvironment("work", [
      { envName: "work", accountName: "key", authMode: "apikey", baseUrl: "https://api.example.com/v1/" },
      { envName: "work", accountName: "login", authMode: "auth", baseUrl: "" },
    ], update);
    assert.equal(enabled.routedAccounts, 1);
    assert.match(values.get("key") ?? "", /^http:\/\/127\.0\.0\.1:\d+\/routes\//);
    assert.equal(values.has("login"), false);

    await manager.disableEnvironment("work", update);
    assert.equal(values.get("key"), "https://api.example.com/v1/");
  } finally {
    await service?.close();
  }
});

test("read-only route lookup does not start a missing router service", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-manager-readonly-"));
  let launchCount = 0;
  const manager = new UsageRouterManager({
    stateDir,
    serviceEntryPath: "unused",
    launchService: async () => { launchCount += 1; },
  });
  assert.deepEqual(await manager.listRoutesIfRunning(), []);
  assert.equal(launchCount, 0);
});

test("syncing an enabled environment attaches newly created non-AUTH accounts", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-manager-sync-"));
  let service: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;
  const manager = new UsageRouterManager({
    stateDir,
    serviceEntryPath: "unused",
    launchService: async () => { service = await startUsageRouterService({ stateDir: join(stateDir, "usage-router") }); },
  });
  const values = new Map<string, string>();
  const update = async (account: string, baseUrl: string) => { values.set(account, baseUrl); };
  try {
    await manager.enableEnvironment("work", [
      { envName: "work", accountName: "existing", authMode: "apikey", baseUrl: "https://api.example.com/v1" },
    ], update);

    assert.equal(await manager.isEnvironmentEnabled("work"), true);

    const synced = await manager.syncEnvironmentIfEnabled("work", [
      { envName: "work", accountName: "existing", authMode: "apikey", baseUrl: values.get("existing") ?? "" },
      { envName: "work", accountName: "new-key", authMode: "apikey", baseUrl: "https://api.new.example/v1" },
      { envName: "work", accountName: "new-auth", authMode: "auth", baseUrl: "" },
    ], update);

    assert.equal(synced?.routedAccounts, 2);
    assert.match(values.get("new-key") ?? "", /^http:\/\/127\.0\.0\.1:\d+\/routes\//);
    assert.equal(values.has("new-auth"), false);
  } finally {
    await service?.close();
  }
});

test("syncing a disabled environment does not start the router or rewrite accounts", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-manager-disabled-sync-"));
  let launchCount = 0;
  const manager = new UsageRouterManager({
    stateDir,
    serviceEntryPath: "unused",
    launchService: async () => { launchCount += 1; },
  });
  let updateCount = 0;

  const synced = await manager.syncEnvironmentIfEnabled("work", [
    { envName: "work", accountName: "new-key", authMode: "apikey", baseUrl: "https://api.new.example/v1" },
  ], async () => { updateCount += 1; });

  assert.equal(synced, null);
  assert.equal(launchCount, 0);
  assert.equal(updateCount, 0);
});
