import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
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
  assert.equal(isCompatibleRouterHealth({ ok: true, pid: 1, apiVersion: 6 }), false);
  assert.equal(isCompatibleRouterHealth({ ok: true, pid: 1, apiVersion: 7 }), false);
  assert.equal(isCompatibleRouterHealth({ ok: true, pid: 1, apiVersion: 8 }), false);
  assert.equal(isCompatibleRouterHealth({ ok: true, pid: 1, apiVersion: 9 }), false);
  assert.equal(isCompatibleRouterHealth({ ok: true, pid: 1, apiVersion: 10 }), true);
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

test("environment routing includes AUTH credentials and restores exact upstream URLs", async () => {
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
      { envName: "work", accountName: "login", authMode: "auth", baseUrl: "", apiKey: "auth-token", authAccountId: "chat-account" },
    ], update);
    assert.equal(enabled.routedAccounts, 2);
    assert.match(values.get("key") ?? "", /^http:\/\/127\.0\.0\.1:\d+\/routes\//);
    assert.match(values.get("login") ?? "", /^http:\/\/127\.0\.0\.1:\d+\/routes\//);
    assert.equal((await manager.listRoutes()).find((route) => route.accountName === "login")?.upstreamBaseUrl, "https://chatgpt.com/backend-api/codex");

    await manager.disableEnvironment("work", update);
    assert.equal(values.get("key"), "https://api.example.com/v1/");
    assert.equal(values.get("login"), "default");
  } finally {
    await service?.close();
  }
});

