import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isCompatibleRouterHealth, UsageRouterManager } from "./usage-router-manager.js";
import { startUsageRouterService } from "./usage-router-service.js";

test("router manager rejects stale health responses without the compatibility API version", () => {
  assert.equal(isCompatibleRouterHealth({ ok: true, pid: 1 }), false);
  assert.equal(isCompatibleRouterHealth({ ok: true, pid: 1, apiVersion: 2 }), false);
  assert.equal(isCompatibleRouterHealth({ ok: true, pid: 1, apiVersion: 3 }), false);
  assert.equal(isCompatibleRouterHealth({ ok: true, pid: 1, apiVersion: 4 }), false);
  assert.equal(isCompatibleRouterHealth({ ok: true, pid: 1, apiVersion: 5 }), false);
  assert.equal(isCompatibleRouterHealth({ ok: true, pid: 1, apiVersion: 6 }), true);
});

test("router manager passes the configured preferred port to the service launcher", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-manager-port-"));
  let receivedPort: number | undefined;
  let service: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;
  const manager = new UsageRouterManager({
    stateDir,
    serviceEntryPath: "unused",
    preferredPort: async () => 19321,
    launchService: async (preferredPort) => {
      receivedPort = preferredPort;
      service = await startUsageRouterService({ stateDir: join(stateDir, "usage-router") });
    },
  });
  try {
    await manager.ensureService();
    assert.equal(receivedPort, 19321);
  } finally {
    await service?.close();
  }
});

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

test("disabling an environment removes stale routes for missing accounts instead of failing", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-manager-stale-disable-"));
  let service: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;
  const manager = new UsageRouterManager({
    stateDir,
    serviceEntryPath: "unused",
    launchService: async () => { service = await startUsageRouterService({ stateDir: join(stateDir, "usage-router") }); },
  });

  try {
    await manager.enableEnvironment("work", [
      { envName: "work", accountName: "ghost", authMode: "apikey", baseUrl: "https://api.example.com/v1" },
    ], async () => undefined);

    const disabled = await manager.disableEnvironment("work", async (accountName) => {
      throw new Error(`Account 'work/${accountName}' not found`);
    });

    assert.equal(disabled.enabled, false);
    assert.deepEqual(await manager.listRoutes(), []);
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

test("persisted route lookup survives a stopped router and stopService is graceful", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-manager-persisted-"));
  let service: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;
  const manager = new UsageRouterManager({
    stateDir,
    serviceEntryPath: "unused",
    launchService: async () => { service = await startUsageRouterService({ stateDir: join(stateDir, "usage-router") }); },
  });

  await manager.enableEnvironment("work", [
    { envName: "work", accountName: "key", authMode: "apikey", baseUrl: "https://api.example.com/v1" },
  ], async () => undefined);
  assert.equal((await manager.listPersistedRoutes()).length, 1);
  assert.equal(await manager.stopService(), true);
  assert.deepEqual(await manager.listRoutesIfRunning(), []);
  assert.equal((await manager.listPersistedRoutes())[0]?.envName, "work");
  const restored = await manager.enableEnvironment("work", [
    { envName: "work", accountName: "key", authMode: "apikey", baseUrl: "https://api.example.com/v1" },
  ], async () => undefined);
  assert.equal(restored.enabled, true);
  assert.equal((await manager.listRoutesIfRunning()).length, 1);
  await service?.close();
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

test("account compatibility persists only the local token, hydrates the router, and disables transactionally", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-account-compat-"));
  let service: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;
  const manager = new UsageRouterManager({ stateDir, serviceEntryPath: "unused",
    launchService: async () => { service = await startUsageRouterService({ stateDir: join(stateDir, "usage-router") }); } });
  let runtime: { baseUrl: string; localRouteToken: string; providerId: string } | undefined;
  let restored = "";
  try {
    const enabled = await manager.enableAccountCompatibility({ envName: "work", accountName: "chat", authMode: "apikey",
      baseUrl: "https://api.example.com/v1", apiKey: "sk-upstream", upstreamModel: "provider-model",
      longConversationStrategy: "continuity", instructionRole: "developer" },
    async (value) => { runtime = value; });
    assert.equal(enabled.state, "ready");
    assert.match(runtime?.baseUrl ?? "", /^http:\/\/127\.0\.0\.1:\d+\/routes\//);
    assert(runtime?.localRouteToken);
    assert.equal((await manager.getAccountCompatibilityStatuses(["work/chat"]))[0]?.state, "ready");
    assert.equal((await manager.listRoutes())[0]?.longConversationStrategy, "continuity");
    assert.equal((await manager.listRoutes())[0]?.instructionRole, "developer");

    const tokenFile = await import("node:fs/promises").then(({ readFile }) => readFile(join(stateDir, "usage-router", "compatibility-route-tokens.json"), "utf8"));
    assert.equal(tokenFile.includes("sk-upstream"), false);
    assert.equal(tokenFile.includes(runtime?.localRouteToken ?? "missing"), true);

    const disabled = await manager.disableAccountCompatibility("work", "chat", async (value) => { restored = value; });
    assert.equal(disabled.state, "disabled");
    assert.equal(restored, "https://api.example.com/v1");
  } finally { await service?.close(); }
});