test("environment routing hydrates managed no-auth provider accounts without an API key", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-manager-no-auth-provider-"));
  let service: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;
  const manager = new UsageRouterManager({
    stateDir, serviceEntryPath: "unused",
    launchService: async () => { service = await startUsageRouterService({ stateDir: join(stateDir, "usage-router") }); },
  });
  try {
    await manager.enableEnvironment("test", [{
      envName: "test", accountName: "ourfree1", authMode: "apikey",
      providerId: "our-free-model", providerAuthMethod: "none",
      baseUrl: "https://our-free-model.invalid/v1",
    }], async () => undefined);
    const route = (await manager.listRoutes()).find((item) => item.accountName === "ourfree1");
    assert(route);
    const status = await fetch(`${service!.origin}/admin/routes/${encodeURIComponent(route.routeId)}/status`, {
      headers: { authorization: `Bearer ${service!.adminToken}` },
    });
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { routeId: route.routeId, hydrated: true });
  } finally {
    await service?.close();
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("environment gateway shares one local base URL and restores all member URLs", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-manager-gateway-"));
  let service: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;
  const manager = new UsageRouterManager({
    stateDir, serviceEntryPath: "unused",
    launchService: async () => { service = await startUsageRouterService({ stateDir: join(stateDir, "usage-router") }); },
  });
  const values = new Map<string, string>();
  const update = async (account: string, baseUrl: string) => { values.set(account, baseUrl); };
  try {
    const enabled = await manager.enableEnvironmentGateway("work", [
      { envName: "work", accountName: "login", authMode: "auth", baseUrl: "default", apiKey: "auth-token", authAccountId: "chat-account" },
      { envName: "work", accountName: "key", authMode: "apikey", baseUrl: "https://api.example.com/v1", apiKey: "sk-key" },
    ], update);
    assert.equal(enabled.gatewayEnabled, true);
    assert.match(values.get("login") ?? "", /^http:\/\/127\.0\.0\.1:\d+\/gateways\//);
    assert.equal(values.get("login"), values.get("key"));
    assert.equal((await manager.listRoutes()).length, 2);

    const disabled = await manager.disableEnvironmentGateway("work", update);
    assert.equal(disabled.enabled, false);
    assert.equal(values.get("login"), "default");
    assert.equal(values.get("key"), "https://api.example.com/v1");
    assert.deepEqual(await manager.listRoutes(), []);
  } finally {
    await service?.close();
  }
});

test("environment gateway local Agent access toggles independently and persists its credential", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-manager-local-agent-"));
  let service: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;
  const manager = new UsageRouterManager({
    stateDir, serviceEntryPath: "unused",
    launchService: async () => { service = await startUsageRouterService({ stateDir: join(stateDir, "usage-router") }); },
  });
  try {
    await manager.enableEnvironmentGateway("work", [{
      envName: "work", accountName: "login", authMode: "apikey", baseUrl: "https://api.example.com/v1", apiKey: "sk-key",
    }], async () => undefined);
    const enabled = await manager.setEnvironmentLocalAgentAccess("work", true);
    assert.equal(enabled.localAgentAccessEnabled, true);
    assert.match(enabled.localAgentBaseUrl ?? "", /\/v1$/);
    assert.match(enabled.localAgentModelsUrl ?? "", /\/v1\/models$/);
    assert.equal(enabled.localAgentAccessToken?.length, 64);
    const saved = JSON.parse(await readFile(join(stateDir, "usage-router", "compatibility-route-tokens.json"), "utf8")) as { gateways?: Record<string, string> };
    assert.equal(saved.gateways?.[enabled.gatewayId ?? ""], enabled.localAgentAccessToken);

    const disabled = await manager.setEnvironmentLocalAgentAccess("work", false);
    assert.equal(disabled.localAgentAccessEnabled, false);
    assert.equal(disabled.localAgentBaseUrl, undefined);
    const persisted = (await manager.getEnvironmentStatuses(["work"]))[0];
    assert.equal(persisted?.localAgentAccessEnabled, false);
  } finally {
    await service?.close();
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("environment gateway materializes explicit catalog models without intent routing", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-manager-gateway-models-"));
  let service: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;
  const manager = new UsageRouterManager({
    stateDir, serviceEntryPath: "unused",
    launchService: async () => { service = await startUsageRouterService({ stateDir: join(stateDir, "usage-router") }); },
  });
  const values = new Map<string, string>();
  const update = async (account: string, baseUrl: string) => { values.set(account, baseUrl); };
  const accounts = [
    { envName: "work", accountName: "key", authMode: "apikey", baseUrl: "https://api.example.com/v1", apiKey: "sk-key", providerId: "custom" },
  ];
  try {
    await manager.enableEnvironmentGateway("work", accounts, update, {
      group: { id: "group", exposedModelId: "work-model", strategy: "order", sessionPolicy: "off", fallbackEnabled: true },
    }, [{
      providerId: "custom", modelId: "custom/model", upstreamModel: "custom-upstream", exposedModelId: "work-model",
      routeGroupId: "group", accountNames: ["key"], protocols: ["responses"], capabilities: { tools: true },
      requestHeadersByAccount: { key: { "x-provider-scope": "custom" } },
      proxyUrlByAccount: { key: "http://127.0.0.1:7890" },
    }]);
    const firstRoutes = await manager.listRoutes();
    assert.equal(firstRoutes.length, 2);
    const modelRoute = firstRoutes.find((route) => route.exposedModelId === "work-model");
    assert.equal(modelRoute?.upstreamModel, "custom-upstream");
    assert.equal(modelRoute?.providerId, "custom");
    assert.equal(modelRoute?.routeGroupId, "group");
    assert.deepEqual(modelRoute?.requestHeaders, { "x-provider-scope": "custom" });
    assert.equal(modelRoute?.proxyUrl, "http://127.0.0.1:7890");
    assert.equal(values.get("key")?.includes("/gateways/"), true);

    await manager.enableEnvironmentGateway("work", accounts, update, {
      next: { id: "next", exposedModelId: "next-model", strategy: "order", sessionPolicy: "off", fallbackEnabled: true },
    }, [{
      providerId: "custom", modelId: "custom/next", upstreamModel: "custom-next", exposedModelId: "next-model",
      routeGroupId: "next", accountNames: ["key"], protocols: ["responses"],
    }]);
    const secondRoutes = await manager.listRoutes();
    assert.equal(secondRoutes.some((route) => route.exposedModelId === "work-model"), false);
    assert.equal(secondRoutes.some((route) => route.exposedModelId === "next-model"), true);
  } finally {
    await service?.close();
  }
});

test("model request preview uses an isolated gateway route without changing saved routes", async () => {
  let receivedModel = "";
  const upstream = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { model?: string; input?: unknown };
    receivedModel = body.model ?? "";
    assert.deepEqual(body.input, [{ role: "user", content: [{ type: "input_text", text: "你是什么模型" }] }]);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ output_text: "preview ok" }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  assert(address && typeof address !== "string");

  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-manager-preview-"));
  let service: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;
  const manager = new UsageRouterManager({
    stateDir, serviceEntryPath: "unused",
    launchService: async () => { service = await startUsageRouterService({ stateDir: join(stateDir, "usage-router") }); },
  });
  try {
    const account = { envName: "work", accountName: "key", authMode: "apikey" as const, baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "sk-preview", providerId: "custom" };
    await manager.enableEnvironmentGateway("work", [account], async () => undefined, {
      model: { id: "model", exposedModelId: "catalog:model", strategy: "order", sessionPolicy: "off", fallbackEnabled: true },
    }, [{
      providerId: "custom", modelId: "custom/model", upstreamModel: "upstream-model", exposedModelId: "catalog:model",
      routeGroupId: "model", accountNames: ["key"], protocols: ["responses"], capabilities: { streaming: true },
    }]);

    const savedRoutes = await manager.listRoutes();
    const savedGateway = (await manager.listEnvironmentGateways())[0];
    assert(savedGateway);
    const savedRouteIds = savedRoutes.map((route) => route.routeId).sort();
    const modelRoute = savedRoutes.find((route) => route.exposedModelId === "catalog:model");
    assert(modelRoute);
    const preview = await manager.testModelRequestPreview({
      envName: "work", accountName: "key", model: "catalog:model", prompt: "你是什么模型",
      route: { ...modelRoute, routeId: "preview-route-test", createdAt: Date.now(), updatedAt: Date.now() },
      upstreamApiKey: "sk-preview", authMode: "apikey",
    });
    assert.equal(preview.ok, true);
    assert.equal(receivedModel, "upstream-model");
    assert.deepEqual((await manager.listRoutes()).map((route) => route.routeId).sort(), savedRouteIds);
    assert.equal((await manager.listEnvironmentGateways())[0]?.gatewayId, savedGateway.gatewayId);
  } finally {
    await service?.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("model request test rejects a failed or reasoning-only Responses result", async () => {
  let mode: "failed" | "reasoning" = "failed";
  const upstream = createServer(async (_request, response) => {
    response.setHeader("content-type", "application/json");
    if (mode === "failed") {
      response.end(JSON.stringify({ id: "failed", status: "failed", output: [], error: { code: "upstream_invalid_tool_call", message: "invalid tool arguments" } }));
      return;
    }
    response.end(JSON.stringify({ id: "reasoning-only", status: "completed", output: [{ type: "reasoning", summary: [{ type: "summary_text", text: "thinking" }] }] }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  assert(address && typeof address !== "string");
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-manager-test-result-"));
  let service: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;
  const manager = new UsageRouterManager({
    stateDir, serviceEntryPath: "unused",
    launchService: async () => { service = await startUsageRouterService({ stateDir: join(stateDir, "usage-router") }); },
  });
  try {
    const route = {
      routeId: "test-result-route", envName: "work", accountName: "key", upstreamBaseUrl: `http://127.0.0.1:${address.port}/v1`,
      originalBaseUrl: "default", protocol: "responses" as const, upstreamModel: "test-model", reasoningProfile: "auto" as const,
      exposedModelId: "test-model",
      enabled: true, createdAt: Date.now(), updatedAt: Date.now(),
    };
    const failed = await manager.testModelRequestPreview({
      envName: "work", accountName: "key", model: "test-model", route,
      upstreamApiKey: "sk-test", authMode: "apikey",
    });
    assert.equal(failed.ok, false);
    assert.match(failed.message, /invalid tool arguments/);

    mode = "reasoning";
    const reasoningOnly = await manager.testModelRequestPreview({
      envName: "work", accountName: "key", model: "test-model", route,
      upstreamApiKey: "sk-test", authMode: "apikey",
    });
    assert.equal(reasoningOnly.ok, false);
    assert.match(reasoningOnly.message, /without assistant text/);
  } finally {
    await service?.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("gateway model routes use each bound account protocol and default to a model route", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-manager-gateway-protocols-"));
  let service: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;
  const manager = new UsageRouterManager({
    stateDir, serviceEntryPath: "unused",
    launchService: async () => { service = await startUsageRouterService({ stateDir: join(stateDir, "usage-router") }); },
  });
  const update = async () => undefined;
  const accounts = [
    { envName: "work", accountName: "responses", authMode: "apikey", baseUrl: "https://responses.example/v1", apiKey: "sk-responses", providerId: "custom", protocol: "responses" as const },
    { envName: "work", accountName: "chat", authMode: "apikey", baseUrl: "https://chat.example/v1", apiKey: "sk-chat", providerId: "custom", protocol: "chat_completions" as const },
  ];
  try {
    await manager.enableEnvironmentGateway("work", accounts, update, {
      shared: { id: "shared", exposedModelId: "shared-model", strategy: "order", sessionPolicy: "off", fallbackEnabled: true },
    }, [{
      providerId: "custom", modelId: "custom/shared", upstreamModel: "provider-shared", exposedModelId: "shared-model",
      routeGroupId: "shared", accountNames: ["responses", "chat"], protocols: ["responses", "chat_completions"],
      protocolByAccount: { responses: "responses", chat: "chat_completions" },
    }], [], "shared");

    const routes = await manager.listRoutes();
    assert.equal(routes.find((route) => route.accountName === "responses" && route.exposedModelId === "shared-model")?.protocol, "responses");
    assert.equal(routes.find((route) => route.accountName === "chat" && route.exposedModelId === "shared-model")?.protocol, "chat_completions");
    assert.equal(routes.find((route) => route.accountName === "chat" && !route.exposedModelId)?.protocol, "chat_completions");
    const gateway = (await manager.listEnvironmentGateways())[0];
    const defaultRoute = routes.find((route) => route.routeId === gateway?.defaultRouteId);
    assert.equal(defaultRoute?.exposedModelId, "shared-model");
  } finally {
    await service?.close();
  }
});

test("gateway model routes keep the Codex ingress protocol separate from an Anthropic upstream", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-manager-gateway-upstream-protocol-"));
  let service: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;
  const manager = new UsageRouterManager({
    stateDir, serviceEntryPath: "unused",
    launchService: async () => { service = await startUsageRouterService({ stateDir: join(stateDir, "usage-router") }); },
  });
  const update = async () => undefined;
  try {
    await manager.enableEnvironmentGateway("work", [{
      envName: "work", accountName: "claude", authMode: "apikey",
      baseUrl: "https://api.anthropic.com", apiKey: "sk-claude", providerId: "anthropic",
      protocol: "responses",
    }], update, {
      claude: { id: "claude", exposedModelId: "claude-sonnet", strategy: "order", sessionPolicy: "off", fallbackEnabled: true },
    }, [{
      providerId: "anthropic", modelId: "anthropic/claude-sonnet", upstreamModel: "claude-sonnet",
      exposedModelId: "claude-sonnet", routeGroupId: "claude", accountNames: ["claude"],
      protocols: ["anthropic"], protocolByAccount: { claude: "responses" },
      upstreamProtocolByAccount: { claude: "anthropic" },
    }]);
    const route = (await manager.listRoutes()).find((candidate) => candidate.exposedModelId === "claude-sonnet");
    assert.equal(route?.protocol, "anthropic");
  } finally {
    await service?.close();
  }
});

test("environment gateway can sit on top of a credential pool and restore the pool URL", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-manager-gateway-pool-"));
  let service: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;
  const manager = new UsageRouterManager({
    stateDir, serviceEntryPath: "unused",
    launchService: async () => { service = await startUsageRouterService({ stateDir: join(stateDir, "usage-router") }); },
  });
  const values = new Map<string, string>();
  const update = async (account: string, baseUrl: string) => { values.set(account, baseUrl); };
  const accounts = [
    { envName: "work", accountName: "first", authMode: "apikey", baseUrl: "https://one.example/v1", apiKey: "sk-one" },
    { envName: "work", accountName: "second", authMode: "apikey", baseUrl: "https://two.example/v1", apiKey: "sk-two" },
  ];
  try {
    const pool = await manager.enableAccountPool({ envName: "work", protocol: "responses", accountNames: ["first", "second"] }, accounts, update);
    assert.equal(pool.enabled, true);
    const gateway = await manager.enableEnvironmentGateway("work", accounts, update);
    assert.equal(gateway.gatewayEnabled, true);
    const persistedGateway = (await manager.listEnvironmentGateways())[0];
    assert.equal(persistedGateway?.poolId, pool.poolId);
    assert.match(values.get("first") ?? "", /\/gateways\//);
    assert.equal(values.get("first"), values.get("second"));

    const disabled = await manager.disableEnvironmentGateway("work", update);
    assert.equal(disabled.gatewayEnabled, false);
    assert.equal(disabled.poolEnabled, true);
    assert.match(values.get("first") ?? "", /\/pools\//);
    assert.equal(values.get("first"), values.get("second"));
    assert.equal((await manager.listAccountPools())[0]?.poolId, pool.poolId);
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
      { envName: "work", accountName: "existing", authMode: "apikey", baseUrl: "https://api.changed.example/v1" },
      { envName: "work", accountName: "new-key", authMode: "apikey", baseUrl: "https://api.new.example/v1" },
      { envName: "work", accountName: "new-auth", authMode: "auth", baseUrl: "" },
    ], update);

    assert.equal(synced?.routedAccounts, 3);
    const routes = await manager.listRoutes();
    assert.equal(routes.find((route) => route.accountName === "existing")?.originalBaseUrl, "https://api.changed.example/v1");
    assert.equal(routes.some((route) => route.upstreamBaseUrl === "https://api.example.com/v1"), false);
    assert.match(values.get("new-key") ?? "", /^http:\/\/127\.0\.0\.1:\d+\/routes\//);
    assert.equal(values.has("new-auth"), true);
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
  let runtime: { baseUrl: string; localRouteToken: string } | undefined;
  let restored = "";
  try {
    const enabled = await manager.enableAccountCompatibility({ envName: "work", accountName: "chat", authMode: "apikey",
      baseUrl: "https://api.example.com/v1", apiKey: "sk-upstream", providerId: "qwen", upstreamModel: "provider-model",
      longConversationStrategy: "continuity", instructionRole: "developer" },
    async (value) => { runtime = value; });
    assert.equal(enabled.state, "ready");
    assert.match(runtime?.baseUrl ?? "", /^http:\/\/127\.0\.0\.1:\d+\/routes\//);
    assert(runtime?.localRouteToken);
    assert.equal((await manager.getAccountCompatibilityStatuses(["work/chat"]))[0]?.state, "ready");
    assert.equal((await manager.listRoutes())[0]?.longConversationStrategy, "continuity");
    assert.equal((await manager.listRoutes())[0]?.instructionRole, "developer");
    assert.equal((await manager.listRoutes())[0]?.providerId, "qwen");

    const tokenFile = await import("node:fs/promises").then(({ readFile }) => readFile(join(stateDir, "usage-router", "compatibility-route-tokens.json"), "utf8"));
    assert.equal(tokenFile.includes("sk-upstream"), false);
    assert.equal(tokenFile.includes(runtime?.localRouteToken ?? "missing"), true);

    const disabled = await manager.disableAccountCompatibility("work", "chat", async (value) => { restored = value; });
    assert.equal(disabled.state, "disabled");
    assert.equal(restored, "https://api.example.com/v1");
  } finally { await service?.close(); }
});

test("account pool rewrites selected accounts, persists no upstream secrets, and restores exact URLs", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-account-pool-manager-"));
  let service: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;
  const manager = new UsageRouterManager({ stateDir, serviceEntryPath: "unused",
    launchService: async () => { service = await startUsageRouterService({ stateDir: join(stateDir, "usage-router") }); } });
  const values = new Map<string, string>();
  const update = async (accountName: string, baseUrl: string) => { values.set(accountName, baseUrl); };
  try {
    const enabled = await manager.enableAccountPool({ envName: "work", protocol: "responses",
      accountNames: ["a", "b"], weights: { a: 2, b: 1 }, sessionTtlMinutes: 30, maxFailoverAttempts: 1 }, [
      { envName: "work", accountName: "a", authMode: "apikey", protocol: "responses", baseUrl: "https://a.example/v1", apiKey: "sk-a" },
      { envName: "work", accountName: "b", authMode: "apikey", protocol: "responses", baseUrl: "https://b.example/v1/", apiKey: "sk-b" },
    ], update);
    assert.equal(enabled.members.length, 2);
    assert.equal(enabled.readyMembers, 2);
    assert.match(values.get("a") ?? "", /^http:\/\/127\.0\.0\.1:\d+\/pools\//);
    assert.equal(values.get("a"), values.get("b"));
    const tokenFile = await import("node:fs/promises").then(({ readFile }) => readFile(join(stateDir, "usage-router", "compatibility-route-tokens.json"), "utf8"));
    assert.equal(tokenFile.includes("sk-a"), false);
    assert.equal(tokenFile.includes("sk-b"), false);
    assert.equal((await manager.listPersistedAccountPools())[0]?.members[0]?.originalBaseUrl, "https://a.example/v1");

    assert.equal(await manager.stopService(), true);
    assert.equal((await manager.listPersistedAccountPools()).length, 1);
    const restored = await manager.enableAccountPool({ envName: "work", protocol: "responses",
      accountNames: ["a", "b"], weights: { a: 2, b: 1 }, sessionTtlMinutes: 30, maxFailoverAttempts: 1 }, [
      { envName: "work", accountName: "a", authMode: "apikey", protocol: "responses", baseUrl: "https://a.example/v1", apiKey: "sk-a" },
      { envName: "work", accountName: "b", authMode: "apikey", protocol: "responses", baseUrl: "https://b.example/v1/", apiKey: "sk-b" },
    ], update);
    assert.equal(restored.readyMembers, 2);

    await manager.disableAccountPool("work", update);
    assert.equal(values.get("a"), "https://a.example/v1");
    assert.equal(values.get("b"), "https://b.example/v1/");
    assert.deepEqual(await manager.listPersistedAccountPools(), []);
  } finally { await service?.close(); }
});

test("Responses account pool accepts mixed AUTH and API-key members without persisting bearer credentials", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-mixed-auth-pool-manager-"));
  let service: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;
  const manager = new UsageRouterManager({ stateDir, serviceEntryPath: "unused",
    launchService: async () => { service = await startUsageRouterService({ stateDir: join(stateDir, "usage-router") }); } });
  const values = new Map<string, string>();
  try {
    const enabled = await manager.enableAccountPool({ envName: "work", protocol: "responses",
      accountNames: ["login", "key"] }, [
      { envName: "work", accountName: "login", authMode: "auth", protocol: "responses", baseUrl: "default",
        apiKey: "auth-access-token", authAccountId: "account-login" },
      { envName: "work", accountName: "key", authMode: "apikey", protocol: "responses", baseUrl: "default", apiKey: "sk-key" },
    ], async (accountName, baseUrl) => { values.set(accountName, baseUrl); });
    assert.equal(enabled.members[0]?.upstreamBaseUrl, "https://chatgpt.com/backend-api/codex");
    assert.equal(enabled.members[1]?.upstreamBaseUrl, "https://api.openai.com/v1");
    assert.equal(values.get("login"), values.get("key"));
    const tokenFile = await import("node:fs/promises").then(({ readFile }) => readFile(join(stateDir, "usage-router", "compatibility-route-tokens.json"), "utf8"));
    assert.equal(tokenFile.includes("auth-access-token"), false);
    assert.equal(tokenFile.includes("sk-key"), false);
    await assert.rejects(manager.enableAccountPool({ envName: "work", protocol: "chat_completions",
      accountNames: ["login"] }, [
      { envName: "work", accountName: "login", authMode: "auth", protocol: "chat_completions", baseUrl: "default", apiKey: "auth-access-token" },
    ], async () => undefined), /require API-key accounts/);
  } finally { await service?.close(); }
});
