import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { __internal } from "./node-cli.js";
import { getPlatformRuntime } from "../packages/core/src/platform/runtime.js";
import { readLegacyGatewayV2, readLegacyState, writeLegacyAuthData, writeLegacyGateway, writeLegacyGatewayV2, writeLegacyRuntime } from "../packages/core/src/state/legacy.js";
import { migrateGatewayEnvironmentStateToV2 } from "../packages/core/src/gateway/v2.js";
import { createUsageStore } from "../apps/desktop/electron/usage-store.js";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

function getRunProxyConnectivityTest() {
  const candidate = (__internal as Record<string, unknown>).runProxyConnectivityTest;
  assert.equal(typeof candidate, "function");
  return candidate as (input: {
    stateDir: string;
    envsDir: string;
    defaultHome: string;
    env?: NodeJS.ProcessEnv;
    usageEndpoint?: string;
    request?: (input: {
      url: string;
      accessToken: string;
      proxy: string;
    }) => Promise<{ statusCode: number; bodyPreview: string }>;
  }) => Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}

async function withUsageApiServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{
  endpoint: string;
  close: () => Promise<void>;
}> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    endpoint: `http://127.0.0.1:${address.port}/backend-api/wham/usage`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

test("node-cli prints version without invoking bash", async () => {
  const result = await execFileAsync(
    "npx",
    ["--yes", "tsx", "scripts/node-cli.ts", "version"],
    { cwd: repoRoot },
  );

  assert.match(result.stdout, /^\d+\.\d+\.\d+\n$/);
});

test("node-cli reports the normalized platform name", async () => {
  const result = await execFileAsync(
    "npx",
    ["--yes", "tsx", "scripts/node-cli.ts", "platform"],
    { cwd: repoRoot },
  );

  assert.match(result.stdout, /^(macos|linux|windows|unknown)\n$/);
});

test("node-cli delegates whoami to the TypeScript core path", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "personal"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "personal\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "personal\n", "utf8");

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "whoami"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          CODEX_SWITCHER_STATE_DIR: stateDir,
          CODEX_SWITCHER_ENVS_DIR: envsDir,
          CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
        },
      },
    );

    assert.match(result.stdout, /cli: default\/personal/);
    assert.match(result.stdout, /app: default\/personal/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli exposes provider, route-group, agent, profile, and gateway lifecycle commands without leaking secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-gateway-cli-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const previous = {
    state: process.env.CODEX_SWITCHER_STATE_DIR,
    envs: process.env.CODEX_SWITCHER_ENVS_DIR,
    home: process.env.CODEX_SWITCHER_DEFAULT_HOME,
  };
  process.env.CODEX_SWITCHER_STATE_DIR = stateDir;
  process.env.CODEX_SWITCHER_ENVS_DIR = envsDir;
  process.env.CODEX_SWITCHER_DEFAULT_HOME = defaultHome;
  try {
    await mkdir(defaultHome, { recursive: true });
    const writes: string[] = [];
    const stdout = { write(value: string) { writes.push(value); return true; } };
    await __internal.runNodeGatewayDomainCommand("provider", ["add", "openai", "--proxy-url", "http://127.0.0.1:7890", "--env", "default"], { stdout });
    await __internal.runNodeGatewayDomainCommand("provider", ["login", "openai", "primary", "--secret-ref", "secure/ref", "--proxy-url", "http://127.0.0.1:7891", "--env", "default"], { stdout });
    await __internal.runNodeGatewayDomainCommand("group", ["add", "coding", "coding-model", "--provider", "openai", "--model", "gpt-5", "--credential", "primary", "--env", "default"], { stdout });
    await __internal.runNodeGatewayDomainCommand("group", ["rule", "add", "coding", "tools", "--env", "default"], { stdout });
    await __internal.runNodeGatewayDomainCommand("profile", ["save", "work", "--env", "default"], { stdout });
    const savedProfile = JSON.parse(await readFile(join(stateDir, "profiles", "work.json"), "utf8")) as { schemaVersion?: number; routeGroups?: unknown };
    assert.equal(savedProfile.schemaVersion, 1);
    assert.ok(savedProfile.routeGroups);
    await writeFile(join(stateDir, "profiles", "invalid.json"), "{}\n", "utf8");
    await assert.rejects(
      __internal.runNodeGatewayDomainCommand("profile", ["use", "invalid", "--env", "default"], { stdout }),
      /invalid Gateway configuration/,
    );
    await __internal.runNodeGatewayDomainCommand("agent", ["connect", "claude", "--model", "coding-model", "--env", "default"], { stdout });
    const listing: string[] = [];
    await __internal.runNodeGatewayDomainCommand("model", ["ls", "--env", "default"], { stdout: { write(value: string) { listing.push(value); return true; } } });
    assert.match(listing.join(""), /coding-model/);
    assert.match(writes.join(""), /provider added: openai/);
    assert.match(writes.join(""), /credential added: primary/);
    assert.match(writes.join(""), /agent connected: claude/);
    assert.doesNotMatch(writes.join(""), /secure\/ref/);
    const state = await readLegacyState({ stateDir, envsDir, defaultHome });
    assert.equal(state.envs.default?.gateway?.providers.openai?.proxyUrl, "http://127.0.0.1:7890");
    assert.equal(state.envs.default?.gateway?.credentials.primary?.proxyUrl, "http://127.0.0.1:7891");
    await __internal.runNodeGatewayCommand(["mode", "manual", "--env", "default"], { stdout });
    await __internal.runNodeGatewayCommand(["status", "--env", "default"], { stdout });
    assert.match(writes.join(""), /gateway_mode: manual/);
    assert.match(writes.join(""), /gateway_process: stopped/);
    await __internal.runNodeGatewayDomainCommand("agent", ["disconnect", "claude", "--env", "default"], { stdout });
  } finally {
    if (previous.state === undefined) delete process.env.CODEX_SWITCHER_STATE_DIR; else process.env.CODEX_SWITCHER_STATE_DIR = previous.state;
    if (previous.envs === undefined) delete process.env.CODEX_SWITCHER_ENVS_DIR; else process.env.CODEX_SWITCHER_ENVS_DIR = previous.envs;
    if (previous.home === undefined) delete process.env.CODEX_SWITCHER_DEFAULT_HOME; else process.env.CODEX_SWITCHER_DEFAULT_HOME = previous.home;
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli covers the complete explicit Gateway domain command contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-gateway-domain-contract-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const previous = {
    state: process.env.CODEX_SWITCHER_STATE_DIR,
    envs: process.env.CODEX_SWITCHER_ENVS_DIR,
    home: process.env.CODEX_SWITCHER_DEFAULT_HOME,
  };
  process.env.CODEX_SWITCHER_STATE_DIR = stateDir;
  process.env.CODEX_SWITCHER_ENVS_DIR = envsDir;
  process.env.CODEX_SWITCHER_DEFAULT_HOME = defaultHome;

  try {
    await mkdir(defaultHome, { recursive: true });
    await mkdir(join(defaultHome, ".codex"), { recursive: true });
    await writeFile(join(defaultHome, ".codex", "config.toml"), 'model = "gpt-5"\nmodel_reasoning_effort = "high"\nopenai_base_url = "https://import.example/v1/"\nOPENAI_API_KEY = "sk-never-import"\n', "utf8");
    const runDomain = async (command: "provider" | "agent" | "group" | "model" | "usage" | "profile", args: string[]) => {
      const writes: string[] = [];
      const code = await __internal.runNodeGatewayDomainCommand(command, [...args, "--env", "default"], {
        stdout: { write(value: string) { writes.push(value); return true; } },
      });
      assert.equal(code, 0, `${command} ${args.join(" ")} should succeed`);
      return writes.join("");
    };

    const importedPreview = await runDomain("agent", ["import", "codex", "--dry-run"]);
    assert.match(importedPreview, /"model":"gpt-5"/);
    assert.match(importedPreview, /"reasoningProfile":"high"/);
    assert.match(importedPreview, /https:\/\/import\.example\/v1/);
    assert.doesNotMatch(importedPreview, /sk-never-import/);
    assert.match(await runDomain("agent", ["import", "codex"]), /agent imported: codex -> gpt-5/);

    assert.match(await runDomain("provider", ["add", "openai"]), /provider added: openai/);
    assert.match(await runDomain("provider", ["login", "openai", "--begin"]), /authorizationUrl/);
    assert.match(await runDomain("provider", ["login", "openai", "primary", "--secret-ref", "secure\/ref"]), /credential added: primary/);
    assert.match(await runDomain("provider", ["ls"]), /openai/);
    assert.match(await runDomain("provider", ["models", "openai"]), /openai:gpt-5/);
    assert.match(await runDomain("provider", ["quota", "openai"]), /windowMinutes/);
    assert.match(await runDomain("provider", ["refresh", "openai"]), /credentials refreshed: 1/);

    await runDomain("group", ["add", "coding", "coding-model", "--provider", "openai", "--model", "gpt-5", "--credential", "primary"]);
    await runDomain("group", ["set", "coding", "--strategy", "weight", "--session", "session", "--fallback", "off"]);
    await runDomain("group", ["rule", "add", "coding", "vision"]);
    await runDomain("group", ["rule", "rm", "coding", "vision"]);
    assert.match(await runDomain("group", ["ls"]), /coding\tcoding-model\tweight/);

    const state = await readLegacyState({ stateDir, envsDir, defaultHome });
    const gateway = state.envs.default?.gateway;
    const importedBinding = await readLegacyGatewayV2({ stateDir, envName: "default" });
    assert.equal(importedBinding?.agentBindings.codex?.reasoningProfile, "high");
    assert.ok(gateway);
    gateway.models["openai/gpt-5"] = {
      id: "openai/gpt-5",
      providerId: "openai",
      upstreamModelId: "gpt-5",
      displayName: "GPT-5",
      protocols: ["responses", "chat_completions"],
      capabilities: { streaming: true, tools: true },
      enabled: true,
    };
    await writeLegacyGateway({ stateDir, envName: "default", gateway });
    assert.match(await runDomain("model", ["ls"]), /openai\/gpt-5/);
    assert.match(await runDomain("model", ["inspect", "gpt-5"]), /"upstreamModelId": "gpt-5"/);

    assert.match(await runDomain("agent", ["ls"]), /claude/);
    assert.match(await runDomain("agent", ["connect", "claude", "--model", "coding-model"]), /agent connected: claude/);
    assert.match(await runDomain("agent", ["doctor", "claude"]), /state: clean/);
    assert.match(await runDomain("agent", ["use", "claude", "coding-model"]), /agent default model: claude/);
    assert.match(await runDomain("agent", ["default", "claude", "--model", "coding-model"]), /agent default model: claude/);

    for (const window of ["today", "7d", "30d", "all"]) {
      const summary = JSON.parse(await runDomain("usage", [window])) as { window?: string };
      assert.equal(summary.window, window);
    }

    assert.match(await runDomain("profile", ["save", "contract"]), /profile saved: contract/);
    assert.match(await runDomain("profile", ["ls"]), /contract/);
    assert.match(await runDomain("profile", ["use", "contract"]), /profile applied: contract/);
    assert.match(await runDomain("profile", ["rm", "contract"]), /profile removed: contract/);

    const gatewayWrites: string[] = [];
    await __internal.runNodeGatewayCommand(["routes", "--env", "default"], { stdout: { write(value: string) { gatewayWrites.push(value); return true; } } });
    assert.match(gatewayWrites.join(""), /coding-model/);
    await __internal.runNodeGatewayCommand(["mode", "gateway", "--env", "default"], { stdout: { write(value: string) { gatewayWrites.push(value); return true; } } });
    assert.match(gatewayWrites.join(""), /gateway mode: routing/);
    await __internal.runNodeGatewayCommand(["mode", "manual", "--env", "default"], { stdout: { write(value: string) { gatewayWrites.push(value); return true; } } });
    assert.match(gatewayWrites.join(""), /gateway mode: manual/);

    assert.match(await runDomain("agent", ["disconnect", "claude"]), /agent disconnected: claude/);
    assert.match(await runDomain("group", ["rm", "coding"]), /group removed: coding/);
    assert.match(await runDomain("provider", ["logout", "openai", "primary"]), /credential removed: primary/);
  } finally {
    if (previous.state === undefined) delete process.env.CODEX_SWITCHER_STATE_DIR; else process.env.CODEX_SWITCHER_STATE_DIR = previous.state;
    if (previous.envs === undefined) delete process.env.CODEX_SWITCHER_ENVS_DIR; else process.env.CODEX_SWITCHER_ENVS_DIR = previous.envs;
    if (previous.home === undefined) delete process.env.CODEX_SWITCHER_DEFAULT_HOME; else process.env.CODEX_SWITCHER_DEFAULT_HOME = previous.home;
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli usage reads the persistent router ledger before the legacy JSON fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-gateway-usage-cli-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const previous = {
    state: process.env.CODEX_SWITCHER_STATE_DIR,
    envs: process.env.CODEX_SWITCHER_ENVS_DIR,
    home: process.env.CODEX_SWITCHER_DEFAULT_HOME,
  };
  process.env.CODEX_SWITCHER_STATE_DIR = stateDir;
  process.env.CODEX_SWITCHER_ENVS_DIR = envsDir;
  process.env.CODEX_SWITCHER_DEFAULT_HOME = defaultHome;
  try {
    await mkdir(defaultHome, { recursive: true });
    const store = await createUsageStore(join(stateDir, "usage-router", "usage.db"));
    await store.recordUsage({
      requestId: "cli-usage-request", routeId: "route-a", startedAt: 1_000, completedAt: 2_000,
      envName: "default", accountName: "primary", upstreamBaseUrl: "https://api.example.com/v1",
      endpoint: "/responses", model: "gpt-5", inputTokens: 10, outputTokens: 5,
      cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 15, httpStatus: 200,
      latencyMs: 1_000, actualCost: 0.25, standardCost: 0.3,
    });
    await store.close();
    const writes: string[] = [];
    await __internal.runNodeGatewayDomainCommand("usage", ["all", "--env", "default"], { stdout: { write(value: string) { writes.push(value); return true; } } });
    const summary = JSON.parse(writes.join("")) as { requests: number; inputTokens: number; outputTokens: number; cost: number };
    assert.equal(summary.requests, 1);
    assert.equal(summary.inputTokens, 10);
    assert.equal(summary.outputTokens, 5);
    assert.equal(summary.cost, 0.25);
  } finally {
    if (previous.state === undefined) delete process.env.CODEX_SWITCHER_STATE_DIR; else process.env.CODEX_SWITCHER_STATE_DIR = previous.state;
    if (previous.envs === undefined) delete process.env.CODEX_SWITCHER_ENVS_DIR; else process.env.CODEX_SWITCHER_ENVS_DIR = previous.envs;
    if (previous.home === undefined) delete process.env.CODEX_SWITCHER_DEFAULT_HOME; else process.env.CODEX_SWITCHER_DEFAULT_HOME = previous.home;
    await rm(root, { recursive: true, force: true });
  }
});

test("provider models --discover uses the existing credential reference and returns only model metadata", async () => {
  const environment = {
    name: "default",
    path: "/tmp/codex-default",
    accounts: {
      primary: {
        name: "primary",
        authMode: "apikey" as const,
        authData: { OPENAI_API_KEY: "secret-not-output" },
        runtime: { preferredAuthMethod: "apikey" as const, openaiBaseUrlMode: "default" as const },
      },
    },
    gateway: {
      schemaVersion: 1 as const,
      mode: "gateway" as const,
      gatewayId: "gateway-default",
      providers: { openai: { id: "openai", displayName: "OpenAI", kind: "openai" as const, endpoints: { responses: "https://api.openai.com/v1" }, modelDiscovery: "models_endpoint" as const, enabled: true } },
      credentials: { primary: { id: "primary", providerId: "openai", displayName: "primary", kind: "api_key" as const, secretRef: "account:default:primary", supportedProtocols: ["responses" as const], status: "active" as const } },
      models: {}, routeGroups: {}, catalogVersion: 0,
    },
  };
  const result = await __internal.discoverGatewayProviderModels({
    environment: environment as never,
    envName: "default",
    gateway: environment.gateway,
    providerId: "openai",
    fetchImpl: async (_url, init) => {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret-not-output");
      return new Response(JSON.stringify({ data: [{ id: "gpt-discovered" }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(result.credentialsUsed, 1);
  assert.ok(result.models.some((model) => model.id === "openai/gpt-discovered"));
  assert.doesNotMatch(JSON.stringify(result), /secret-not-output/);
});

test("provider lifecycle stores protected credentials and exercises live refresh, quota, and revoke", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-provider-lifecycle-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const previous = {
    state: process.env.CODEX_SWITCHER_STATE_DIR,
    envs: process.env.CODEX_SWITCHER_ENVS_DIR,
    home: process.env.CODEX_SWITCHER_DEFAULT_HOME,
    secret: process.env.CODEX_TEST_PROVIDER_SECRET,
  };
  process.env.CODEX_SWITCHER_STATE_DIR = stateDir;
  process.env.CODEX_SWITCHER_ENVS_DIR = envsDir;
  process.env.CODEX_SWITCHER_DEFAULT_HOME = defaultHome;
  process.env.CODEX_TEST_PROVIDER_SECRET = "access-from-protected-env";
  try {
    await mkdir(defaultHome, { recursive: true });
    await writeLegacyRuntime({
      stateDir,
      envName: "default",
      accountName: "primary",
      runtime: { preferredAuthMethod: "chatgpt", openaiBaseUrlMode: "default" },
    });
    await writeLegacyAuthData({
      stateDir,
      envName: "default",
      accountName: "primary",
      authData: { tokens: { access_token: "old-access", refresh_token: "old-refresh" } },
    });

    const writes: string[] = [];
    const stdout = { write(value: string) { writes.push(value); return true; } };
    await __internal.runNodeGatewayDomainCommand("provider", ["add", "gemini", "--env", "default"], { stdout });
    await __internal.runNodeGatewayDomainCommand(
      "provider",
      ["login", "gemini", "primary", "--account", "primary", "--kind", "oauth", "--secret-env", "CODEX_TEST_PROVIDER_SECRET", "--env", "default"],
      { stdout },
    );

    const gatewayPath = join(stateDir, "env-gateways", "default.json");
    const authPath = join(stateDir, "env-accounts", "default", "primary", "auth.json");
    const gatewayAfterLogin = JSON.parse(await readFile(gatewayPath, "utf8")) as { credentials: Record<string, { secretRef: string; kind: string }> };
    assert.equal(gatewayAfterLogin.credentials.primary?.kind, "oauth");
    assert.equal(gatewayAfterLogin.credentials.primary?.secretRef, "account:default:primary");
    assert.equal(JSON.parse(await readFile(authPath, "utf8")).tokens.access_token, "access-from-protected-env");
    assert.doesNotMatch(writes.join(""), /access-from-protected-env/);

    const quotaCalls: Array<{ url: string; method: string; key: string | null }> = [];
    await __internal.runNodeGatewayDomainCommand("provider", ["quota", "gemini", "--live", "--env", "default"], {
      stdout,
      fetch: async (url, init) => {
        quotaCalls.push({ url, method: init?.method ?? "GET", key: new Headers(init?.headers).get("x-goog-api-key") });
        return new Response(JSON.stringify({ requests_remaining: 7, reset_at: 123, plan: "test" }), { status: 200 });
      },
    });
    assert.equal(quotaCalls.length, 1);
    assert.equal(quotaCalls[0]?.method, "GET");
    assert.equal(quotaCalls[0]?.key, "access-from-protected-env");
    assert.match(writes.at(-1) ?? "", /requestsRemaining/);

    const refreshCalls: Array<{ url: string; body: string }> = [];
    await __internal.runNodeGatewayDomainCommand("provider", ["refresh", "gemini", "--live", "--env", "default"], {
      stdout,
      fetch: async (url, init) => {
        refreshCalls.push({ url, body: String(init?.body ?? "") });
        return new Response(JSON.stringify({ access_token: "refreshed-access", refresh_token: "refreshed-refresh", expires_in: 3600 }), { status: 200 });
      },
    });
    assert.equal(refreshCalls.length, 1);
    assert.match(refreshCalls[0]?.url ?? "", /oauth\/token$/);
    assert.match(refreshCalls[0]?.body ?? "", /refresh_token=old-refresh/);
    const refreshedAuth = JSON.parse(await readFile(authPath, "utf8")) as { tokens: { access_token: string; refresh_token: string } };
    assert.equal(refreshedAuth.tokens.access_token, "refreshed-access");
    assert.equal(refreshedAuth.tokens.refresh_token, "refreshed-refresh");

    const revokeCalls: Array<{ url: string; body: string; key: string | null }> = [];
    await __internal.runNodeGatewayDomainCommand("provider", ["logout", "gemini", "primary", "--live", "--env", "default"], {
      stdout,
      fetch: async (url, init) => {
        revokeCalls.push({ url, body: String(init?.body ?? ""), key: new Headers(init?.headers).get("x-goog-api-key") });
        return new Response("{}", { status: 200 });
      },
    });
    assert.equal(revokeCalls.length, 1);
    assert.match(revokeCalls[0]?.url ?? "", /oauth\/revoke$/);
    assert.match(revokeCalls[0]?.body ?? "", /token=refreshed-access/);
    assert.equal(revokeCalls[0]?.key, "refreshed-access");
    const gatewayAfterLogout = JSON.parse(await readFile(gatewayPath, "utf8")) as { credentials: Record<string, unknown> };
    assert.equal(gatewayAfterLogout.credentials.primary, undefined);
  } finally {
    if (previous.state === undefined) delete process.env.CODEX_SWITCHER_STATE_DIR; else process.env.CODEX_SWITCHER_STATE_DIR = previous.state;
    if (previous.envs === undefined) delete process.env.CODEX_SWITCHER_ENVS_DIR; else process.env.CODEX_SWITCHER_ENVS_DIR = previous.envs;
    if (previous.home === undefined) delete process.env.CODEX_SWITCHER_DEFAULT_HOME; else process.env.CODEX_SWITCHER_DEFAULT_HOME = previous.home;
    if (previous.secret === undefined) delete process.env.CODEX_TEST_PROVIDER_SECRET; else process.env.CODEX_TEST_PROVIDER_SECRET = previous.secret;
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli imports external gateway metadata with a dry-run preview and a recoverable write", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-external-gateway-import-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const sourcePath = join(root, "providers.json");
  const previous = { state: process.env.CODEX_SWITCHER_STATE_DIR, envs: process.env.CODEX_SWITCHER_ENVS_DIR, home: process.env.CODEX_SWITCHER_DEFAULT_HOME };
  process.env.CODEX_SWITCHER_STATE_DIR = stateDir;
  process.env.CODEX_SWITCHER_ENVS_DIR = envsDir;
  process.env.CODEX_SWITCHER_DEFAULT_HOME = defaultHome;
  try {
    await mkdir(defaultHome, { recursive: true });
    await writeFile(sourcePath, JSON.stringify({ providers: [{ id: "relay", name: "Relay", responses: "https://relay.example/v1", key: "sk-never-persist", models: ["gpt-5"] }], groups: [{ id: "coding", members: ["relay/gpt-5"], routing: "rotate" }], agents: [{ id: "codex", model: "group/coding" }] }), "utf8");
    const writes: string[] = [];
    const stdout = { write(value: string) { writes.push(value); return true; } };
    await __internal.runNodeGatewayCommand(["import", sourcePath, "--dry-run", "--env", "default"], { stdout });
    assert.match(writes.join(""), /\"sourceFormat\":\"provider_gateway\"/);
    assert.match(writes.join(""), /\"agents\":1/);
    await __internal.runNodeGatewayCommand(["import", sourcePath, "--env", "default"], { stdout });
    const gateway = JSON.parse(await readFile(join(stateDir, "env-gateways", "default.json"), "utf8")) as { mode: string; routeGroups: Record<string, unknown> };
    assert.equal(gateway.mode, "direct");
    assert.ok(gateway.routeGroups.coding);
    assert.doesNotMatch(await readFile(join(stateDir, "env-gateways", "default.json"), "utf8"), /sk-never-persist/);
  } finally {
    if (previous.state === undefined) delete process.env.CODEX_SWITCHER_STATE_DIR; else process.env.CODEX_SWITCHER_STATE_DIR = previous.state;
    if (previous.envs === undefined) delete process.env.CODEX_SWITCHER_ENVS_DIR; else process.env.CODEX_SWITCHER_ENVS_DIR = previous.envs;
    if (previous.home === undefined) delete process.env.CODEX_SWITCHER_DEFAULT_HOME; else process.env.CODEX_SWITCHER_DEFAULT_HOME = previous.home;
    await rm(root, { recursive: true, force: true });
  }
});

test("gateway import clears stale v2 agent bindings when the new source has none", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-gateway-import-v2-cleanup-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const sourcePath = join(root, "gateway.json");
  const previous = { state: process.env.CODEX_SWITCHER_STATE_DIR, envs: process.env.CODEX_SWITCHER_ENVS_DIR, home: process.env.CODEX_SWITCHER_DEFAULT_HOME };
  process.env.CODEX_SWITCHER_STATE_DIR = stateDir;
  process.env.CODEX_SWITCHER_ENVS_DIR = envsDir;
  process.env.CODEX_SWITCHER_DEFAULT_HOME = defaultHome;
  try {
    await mkdir(defaultHome, { recursive: true });
    const gateway = {
      schemaVersion: 1 as const, mode: "direct" as const, gatewayId: "gateway-default",
      providers: {}, credentials: {}, models: {}, routeGroups: {}, catalogVersion: 1,
    };
    const persisted = migrateGatewayEnvironmentStateToV2(gateway, "default");
    await writeLegacyGatewayV2({
      stateDir,
      envName: "default",
      gateway: { ...persisted, agentBindings: { claude: { agentId: "claude", displayName: "Claude Code", gatewayId: gateway.gatewayId, defaultModelId: "gpt-5", originalConfigRef: "snapshot/claude", enabled: true } } },
    });
    await writeFile(sourcePath, JSON.stringify({ providers: [], models: [], groups: [] }), "utf8");
    await __internal.runNodeGatewayCommand(["import", sourcePath, "--env", "default"], { stdout: { write() { return true; } } });
    const restored = await readLegacyGatewayV2({ stateDir, envName: "default" });
    assert.deepEqual(restored?.agentBindings ?? {}, {});
  } finally {
    if (previous.state === undefined) delete process.env.CODEX_SWITCHER_STATE_DIR; else process.env.CODEX_SWITCHER_STATE_DIR = previous.state;
    if (previous.envs === undefined) delete process.env.CODEX_SWITCHER_ENVS_DIR; else process.env.CODEX_SWITCHER_ENVS_DIR = previous.envs;
    if (previous.home === undefined) delete process.env.CODEX_SWITCHER_DEFAULT_HOME; else process.env.CODEX_SWITCHER_DEFAULT_HOME = previous.home;
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli gateway start configures the real local router and stop restores manual URLs", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-gateway-cli-runtime-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const accountDir = join(stateDir, "env-accounts", "default", "primary");
  const previous = {
    state: process.env.CODEX_SWITCHER_STATE_DIR,
    envs: process.env.CODEX_SWITCHER_ENVS_DIR,
    home: process.env.CODEX_SWITCHER_DEFAULT_HOME,
  };
  process.env.CODEX_SWITCHER_STATE_DIR = stateDir;
  process.env.CODEX_SWITCHER_ENVS_DIR = envsDir;
  process.env.CODEX_SWITCHER_DEFAULT_HOME = defaultHome;
  try {
    await mkdir(accountDir, { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "primary\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "primary\n", "utf8");
    await writeFile(join(accountDir, "runtime.json"), JSON.stringify({
      preferred_auth_method: "apikey",
      openai_base_url_mode: "default",
      provider_id: "openai",
      compatibility_upstream_model: "gpt-5",
    }), "utf8");
    await writeFile(join(accountDir, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "sk-runtime-test" }), "utf8");
    await writeLegacyGateway({
      stateDir,
      envName: "default",
      gateway: {
        schemaVersion: 1,
        mode: "direct",
        gatewayId: "gateway-default",
        providers: { openai: { id: "openai", displayName: "OpenAI", kind: "openai", endpoints: { responses: "https://api.openai.com/v1" }, modelDiscovery: "manual", enabled: true } },
        credentials: { "credential:default:primary": { id: "credential:default:primary", providerId: "openai", displayName: "primary", kind: "api_key", secretRef: "account:default:primary", supportedProtocols: ["responses"], status: "active" } },
        models: {
          "openai/gpt-5": { id: "openai/gpt-5", providerId: "openai", upstreamModelId: "gpt-5", displayName: "gpt-5", protocols: ["responses"], capabilities: {}, enabled: true },
          "openai/gpt-vision": { id: "openai/gpt-vision", providerId: "openai", upstreamModelId: "gpt-vision", displayName: "gpt-vision", protocols: ["responses"], capabilities: { vision: true }, enabled: true },
        },
        routeGroups: {
          coding: { id: "coding", displayName: "Coding", exposedModelId: "coding", members: [{ providerId: "openai", modelId: "openai/gpt-5", credentialSelector: { credentialIds: ["credential:default:primary"] }, priority: 0, weight: 1 }], strategy: "order", sessionPolicy: "off", fallbackEnabled: true },
          vision: { id: "vision", displayName: "Vision", exposedModelId: "vision", members: [{ providerId: "openai", modelId: "openai/gpt-vision", credentialSelector: { credentialIds: ["credential:default:primary"] }, priority: 0, weight: 1 }], strategy: "order", sessionPolicy: "off", fallbackEnabled: true, capabilities: { vision: true } },
        },
        routeRules: [{ id: "images-to-vision", targetModelId: "vision", priority: 0, enabled: true, match: { hasImages: true } }],
        catalogVersion: 1,
      },
    });
    const writes: string[] = [];
    const stdout = { write(value: string) { writes.push(value); return true; } };

    await __internal.runNodeGatewayCommand(["start", "--env", "default"], { stdout });
    assert.match(writes.join(""), /gateway started: default/);
    const marker = JSON.parse(await readFile(join(stateDir, "gateway", "default.json"), "utf8")) as { pid?: number; port?: number };
    assert.deepEqual(await readdir(join(stateDir, "gateway")), ["default.json"]);
    assert.equal(typeof marker.pid, "number");
    assert.equal(typeof marker.port, "number");
    assert.ok((marker.port ?? 0) > 0);
    const manager = new (await import("../apps/desktop/electron/usage-router-manager.js")).UsageRouterManager({
      stateDir,
      serviceEntryPath: join(process.cwd(), "apps", "desktop", "electron-dist", "electron", "usage-router-service-main.cjs"),
    });
    const persistedGateway = (await manager.listPersistedEnvironmentGateways()).find((item) => item.envName === "default");
    assert.equal(persistedGateway?.routeRules?.[0]?.targetModelId, "vision");
    const persistedRoutes = await manager.listPersistedRoutes();
    assert.ok(persistedRoutes.some((route) => route.exposedModelId === "vision"));
    const routedRuntime = JSON.parse(await readFile(join(accountDir, "runtime.json"), "utf8")) as { openai_base_url?: string };
    assert.match(routedRuntime.openai_base_url ?? "", /^http:\/\/127\.0\.0\.1:\d+\/gateways\//);

    await __internal.runNodeGatewayCommand(["stop", "--env", "default"], { stdout });
    assert.match(writes.join(""), /gateway stopped: default/);
    const restored = JSON.parse(await readFile(join(accountDir, "runtime.json"), "utf8")) as { openai_base_url_mode?: string; openai_base_url?: string };
    assert.equal(restored.openai_base_url_mode, "default");
    assert.equal(restored.openai_base_url, "");
  } finally {
    const { UsageRouterManager } = await import("../apps/desktop/electron/usage-router-manager.js");
    await new UsageRouterManager({
      stateDir,
      serviceEntryPath: join(process.cwd(), "apps", "desktop", "electron-dist", "electron", "usage-router-service-main.cjs"),
    }).stopService().catch(() => undefined);
    if (previous.state === undefined) delete process.env.CODEX_SWITCHER_STATE_DIR; else process.env.CODEX_SWITCHER_STATE_DIR = previous.state;
    if (previous.envs === undefined) delete process.env.CODEX_SWITCHER_ENVS_DIR; else process.env.CODEX_SWITCHER_ENVS_DIR = previous.envs;
    if (previous.home === undefined) delete process.env.CODEX_SWITCHER_DEFAULT_HOME; else process.env.CODEX_SWITCHER_DEFAULT_HOME = previous.home;
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports user-facing env ls and ac ls aliases", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-list-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "personal"), { recursive: true });
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(join(envsDir, "project", "home"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "personal\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "work\n", "utf8");

    const env = {
      ...process.env,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    const envList = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "env", "ls"],
      { cwd: repoRoot, env },
    );
    assert.match(envList.stdout, /- default \[cli-current\]/);
    assert.match(envList.stdout, /- project \[app-current\]/);

    const accountList = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ac", "ls", "--env", "project"],
      { cwd: repoRoot, env },
    );
    assert.match(accountList.stdout, /- work \[app-current\]/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports env new default clone and explicit empty/from modes", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-env-new-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const seedHome = join(envsDir, "seed", "home");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(seedHome, { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await writeFile(join(defaultHome, "config.toml"), 'preferred_auth_method = "apikey"\n', "utf8");
    await writeFile(join(defaultHome, "notes.txt"), "default-seed\n", "utf8");
    await writeFile(join(defaultHome, "auth.json"), '{"OPENAI_API_KEY":"sk-default"}\n', "utf8");
    await writeFile(join(seedHome, "prompt.md"), "seed-copy\n", "utf8");
    await writeFile(join(seedHome, "auth.json"), '{"OPENAI_API_KEY":"sk-seed"}\n', "utf8");

    const env = {
      ...process.env,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    const clonedDefault = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "env", "new", "project"],
      { cwd: repoRoot, env },
    );
    assert.equal(clonedDefault.stdout.trim(), "project");
    const projectNotes = await readFile(join(envsDir, "project", "home", "notes.txt"), "utf8");
    assert.equal(projectNotes.trim(), "default-seed");
    await assert.rejects(readFile(join(envsDir, "project", "home", "auth.json"), "utf8"));

    const emptyEnv = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "env", "new", "blank", "--empty"],
      { cwd: repoRoot, env },
    );
    assert.equal(emptyEnv.stdout.trim(), "blank");
    await assert.rejects(readFile(join(envsDir, "blank", "home", "notes.txt"), "utf8"));

    const fromSeed = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "env", "new", "copied", "--from", "seed"],
      { cwd: repoRoot, env },
    );
    assert.equal(fromSeed.stdout.trim(), "copied");
    const copiedPrompt = await readFile(join(envsDir, "copied", "home", "prompt.md"), "utf8");
    assert.equal(copiedPrompt.trim(), "seed-copy");
    await assert.rejects(readFile(join(envsDir, "copied", "home", "auth.json"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports help, lang, and check without bash", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-meta-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "default\n", "utf8");

    const env = {
      ...process.env,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    const help = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "help"],
      { cwd: repoRoot, env },
    );
    assert.match(help.stdout, /codex-sw-node env ls/);
    assert.match(help.stdout, /codex-sw-node check/);
    assert.match(help.stdout, /codex-sw-node app status/);
    assert.match(help.stdout, /codex-sw-node app logout \[account\]/);

    const helpAll = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "--help-all"],
      { cwd: repoRoot, env },
    );
    assert.match(helpAll.stdout, /codex-sw-node ops list/);
    assert.match(helpAll.stdout, /codex-sw-node ops proxy \[show\|test\|off\|<host:port>\|<scheme:\/\/host:port>\]/);
    assert.match(helpAll.stdout, /codex-sw-node ops import-default <env> \[--with-auth\] \[--force\]/);
    assert.match(helpAll.stdout, /codex-sw-node ops recover \[--dry-run\]/);
    assert.match(helpAll.stdout, /codex-sw-node ops doctor \[--fix\]/);
    assert.match(helpAll.stdout, /codex-sw-node ops token-refresh <start\|stop\|status\|run-once>/);
    assert.match(helpAll.stdout, /codex-sw-node install/);
    assert.match(helpAll.stdout, /codex-sw-node ac login <account> \[--env <env>\] \[-t cli\|app\|both\] \[--sync\|--no-sync\] \[--mode auth\|apikey\|sub2api\]/);
    assert.match(helpAll.stdout, /codex-sw-node ac relogin <account> --env <env> \[-t cli\|app\|both\] \[--sync\|--no-sync\] \[--mode auth\|apikey\|sub2api\]/);
    assert.match(helpAll.stdout, /codex-sw-node ac use <account> \[--env <env>\] \[-t cli\|app\|both\] \[--sync\|--no-sync\]/);
    assert.match(helpAll.stdout, /codex-sw-node app status/);
    assert.match(helpAll.stdout, /codex-sw-node app logout \[account\]/);

    const langGet = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "lang"],
      { cwd: repoRoot, env },
    );
    assert.equal(langGet.stdout, "language: en\n");

    const langSet = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "lang", "en"],
      { cwd: repoRoot, env },
    );
    assert.equal(langSet.stdout, "language set to: en\n");

    const check = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "check"],
      { cwd: repoRoot, env },
    );
    assert.match(check.stdout, /^version: \d+\.\d+\.\d+\ncheck: ok\n$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports install helper for windows terminal", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-install-win-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const userProfile = join(root, "User");
  const launcherPath = join(userProfile, "bin", "codex-sw.cmd");
  const profilePath = join(userProfile, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(join(userProfile, "Documents", "PowerShell"), { recursive: true });

    const env = {
      ...process.env,
      USERPROFILE: userProfile,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      CODEX_SWITCHER_TEST_PLATFORM: "win32",
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "install", "--shell", "windows-terminal"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /Installed codex-sw/);
    assert.match(result.stdout, /restart Windows Terminal/);
    const launcherRaw = await readFile(launcherPath, "utf8");
    assert.match(launcherRaw, /codex-sw-node\.cjs/);
    const profileRaw = await readFile(profilePath, "utf8");
    assert.match(profileRaw, /# >>> codex-sw init >>>/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports uninstall helper for unix shells", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-uninstall-unix-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const zshrc = join(root, ".zshrc");
  const linkPath = join(root, ".local", "bin", "codex-sw");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(join(root, ".local", "bin"), { recursive: true });
    await writeFile(linkPath, "legacy\n", "utf8");
    await writeFile(
      zshrc,
      '# existing\n# >>> codex-sw init >>>\nexport PATH="$HOME/.local/bin:$PATH"\n# <<< codex-sw init <<<\n',
      "utf8",
    );

    const env = {
      ...process.env,
      HOME: root,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "uninstall", "--shell", "zsh"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /Uninstalled codex-sw/);
    await assert.rejects(readFile(linkPath, "utf8"));
    const rcRaw = await readFile(zshrc, "utf8");
    assert.doesNotMatch(rcRaw, /codex-sw init/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports uninstall helper for powershell on windows", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-uninstall-win-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const userProfile = join(root, "User");
  const profilePath = join(userProfile, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1");
  const launcherPath = join(userProfile, "bin", "codex-sw.cmd");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(join(userProfile, "Documents", "PowerShell"), { recursive: true });
    await mkdir(join(userProfile, "bin"), { recursive: true });
    await writeFile(launcherPath, "launcher\r\n", "utf8");
    await writeFile(
      profilePath,
      '# >>> codex-sw init >>>\n$env:Path = "C:\\User\\bin;$env:Path"\n# <<< codex-sw init <<<\n',
      "utf8",
    );

    const env = {
      ...process.env,
      USERPROFILE: userProfile,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      CODEX_SWITCHER_TEST_PLATFORM: "win32",
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "uninstall", "--shell", "powershell"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /Uninstalled codex-sw/);
    await assert.rejects(readFile(launcherPath, "utf8"));
    const profileRaw = await readFile(profilePath, "utf8");
    assert.doesNotMatch(profileRaw, /codex-sw init/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports uninstall --purge on windows without bash", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-uninstall-purge-win-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const userProfile = join(root, "User");
  const profilePath = join(userProfile, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1");
  const launcherPath = join(userProfile, "bin", "codex-sw.cmd");
  const stateMarker = join(stateDir, "marker.txt");
  const envMarker = join(envsDir, "project", "home", "marker.txt");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(join(envsDir, "project", "home"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(join(userProfile, "Documents", "PowerShell"), { recursive: true });
    await mkdir(join(userProfile, "bin"), { recursive: true });
    await writeFile(stateMarker, "state\n", "utf8");
    await writeFile(envMarker, "env\n", "utf8");
    await writeFile(launcherPath, "launcher\r\n", "utf8");
    await writeFile(
      profilePath,
      '# >>> codex-sw init >>>\n$env:Path = "C:\\User\\bin;$env:Path"\n# <<< codex-sw init <<<\n',
      "utf8",
    );

    const env = {
      ...process.env,
      USERPROFILE: userProfile,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      CODEX_SWITCHER_TEST_PLATFORM: "win32",
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "uninstall", "--shell", "powershell", "--purge"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /Uninstalled codex-sw/);
    assert.match(result.stdout, /State and env homes removed\./);
    await assert.rejects(readFile(stateMarker, "utf8"));
    await assert.rejects(readFile(envMarker, "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ops list and ops proxy aliases without bash", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-ops-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "personal"), { recursive: true });
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(join(envsDir, "project", "home"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "personal\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "work\n", "utf8");

    const env = {
      ...process.env,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    const list = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ops", "list"],
      { cwd: repoRoot, env },
    );
    assert.match(list.stdout, /ENV/);
    assert.match(list.stdout, /default/);
    assert.match(list.stdout, /project/);

    const proxySet = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ops", "proxy", "127.0.0.1:7890"],
      { cwd: repoRoot, env },
    );
    assert.equal(proxySet.stdout.trim(), "Set usage API proxy: http://127.0.0.1:7890");

    const proxyShow = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ops", "proxy"],
      { cwd: repoRoot, env },
    );
    assert.match(proxyShow.stdout, /usage_api_proxy: http:\/\/127\.0\.0\.1:7890 \(manual\)/);

    const proxyOff = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ops", "proxy", "off"],
      { cwd: repoRoot, env },
    );
    assert.equal(proxyOff.stdout.trim(), "Manual usage API proxy disabled");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports env use, ac use, and ac base-url aliases", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-write-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const projectHome = join(envsDir, "project", "home");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "personal"), { recursive: true });
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(projectHome, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "personal\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "personal\n", "utf8");
    await writeFile(
      join(stateDir, "env-accounts", "default", "personal", "auth.json"),
      JSON.stringify({
        auth_mode: "apikey",
        OPENAI_API_KEY: "sk-default-123456",
      }),
      "utf8",
    );
    await writeFile(
      join(stateDir, "env-accounts", "default", "personal", "runtime.json"),
      JSON.stringify({
        preferred_auth_method: "apikey",
        openai_base_url_mode: "custom",
        openai_base_url: "https://default.example.test/v1",
      }),
      "utf8",
    );
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "auth.json"),
      JSON.stringify({
        auth_mode: "apikey",
        OPENAI_API_KEY: "sk-project-999999",
      }),
      "utf8",
    );
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "runtime.json"),
      JSON.stringify({
        preferred_auth_method: "apikey",
        openai_base_url_mode: "custom",
        openai_base_url: "https://project.example.test/v1",
      }),
      "utf8",
    );

    const env = {
      ...process.env,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    const envUse = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "env", "use", "project", "-t", "both"],
      { cwd: repoRoot, env },
    );
    assert.equal(envUse.stdout.trim(), "cli=project/default app=project/default");

    const accountUse = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ac", "use", "work", "--env", "project", "-t", "both"],
      { cwd: repoRoot, env },
    );
    assert.equal(accountUse.stdout.trim(), "cli=project/work app=project/work");

    const baseUrl = await execFileAsync(
      "npx",
      [
        "--yes",
        "tsx",
        "scripts/node-cli.ts",
        "ac",
        "base-url",
        "work",
        "--env",
        "project",
        "--mode",
        "custom",
        "https://runtime.example.test/v1",
      ],
      { cwd: repoRoot, env },
    );
    assert.equal(baseUrl.stdout.trim(), "project/work https://runtime.example.test/v1");

    const runtimeRaw = await readFile(
      join(stateDir, "env-accounts", "project", "work", "runtime.json"),
      "utf8",
    );
    assert.match(runtimeRaw, /https:\/\/runtime\.example\.test\/v1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli accepts ac use --sync and warns that the flag is ignored", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-ac-use-sync-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const projectHome = join(envsDir, "project", "home");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "personal"), { recursive: true });
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(projectHome, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "personal\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "personal\n", "utf8");
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "auth.json"),
      JSON.stringify({
        auth_mode: "apikey",
        OPENAI_API_KEY: "sk-project-999999",
      }),
      "utf8",
    );

    const env = {
      ...process.env,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ac", "use", "work", "--env", "project", "--sync"],
      { cwd: repoRoot, env },
    );

    assert.equal(result.stdout.trim(), "project/work");
    assert.match(result.stderr, /same-env account switch only replaces auth\.json; --sync is ignored/);
    const cliEnv = await readFile(join(stateDir, "current_cli_env"), "utf8");
    const cliAccount = await readFile(join(stateDir, "current_cli_account"), "utf8");
    assert.equal(cliEnv.trim(), "project");
    assert.equal(cliAccount.trim(), "work");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ac login --mode apikey without bash", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-login-apikey-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "default\n", "utf8");

    const env = {
      ...process.env,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      OPENAI_API_KEY: "sk-live-123456",
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ac", "login", "work", "--env", "default", "-t", "both", "--mode", "apikey", "--base-url", "https://api.example.test/v1"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /API key saved successfully for account: default\/work/);
    assert.match(result.stdout, /Logged in account: default\/work/);
    const authRaw = await readFile(join(stateDir, "env-accounts", "default", "work", "auth.json"), "utf8");
    assert.match(authRaw, /sk-live-123456/);
    const runtimeRaw = await readFile(join(stateDir, "env-accounts", "default", "work", "runtime.json"), "utf8");
    assert.match(runtimeRaw, /https:\/\/api\.example\.test\/v1/);
    const cliAccount = await readFile(join(stateDir, "current_cli_account"), "utf8");
    const appAccount = await readFile(join(stateDir, "current_app_account"), "utf8");
    assert.equal(cliAccount.trim(), "work");
    assert.equal(appAccount.trim(), "work");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ac login --sync by cloning default home into target env", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-login-sync-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const projectHome = join(envsDir, "project", "home");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(projectHome, { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await writeFile(join(defaultHome, "config.toml"), 'preferred_auth_method = "chatgpt"\n', "utf8");
    await writeFile(join(defaultHome, "workspace.txt"), "sync-seed\n", "utf8");
    await writeFile(join(defaultHome, "auth.json"), '{"OPENAI_API_KEY":"sk-default"}\n', "utf8");
    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "default\n", "utf8");

    const env = {
      ...process.env,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      OPENAI_API_KEY: "sk-live-123456",
    };

    const result = await execFileAsync(
      "npx",
      [
        "--yes",
        "tsx",
        "scripts/node-cli.ts",
        "ac",
        "login",
        "work",
        "--env",
        "project",
        "-t",
        "cli",
        "--sync",
        "--mode",
        "apikey",
      ],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /Logged in account: project\/work/);
    const copied = await readFile(join(projectHome, "workspace.txt"), "utf8");
    assert.equal(copied.trim(), "sync-seed");
    const projectAuth = await readFile(join(projectHome, "auth.json"), "utf8");
    assert.match(projectAuth, /sk-live-123456/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ac login --mode sub2api without bash", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-login-sub2api-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "default\n", "utf8");

    const env = {
      ...process.env,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      CODEX_SWITCHER_SUB2API_JSON: JSON.stringify({
        access_token: "access-123",
        id_token: "id-456",
        refresh_token: "refresh-789",
      }),
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ac", "login", "partner", "--env", "default", "-t", "cli", "--mode", "sub2api"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /Logged in account: default\/partner/);
    const authRaw = await readFile(join(stateDir, "env-accounts", "default", "partner", "auth.json"), "utf8");
    assert.match(authRaw, /access-123/);
    assert.match(authRaw, /id-456/);
    const cliAccount = await readFile(join(stateDir, "current_cli_account"), "utf8");
    assert.equal(cliAccount.trim(), "partner");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ac login --mode auth through a fake codex binary", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-login-auth-user-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const binDir = join(root, "bin");
  const codexPath = join(binDir, "codex");

  try {
    await mkdir(join(stateDir, "env-accounts", "project", "default"), { recursive: true });
    await mkdir(join(envsDir, "project", "home"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "default\n", "utf8");
    await writeFile(
      codexPath,
      `#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$CODEX_HOME"
cat > "$CODEX_HOME/auth.json" <<'JSON'
{
  "auth_mode": "chatgpt",
  "tokens": {
    "access_token": "fake-access-token",
    "id_token": "fake-id-token"
  }
}
JSON
`,
      "utf8",
    );
    await chmod(codexPath, 0o755);

    const env = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      CODEX_SWITCHER_CODEX_BIN: codexPath,
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ac", "login", "work", "--env", "project", "-t", "both", "--mode", "auth"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /Logged in account: project\/work/);
    const authRaw = await readFile(join(stateDir, "env-accounts", "project", "work", "auth.json"), "utf8");
    assert.match(authRaw, /fake-access-token/);
    const cliEnv = await readFile(join(stateDir, "current_cli_env"), "utf8");
    const cliAccount = await readFile(join(stateDir, "current_cli_account"), "utf8");
    const appEnv = await readFile(join(stateDir, "current_app_env"), "utf8");
    const appAccount = await readFile(join(stateDir, "current_app_account"), "utf8");
    assert.equal(cliEnv.trim(), "project");
    assert.equal(cliAccount.trim(), "work");
    assert.equal(appEnv.trim(), "project");
    assert.equal(appAccount.trim(), "work");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ac relogin --mode apikey without bash", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-relogin-apikey-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "work"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "work\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "default\n", "utf8");
    await writeFile(
      join(stateDir, "env-accounts", "default", "work", "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-old-000000" }),
      "utf8",
    );

    const env = {
      ...process.env,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      OPENAI_API_KEY: "sk-new-123456",
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ac", "relogin", "work", "--env", "default", "-t", "cli", "--mode", "apikey", "--base-url", "https://refresh.example.test/v1"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /API key saved successfully for account: default\/work/);
    assert.match(result.stdout, /Logged in account: default\/work/);
    const authRaw = await readFile(join(stateDir, "env-accounts", "default", "work", "auth.json"), "utf8");
    assert.match(authRaw, /sk-new-123456/);
    const runtimeRaw = await readFile(join(stateDir, "env-accounts", "default", "work", "runtime.json"), "utf8");
    assert.match(runtimeRaw, /https:\/\/refresh\.example\.test\/v1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ac relogin --sync by cloning default home into target env", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-relogin-sync-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const projectHome = join(envsDir, "project", "home");

  try {
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(projectHome, { recursive: true });
    await writeFile(join(defaultHome, "notes.md"), "relogin-seed\n", "utf8");
    await writeFile(join(defaultHome, "auth.json"), '{"OPENAI_API_KEY":"sk-default"}\n', "utf8");
    await writeFile(join(stateDir, "current_cli_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "work\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "default\n", "utf8");
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-old-000000" }),
      "utf8",
    );

    const env = {
      ...process.env,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      OPENAI_API_KEY: "sk-new-123456",
    };

    const result = await execFileAsync(
      "npx",
      [
        "--yes",
        "tsx",
        "scripts/node-cli.ts",
        "ac",
        "relogin",
        "work",
        "--env",
        "project",
        "--sync",
        "--mode",
        "apikey",
      ],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /Logged in account: project\/work/);
    const copied = await readFile(join(projectHome, "notes.md"), "utf8");
    assert.equal(copied.trim(), "relogin-seed");
    const projectAuth = await readFile(join(projectHome, "auth.json"), "utf8");
    assert.match(projectAuth, /sk-new-123456/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ac relogin --mode auth through a fake codex binary", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-relogin-auth-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const binDir = join(root, "bin");
  const codexPath = join(binDir, "codex");

  try {
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(join(envsDir, "project", "home"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "work\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "default\n", "utf8");
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "auth.json"),
      JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "stale-token", id_token: "stale-id" } }),
      "utf8",
    );
    await writeFile(
      codexPath,
      `#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$CODEX_HOME"
cat > "$CODEX_HOME/auth.json" <<'JSON'
{
  "auth_mode": "chatgpt",
  "tokens": {
    "access_token": "fresh-access-token",
    "id_token": "fresh-id-token"
  }
}
JSON
`,
      "utf8",
    );
    await chmod(codexPath, 0o755);

    const env = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      CODEX_SWITCHER_CODEX_BIN: codexPath,
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ac", "relogin", "work", "--env", "project", "-t", "cli", "--mode", "auth"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /Logged in account: project\/work/);
    const authRaw = await readFile(join(stateDir, "env-accounts", "project", "work", "auth.json"), "utf8");
    assert.match(authRaw, /fresh-access-token/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ac relogin --mode sub2api without bash", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-relogin-sub2api-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "partner"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "partner\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "default\n", "utf8");
    await writeFile(
      join(stateDir, "env-accounts", "default", "partner", "auth.json"),
      JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "old-access", id_token: "old-id" } }),
      "utf8",
    );

    const env = {
      ...process.env,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      CODEX_SWITCHER_SUB2API_JSON: JSON.stringify({
        access_token: "renewed-access",
        id_token: "renewed-id",
      }),
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ac", "relogin", "partner", "--env", "default", "-t", "cli", "--mode", "sub2api"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /Logged in account: default\/partner/);
    const authRaw = await readFile(join(stateDir, "env-accounts", "default", "partner", "auth.json"), "utf8");
    assert.match(authRaw, /renewed-access/);
    assert.match(authRaw, /renewed-id/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli relogin reports missing env in non-interactive mode", async () => {
  await assert.rejects(
    execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ac", "relogin", "work", "--mode", "auth"],
      { cwd: repoRoot },
    ),
    /missing env/i,
  );
});

test("node-cli relogin rejects unknown account slots", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-relogin-missing-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });

    const env = {
      ...process.env,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    await assert.rejects(
      execFileAsync(
        "npx",
        ["--yes", "tsx", "scripts/node-cli.ts", "ac", "relogin", "ghost", "--env", "default", "--mode", "auth"],
        { cwd: repoRoot, env },
      ),
      /not found in env 'default'/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports cli launch-current without bash", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-launch-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const binDir = join(root, "bin");
  const codexPath = join(binDir, "codex");
  const codexLog = join(root, "codex.log");
  const projectHome = join(envsDir, "project", "home");

  try {
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(projectHome, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "work\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "default\n", "utf8");
    await writeFile(
      codexPath,
      `#!/usr/bin/env bash
set -euo pipefail
printf 'CODEX_HOME=%s\\n' "$CODEX_HOME" >> "${codexLog}"
printf 'ARGS=%s\\n' "$*" >> "${codexLog}"
`,
      "utf8",
    );
    await chmod(codexPath, 0o755);

    const env = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "cli", "launch-current", "--", "status"],
      { cwd: repoRoot, env },
    );

    assert.equal(result.stdout, "");
    const log = await readFile(codexLog, "utf8");
    assert.match(log, /CODEX_HOME=.*\/project\/home/);
    assert.match(log, /ARGS=status/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ops exec alias without bash", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-ops-exec-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const binDir = join(root, "bin");
  const codexPath = join(binDir, "codex");
  const codexLog = join(root, "codex.log");
  const projectHome = join(envsDir, "project", "home");

  try {
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(projectHome, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "work\n", "utf8");
    await writeFile(
      codexPath,
      `#!/usr/bin/env bash
set -euo pipefail
printf 'CODEX_HOME=%s\\n' "$CODEX_HOME" >> "${codexLog}"
printf 'ARGS=%s\\n' "$*" >> "${codexLog}"
`,
      "utf8",
    );
    await chmod(codexPath, 0o755);

    const env = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ops", "exec", "--", "status"],
      { cwd: repoRoot, env },
    );

    assert.equal(result.stdout, "");
    const log = await readFile(codexLog, "utf8");
    assert.match(log, /CODEX_HOME=.*\/project\/home/);
    assert.match(log, /ARGS=status/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports env rm and ac rm aliases without bash", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-remove-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const projectHome = join(envsDir, "project", "home");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(projectHome, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "work\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "work\n", "utf8");
    await writeFile(
      join(stateDir, "env-accounts", "default", "default", "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-default-123456" }),
      "utf8",
    );

    const env = {
      ...process.env,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    const accountRemove = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ac", "rm", "work", "--env", "project", "--force"],
      { cwd: repoRoot, env },
    );
    assert.equal(accountRemove.stdout.trim(), "Removed account slot: project/work");

    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "default\n", "utf8");

    const envRemove = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "env", "rm", "project", "--force"],
      { cwd: repoRoot, env },
    );
    assert.equal(envRemove.stdout.trim(), "Removed env: project");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("node-cli doctor reports platform paths and binary discovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-doctor-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const binDir = join(root, "bin");
  const cliPath = join(binDir, "codex");
  const appPath = join(root, "Codex.app.bin");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "default\n", "utf8");
    await writeFile(cliPath, "#!/bin/sh\nexit 0\n", "utf8");
    await writeFile(appPath, "binary", "utf8");
    await chmod(cliPath, 0o755);
    await chmod(appPath, 0o755);

    const env = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      USERPROFILE: "C:\\Users\\alice",
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      CODEX_SWITCHER_APP_BIN: appPath,
      CODEX_SWITCHER_WINDOWS_APP_LAUNCHER: "wt",
      CODEX_BIN: "",
      CODEX_SWITCHER_CODEX_BIN: "",
    };

    const doctor = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "doctor"],
      { cwd: repoRoot, env },
    );

    assert.match(doctor.stdout, /^platform: /m);
    assert.match(doctor.stdout, /state_dir: /);
    assert.match(doctor.stdout, /- codex binary: ok \(/);
    assert.match(doctor.stdout, /- codex app binary: ok \(/);
    assert.match(doctor.stdout, /app launcher: direct \(windows override: wt\)/);
    assert.match(doctor.stdout, /- windows launcher wt\.exe: missing/);
    assert.match(doctor.stdout, /- windows launcher powershell\.exe: missing/);
    assert.match(doctor.stdout, /- windows launcher cmd\.exe: missing/);
    assert.match(doctor.stdout, /windows cli candidates:/);
    assert.match(doctor.stdout, /C:\\Users\\alice.*Programs.*Codex.*codex\.exe/);
    assert.match(doctor.stdout, /windows app candidates:/);
    assert.match(doctor.stdout, /C:\\Users\\alice.*Programs.*Codex.*Codex\.exe/);
    assert.match(doctor.stdout, /windows shell init files:/);
    assert.match(doctor.stdout, /C:\\Users\\alice.*WindowsPowerShell.*Microsoft\.PowerShell_profile\.ps1/);
    assert.match(doctor.stdout, /doctor: ok/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ops doctor alias", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-ops-doctor-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const binDir = join(root, "bin");
  const cliPath = join(binDir, "codex");
  const appPath = join(root, "Codex.app.bin");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "default\n", "utf8");
    await writeFile(cliPath, "#!/bin/sh\nexit 0\n", "utf8");
    await writeFile(appPath, "binary", "utf8");
    await chmod(cliPath, 0o755);
    await chmod(appPath, 0o755);

    const env = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      CODEX_SWITCHER_APP_BIN: appPath,
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ops", "doctor"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /doctor: ok/);
    assert.match(result.stdout, /state_dir: /);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ops doctor --fix with pointer repair", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-ops-doctor-fix-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const binDir = join(root, "bin");
  const cliPath = join(binDir, "codex");
  const appPath = join(root, "Codex.app.bin");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "missing\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "ghost\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "ghost\n", "utf8");
    await writeFile(cliPath, "#!/bin/sh\nexit 0\n", "utf8");
    await writeFile(appPath, "binary", "utf8");
    await chmod(cliPath, 0o755);
    await chmod(appPath, 0o755);

    const env = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      CODEX_SWITCHER_APP_BIN: appPath,
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ops", "doctor", "--fix"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /doctor --fix: completed/);
    assert.match(result.stdout, /doctor: ok/);
    const cliEnv = await readFile(join(stateDir, "current_cli_env"), "utf8");
    const cliAccount = await readFile(join(stateDir, "current_cli_account"), "utf8");
    const appAccount = await readFile(join(stateDir, "current_app_account"), "utf8");
    assert.equal(cliEnv.trim(), "default");
    assert.equal(cliAccount.trim(), "default");
    assert.equal(appAccount.trim(), "default");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runNodeTokenRefreshCommand supports start on windows via scheduled task", async () => {
  const stdout: string[] = [];
  const calls: Array<{ command: string; args: string[] }> = [];
  const candidate = (__internal as Record<string, unknown>).runNodeTokenRefreshCommand;
  assert.equal(typeof candidate, "function");

  const originalEnv = process.env;
  process.env = {
    ...originalEnv,
    USERPROFILE: "/tmp/codex-win-home",
    CODEX_SWITCHER_TEST_PLATFORM: "win32",
    CODEX_SWITCHER_TOKEN_REFRESH_INTERVAL_SECONDS: "900",
  };

  try {
    const code = await (candidate as (
      argv: string[],
      deps?: {
        stdout?: Pick<NodeJS.WriteStream, "write">;
        spawnImpl?: typeof import("node:child_process").spawn;
      },
    ) => Promise<number>)(["start"], {
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      spawnImpl: ((command: string, args: string[]) => {
        calls.push({ command, args });
        return {
          on(event: string, handler: (...args: unknown[]) => void) {
            if (event === "exit") {
              handler(0, null);
            }
          },
        } as unknown as ReturnType<typeof import("node:child_process").spawn>;
      }) as typeof import("node:child_process").spawn,
    });

    assert.equal(code, 0);
    assert.equal(calls[0]?.command, "schtasks.exe");
    assert.match(calls[0]?.args.join(" ") ?? "", /\/Create/i);
    assert.match(stdout.join(""), /token_refresh_guard: enabled \(task=/);
  } finally {
    process.env = originalEnv;
  }
});

test("runNodeTokenRefreshCommand supports stop on windows via scheduled task", async () => {
  const stdout: string[] = [];
  const calls: Array<{ command: string; args: string[] }> = [];
  const candidate = (__internal as Record<string, unknown>).runNodeTokenRefreshCommand;
  assert.equal(typeof candidate, "function");

  const originalEnv = process.env;
  process.env = {
    ...originalEnv,
    USERPROFILE: "/tmp/codex-win-home",
    CODEX_SWITCHER_TEST_PLATFORM: "win32",
  };

  try {
    const code = await (candidate as (
      argv: string[],
      deps?: {
        stdout?: Pick<NodeJS.WriteStream, "write">;
        spawnImpl?: typeof import("node:child_process").spawn;
      },
    ) => Promise<number>)(["stop"], {
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      spawnImpl: ((command: string, args: string[]) => {
        calls.push({ command, args });
        return {
          on(event: string, handler: (...args: unknown[]) => void) {
            if (event === "exit") {
              handler(0, null);
            }
          },
        } as unknown as ReturnType<typeof import("node:child_process").spawn>;
      }) as typeof import("node:child_process").spawn,
    });

    assert.equal(code, 0);
    assert.equal(calls[0]?.command, "schtasks.exe");
    assert.match(calls[0]?.args.join(" ") ?? "", /\/Delete/i);
    assert.match(stdout.join(""), /token_refresh_guard: disabled/);
  } finally {
    process.env = originalEnv;
  }
});

test("runNodeTokenRefreshCommand reports running status on windows from scheduled task query", async () => {
  const stdout: string[] = [];
  const calls: Array<{ command: string; args: string[] }> = [];
  const candidate = (__internal as Record<string, unknown>).runNodeTokenRefreshCommand;
  assert.equal(typeof candidate, "function");

  const originalEnv = process.env;
  process.env = {
    ...originalEnv,
    USERPROFILE: "/tmp/codex-win-home",
    CODEX_SWITCHER_TEST_PLATFORM: "win32",
  };

  try {
    const code = await (candidate as (
      argv: string[],
      deps?: {
        stdout?: Pick<NodeJS.WriteStream, "write">;
        spawnImpl?: typeof import("node:child_process").spawn;
      },
    ) => Promise<number>)(["status"], {
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      spawnImpl: ((command: string, args: string[]) => {
        calls.push({ command, args });
        return {
          stdout: {
            on(event: string, handler: (chunk: string) => void) {
              if (event === "data") {
                handler("Status: Running\n");
              }
            },
          },
          stderr: {
            on() {
              return undefined;
            },
          },
          on(event: string, handler: (...args: unknown[]) => void) {
            if (event === "exit") {
              handler(0, null);
            }
          },
        } as unknown as ReturnType<typeof import("node:child_process").spawn>;
      }) as typeof import("node:child_process").spawn,
    });

    assert.equal(code, 0);
    assert.equal(calls[0]?.command, "schtasks.exe");
    assert.match(calls[0]?.args.join(" ") ?? "", /\/Query/i);
    assert.match(stdout.join(""), /token_refresh_guard: enabled\(running\), task=/);
  } finally {
    process.env = originalEnv;
  }
});

test("node-cli supports token-refresh run-once natively on windows", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-token-refresh-win-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const projectHome = join(envsDir, "project", "home");
  const binDir = join(root, "bin");
  const codexPath = join(binDir, "codex.cmd");

  try {
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(projectHome, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "work\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "default\n", "utf8");
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "auth.json"),
      JSON.stringify({
        auth_mode: "chatgpt",
        email: "work@example.test",
        expired: "2020-01-01 00:00:00Z",
        tokens: {
          access_token: "stale-access",
          id_token: "stale-id",
        },
      }),
      "utf8",
    );
    await writeFile(
      codexPath,
      `#!/usr/bin/env bash
set -euo pipefail
node -e "const fs=require('node:fs'); const path=require('node:path'); const home=process.env.CODEX_HOME; fs.mkdirSync(home,{recursive:true}); fs.writeFileSync(path.join(home,'auth.json'), JSON.stringify({auth_mode:'chatgpt',email:'work@example.test',expired:'2099-01-01 00:00:00Z',tokens:{access_token:'fresh-access',id_token:'fresh-id'}}, null, 2) + '\\n'); console.log('ok');"
`,
      "utf8",
    );
    await chmod(codexPath, 0o755);

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ops", "token-refresh", "run-once"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH || ""}`,
          CODEX_SWITCHER_TEST_PLATFORM: "win32",
          CODEX_SWITCHER_STATE_DIR: stateDir,
          CODEX_SWITCHER_ENVS_DIR: envsDir,
          CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
          CODEX_SWITCHER_CODEX_BIN: codexPath,
        },
      },
    );

    assert.match(result.stdout, /Summary: scanned=2/);
    assert.match(result.stdout, /refreshed=1/);
    const authRaw = await readFile(join(stateDir, "env-accounts", "project", "work", "auth.json"), "utf8");
    const projectAuthRaw = await readFile(join(projectHome, "auth.json"), "utf8");
    assert.match(authRaw, /fresh-access/);
    assert.match(projectAuthRaw, /fresh-access/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports token-refresh run-once natively on unix", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-token-refresh-unix-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const projectHome = join(envsDir, "project", "home");
  const binDir = join(root, "bin");
  const codexPath = join(binDir, "codex");

  try {
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(projectHome, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "work\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "default\n", "utf8");
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "auth.json"),
      JSON.stringify({
        auth_mode: "chatgpt",
        email: "work@example.test",
        expired: "2020-01-01 00:00:00Z",
        tokens: {
          access_token: "stale-access",
          id_token: "stale-id",
        },
      }),
      "utf8",
    );
    await writeFile(
      codexPath,
      `#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$CODEX_HOME"
cat > "$CODEX_HOME/auth.json" <<'JSON'
{
  "auth_mode": "chatgpt",
  "email": "work@example.test",
  "expired": "2099-01-01 00:00:00Z",
  "tokens": {
    "access_token": "fresh-access",
    "id_token": "fresh-id"
  }
}
JSON
printf 'ok\\n'
`,
      "utf8",
    );
    await chmod(codexPath, 0o755);

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ops", "token-refresh", "run-once"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH || ""}`,
          CODEX_SWITCHER_STATE_DIR: stateDir,
          CODEX_SWITCHER_ENVS_DIR: envsDir,
          CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
          CODEX_SWITCHER_CODEX_BIN: codexPath,
        },
      },
    );

    assert.match(result.stdout, /Summary: scanned=2/);
    assert.match(result.stdout, /refreshed=1/);
    const authRaw = await readFile(join(stateDir, "env-accounts", "project", "work", "auth.json"), "utf8");
    assert.match(authRaw, /fresh-access/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli reports token-refresh status natively on windows when task is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-token-refresh-status-win-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const binDir = join(root, "bin");
  const schtasksPath = join(binDir, "schtasks.exe");

  try {
    await mkdir(stateDir, { recursive: true });
    await mkdir(envsDir, { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(
      schtasksPath,
      `#!/usr/bin/env bash
exit 1
`,
      "utf8",
    );
    await chmod(schtasksPath, 0o755);

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ops", "token-refresh", "status"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH || ""}`,
          CODEX_SWITCHER_TEST_PLATFORM: "win32",
          CODEX_SWITCHER_STATE_DIR: stateDir,
          CODEX_SWITCHER_ENVS_DIR: envsDir,
          CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
        },
      },
    );

    assert.match(result.stdout, /token_refresh_guard: disabled \(task=/);
    assert.match(result.stdout, /token_refresh_task: /);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli reports token-refresh status natively on unix with plist details", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-token-refresh-status-unix-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const fakeHome = join(root, "home");
  const plistPath = join(
    fakeHome,
    "Library",
    "LaunchAgents",
    "com.wangxt.codex-switcher.token-refresh.plist",
  );

  try {
    await mkdir(stateDir, { recursive: true });
    await mkdir(envsDir, { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(join(fakeHome, "Library", "LaunchAgents"), { recursive: true });
    await writeFile(plistPath, "<plist />\n", "utf8");

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ops", "token-refresh", "status"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          HOME: fakeHome,
          CODEX_SWITCHER_STATE_DIR: stateDir,
          CODEX_SWITCHER_ENVS_DIR: envsDir,
          CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
        },
      },
    );

    assert.match(result.stdout, /token_refresh_guard: enabled\((running|not-running)\), interval=900s/);
    assert.match(result.stdout, /token_refresh_plist:/);
    assert.match(result.stdout, /token_refresh_log:/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ops recover --dry-run alias", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-ops-recover-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const projectHome = join(envsDir, "project", "home");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(projectHome, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "missing\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "ghost\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "work\n", "utf8");

    const env = {
      ...process.env,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ops", "recover", "--dry-run"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /recover\(cli\): default\/default/);
    assert.match(result.stdout, /recover\(app\): project\/work/);
    const cliEnv = await readFile(join(stateDir, "current_cli_env"), "utf8");
    const cliAccount = await readFile(join(stateDir, "current_cli_account"), "utf8");
    assert.equal(cliEnv.trim(), "missing");
    assert.equal(cliAccount.trim(), "ghost");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ops recover alias with pointer repair", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-ops-recover-write-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const projectHome = join(envsDir, "project", "home");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(projectHome, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "missing\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "ghost\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "ghost\n", "utf8");
    await writeFile(
      join(stateDir, "env-accounts", "default", "default", "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-default-123" }),
      "utf8",
    );
    await writeFile(
      join(stateDir, "env-accounts", "default", "default", "runtime.json"),
      JSON.stringify({
        preferred_auth_method: "apikey",
        openai_base_url_mode: "default",
      }),
      "utf8",
    );
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-project-456" }),
      "utf8",
    );
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "runtime.json"),
      JSON.stringify({
        preferred_auth_method: "apikey",
        openai_base_url_mode: "custom",
        openai_base_url: "https://project.example.test/v1",
      }),
      "utf8",
    );

    const env = {
      ...process.env,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ops", "recover"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /recover\(cli\): default\/default/);
    assert.match(result.stdout, /recover\(app\): project\/default/);

    const cliEnv = await readFile(join(stateDir, "current_cli_env"), "utf8");
    const cliAccount = await readFile(join(stateDir, "current_cli_account"), "utf8");
    const appEnv = await readFile(join(stateDir, "current_app_env"), "utf8");
    const appAccount = await readFile(join(stateDir, "current_app_account"), "utf8");
    assert.equal(cliEnv.trim(), "default");
    assert.equal(cliAccount.trim(), "default");
    assert.equal(appEnv.trim(), "project");
    assert.equal(appAccount.trim(), "default");

    const defaultAuthRaw = await readFile(join(defaultHome, "auth.json"), "utf8");
    assert.match(defaultAuthRaw, /sk-default-123/);

    await assert.rejects(readFile(join(projectHome, "auth.json"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ops import-default with auth copy without bash", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-import-default-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const importedHome = join(envsDir, "project", "home");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await writeFile(
      join(stateDir, "env-accounts", "default", "default", "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-default-123" }),
      "utf8",
    );
    await writeFile(
      join(stateDir, "env-accounts", "default", "default", "runtime.json"),
      JSON.stringify({
        preferred_auth_method: "apikey",
        openai_base_url_mode: "custom",
        openai_base_url: "https://default.example.test/v1",
      }),
      "utf8",
    );

    const env = {
      ...process.env,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ops", "import-default", "project", "--with-auth"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /Imported default data to env: project/);

    const importedAuthRaw = await readFile(
      join(stateDir, "env-accounts", "project", "default", "auth.json"),
      "utf8",
    );
    const importedRuntimeRaw = await readFile(
      join(stateDir, "env-accounts", "project", "default", "runtime.json"),
      "utf8",
    );
    const importedAuth = JSON.parse(importedAuthRaw) as Record<string, string>;
    const importedRuntime = JSON.parse(importedRuntimeRaw) as Record<string, string>;
    assert.equal(importedAuth.OPENAI_API_KEY, "sk-default-123");
    assert.equal(importedRuntime.preferred_auth_method, "apikey");
    assert.equal(importedRuntime.openai_base_url_mode, "custom");
    assert.equal(importedRuntime.openai_base_url, "https://default.example.test/v1");

    const importedHomeStat = await readFile(join(importedHome, "auth.json"), "utf8").catch(() => "");
    assert.equal(importedHomeStat, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports upgrade dry-run without bash", async () => {
  const env = {
    ...process.env,
    CODEX_SWITCHER_UPGRADE_REGISTRY: "https://registry.example.test/",
    CODEX_SWITCHER_NPM_PACKAGE: "@acme/codex-switcher",
  };

  const result = await execFileAsync(
    "npx",
    ["--yes", "tsx", "scripts/node-cli.ts", "upgrade", "--dry-run"],
    { cwd: repoRoot, env },
  );

  assert.match(
    result.stdout,
    /\[dry-run\] npm i -g @acme\/codex-switcher@latest --registry https:\/\/registry\.example\.test\//,
  );
});

test("node-cli supports upgrade execution without bash", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-upgrade-"));
  const binDir = join(root, "bin");
  const npmPath = join(binDir, "npm");
  const logPath = join(root, "npm.log");

  try {
    await mkdir(binDir, { recursive: true });
    await writeFile(
      npmPath,
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" > "${logPath}"
`,
      "utf8",
    );
    await chmod(npmPath, 0o755);

    const env = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      CODEX_SWITCHER_UPGRADE_REGISTRY: "https://registry.example.test/",
      CODEX_SWITCHER_NPM_PACKAGE: "@acme/codex-switcher",
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "upgrade"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /Upgraded codex-sw to latest\./);
    const npmLog = await readFile(logPath, "utf8");
    assert.equal(
      npmLog.trim(),
      "i -g @acme/codex-switcher@latest --registry https://registry.example.test/",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ops init dry-run for unix shells", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-init-unix-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });

    const env = {
      ...process.env,
      HOME: root,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    const result = await execFileAsync(
      "npx",
      [
        "--yes",
        "tsx",
        "scripts/node-cli.ts",
        "ops",
        "init",
        "--shell",
        "zsh",
        "--dry-run",
      ],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /\[dry-run\] mkdir -p .*\.local\/bin/);
    assert.match(result.stdout, /\[dry-run\] ln -sf .*codex-switcher .*\.local\/bin\/codex-sw/);
    assert.match(result.stdout, /\[dry-run\] ensure PATH block in .*\.zshrc/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ops init dry-run for powershell on windows", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-init-win-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const userProfile = join(root, "User");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(userProfile, { recursive: true });

    const env = {
      ...process.env,
      USERPROFILE: userProfile,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      CODEX_SWITCHER_TEST_PLATFORM: "win32",
    };

    const result = await execFileAsync(
      "npx",
      [
        "--yes",
        "tsx",
        "scripts/node-cli.ts",
        "ops",
        "init",
        "--shell",
        "powershell",
        "--dry-run",
      ],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /\[dry-run\] mkdir -p .*User.*bin/);
    assert.match(result.stdout, /\[dry-run\] write launcher .*User.*bin.*codex-sw\.cmd/);
    assert.match(result.stdout, /\[dry-run\] ensure PATH block in .*PowerShell.*Microsoft\.PowerShell_profile\.ps1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ops init write for unix shells", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-init-write-unix-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const zshrc = join(root, ".zshrc");
  const linkPath = join(root, ".local", "bin", "codex-sw");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await writeFile(zshrc, "# existing\n", "utf8");

    const env = {
      ...process.env,
      HOME: root,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ops", "init", "--shell", "zsh"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /Initialized codex-sw for zsh/);
    assert.match(result.stdout, /Run: source .*\.zshrc/);
    const rcRaw = await readFile(zshrc, "utf8");
    assert.match(rcRaw, /# >>> codex-sw init >>>/);
    assert.match(rcRaw, /export PATH="\$HOME\/\.local\/bin:\$PATH"/);
    const linkTarget = await readFile(linkPath, "utf8");
    assert.match(linkTarget, /plugins\/codex-switcher\/scripts\/codex-switcher/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ops init write for powershell on windows", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-init-write-win-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const userProfile = join(root, "User");
  const profilePath = join(userProfile, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1");
  const launcherPath = join(userProfile, "bin", "codex-sw.cmd");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(join(userProfile, "Documents", "PowerShell"), { recursive: true });

    const env = {
      ...process.env,
      USERPROFILE: userProfile,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      CODEX_SWITCHER_TEST_PLATFORM: "win32",
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ops", "init", "--shell", "powershell"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /Initialized codex-sw for powershell/);
    assert.match(result.stdout, /Run: reload your PowerShell profile/);
    const launcherRaw = await readFile(launcherPath, "utf8");
    assert.match(launcherRaw, /codex-sw-node\.cjs/);
    const profileRaw = await readFile(profilePath, "utf8");
    assert.match(profileRaw, /# >>> codex-sw init >>>/);
    assert.match(profileRaw, /\$env:Path = ".*bin.*"; \+ \$env:Path|\$env:Path = ".*bin.*;\$env:Path"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ops init dry-run for cmd on windows", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-init-cmd-dry-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const userProfile = join(root, "User");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(userProfile, { recursive: true });

    const env = {
      ...process.env,
      USERPROFILE: userProfile,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      CODEX_SWITCHER_TEST_PLATFORM: "win32",
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ops", "init", "--shell", "cmd", "--dry-run"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /\[dry-run\] mkdir -p .*User.*bin/);
    assert.match(result.stdout, /\[dry-run\] write launcher .*User.*bin.*codex-sw\.cmd/);
    assert.match(result.stdout, /\[dry-run\] ensure PATH block in .*cmd-init\.bat/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ops init write for cmd on windows", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-init-cmd-write-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const userProfile = join(root, "User");
  const launcherPath = join(userProfile, "bin", "codex-sw.cmd");
  const initBatPath = join(userProfile, "cmd-init.bat");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(userProfile, { recursive: true });

    const env = {
      ...process.env,
      USERPROFILE: userProfile,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      CODEX_SWITCHER_TEST_PLATFORM: "win32",
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ops", "init", "--shell", "cmd"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /Initialized codex-sw for cmd/);
    assert.match(result.stdout, /Run: call .*cmd-init\.bat/);
    const launcherRaw = await readFile(launcherPath, "utf8");
    assert.match(launcherRaw, /codex-sw-node\.cjs/);
    const initBatRaw = await readFile(initBatPath, "utf8");
    assert.match(initBatRaw, /codex-sw init/);
    assert.match(initBatRaw, /set PATH=.*bin.*;%PATH%/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ops init dry-run for windows terminal on windows", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-init-wt-dry-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const userProfile = join(root, "User");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(userProfile, { recursive: true });

    const env = {
      ...process.env,
      USERPROFILE: userProfile,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      CODEX_SWITCHER_TEST_PLATFORM: "win32",
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ops", "init", "--shell", "windows-terminal", "--dry-run"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /\[dry-run\] mkdir -p .*User.*bin/);
    assert.match(result.stdout, /\[dry-run\] write launcher .*User.*bin.*codex-sw\.cmd/);
    assert.match(result.stdout, /\[dry-run\] ensure PATH block in .*PowerShell.*Microsoft\.PowerShell_profile\.ps1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ops init write for windows terminal on windows", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-init-wt-write-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const userProfile = join(root, "User");
  const profilePath = join(userProfile, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1");
  const launcherPath = join(userProfile, "bin", "codex-sw.cmd");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(join(userProfile, "Documents", "PowerShell"), { recursive: true });

    const env = {
      ...process.env,
      USERPROFILE: userProfile,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      CODEX_SWITCHER_TEST_PLATFORM: "win32",
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ops", "init", "--shell", "windows-terminal"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /Initialized codex-sw for windows-terminal/);
    assert.match(result.stdout, /Run: restart Windows Terminal/);
    const launcherRaw = await readFile(launcherPath, "utf8");
    assert.match(launcherRaw, /codex-sw-node\.cjs/);
    const profileRaw = await readFile(profilePath, "utf8");
    assert.match(profileRaw, /# >>> codex-sw init >>>/);
    assert.match(profileRaw, /\$env:Path = ".*bin.*;\$env:Path"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports ac logout aliases without bash", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-logout-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const projectHome = join(envsDir, "project", "home");

  try {
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(join(stateDir, "env-accounts", "project", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(projectHome, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "work\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "work\n", "utf8");
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-project-654321" }),
      "utf8",
    );
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "runtime.json"),
      JSON.stringify({
        preferred_auth_method: "apikey",
        openai_base_url_mode: "custom",
        openai_base_url: "https://project.example.test/v1",
      }),
      "utf8",
    );

    const env = {
      ...process.env,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    const explicit = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ac", "logout", "work", "--env", "project", "-t", "both"],
      { cwd: repoRoot, env },
    );
    assert.equal(explicit.stdout.trim(), "Logged out account: project/work");

    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-project-654321" }),
      "utf8",
    );
    await writeFile(join(stateDir, "current_cli_account"), "work\n", "utf8");

    const implicit = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "ac", "logout", "--env", "project", "-t", "cli"],
      { cwd: repoRoot, env },
    );
    assert.equal(implicit.stdout.trim(), "Logged out account: project/work");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
// Keep direct Codex App lifecycle CLI coverage disabled by default while this
// suite runs inside Codex App. Real stop/restart flows can trigger quit
// confirmation dialogs that block the current session. Re-enable explicitly
// from an external terminal when needed.
const codexAppLifecycleCliTest = process.env.CODEX_SWITCHER_ENABLE_APP_LIFECYCLE_TESTS
  ? test
  : test.skip;

codexAppLifecycleCliTest("node-cli supports app stop-managed without bash", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-app-stop-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const userProfile = join(root, "User");
  const binDir = join(root, "bin");
  const taskkillPath = join(binDir, "taskkill");
  const taskkillLog = join(root, "taskkill.log");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(userProfile, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "default\n", "utf8");
    await writeFile(join(stateDir, "app.pid"), "4545\n", "utf8");
    await writeFile(
      taskkillPath,
      `#!/bin/sh
printf '%s\n' "$@" > "${taskkillLog}"
exit 0
`,
      "utf8",
    );
    await chmod(taskkillPath, 0o755);

    const env = {
      ...process.env,
      USERPROFILE: userProfile,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      CODEX_SWITCHER_TEST_PLATFORM: "win32",
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "app", "stop-managed"],
      { cwd: repoRoot, env },
    );

    assert.equal(result.stdout, "Stopped managed app process\n");
    await assert.rejects(readFile(join(stateDir, "app.pid"), "utf8"));
    const taskkillArgs = await readFile(taskkillLog, "utf8");
    assert.equal(taskkillArgs, "/PID\n4545\n/T\n/F\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports app status without bash", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-app-status-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(join(envsDir, "project", "home"), { recursive: true });
    await writeFile(join(stateDir, "current_app_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "work\n", "utf8");
    await writeFile(join(stateDir, "app.pid"), "4567\n", "utf8");

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "app", "status"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          CODEX_SWITCHER_STATE_DIR: stateDir,
          CODEX_SWITCHER_ENVS_DIR: envsDir,
          CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
        },
      },
    );

    assert.match(result.stdout, /app_current: project\/work/);
    assert.match(result.stdout, /app_process: running\(pid=4567\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli supports app logout without bash", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-app-logout-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const projectHome = join(envsDir, "project", "home");

  try {
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(projectHome, { recursive: true });
    await writeFile(join(stateDir, "current_app_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "work\n", "utf8");
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-project-123456" }),
      "utf8",
    );

    const env = {
      ...process.env,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    const result = await execFileAsync(
      "npx",
      ["--yes", "tsx", "scripts/node-cli.ts", "app", "logout"],
      { cwd: repoRoot, env },
    );

    assert.match(result.stdout, /Logged out account: project\/work/);
    const appAccount = await readFile(join(stateDir, "current_app_account"), "utf8");
    assert.equal(appAccount.trim(), "default");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("node-cli tui renders the home screen in non-interactive mode", async () => {
  const result = await execFileAsync(
    "npx",
    ["--yes", "tsx", "scripts/node-cli.ts", "tui"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        TERM: "dumb",
      },
    },
  );

  assert.match(result.stdout, /https:\/\/github\.com\/wxt2rr\/codex-switcher/);
  assert.match(result.stdout, /1\.\s+Switch/);
  assert.match(result.stdout, /6\.\s+Proxy/);
  assert.match(result.stdout, /7\.\s+Setup/);
  assert.match(result.stdout, /8\.\s+Refresh/);
  assert.match(result.stdout, /9\.\s+Logs/);
  assert.match(result.stdout, /10\.\s+Gateway/);
  assert.match(result.stdout, /11\.\s+Quit/);
});

test("runNodeTuiWithDeps opens the Gateway operations page", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-gateway-tui-"));
  const writes: string[] = [];
  const keys = ["digit:10", "quit", "quit"] as const;
  let keyIndex = 0;
  try {
    await (__internal as Record<string, unknown>).runNodeTuiWithDeps({
      terminal: {
        isInteractive: true,
        colorEnabled: false,
        columns: 100,
        rows: 30,
        enter() {},
        leave() {},
        clear() {},
        async readKey() {
          return keys[keyIndex++] ?? "quit";
        },
      },
      env: {
        ...process.env,
        CODEX_SWITCHER_STATE_DIR: join(root, "state"),
        CODEX_SWITCHER_ENVS_DIR: join(root, "envs"),
        CODEX_SWITCHER_DEFAULT_HOME: join(root, "default-home"),
      },
      stdout: {
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      } as NodeJS.WriteStream,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const output = writes.join("");
  assert.match(output, /codex-sw-node - Gateway/);
  assert.match(output, /Mode: Manual account switching/);
  assert.match(output, /Toggle Mode/);
  assert.match(output, /Providers/);
  assert.match(output, /Route Groups/);
  assert.match(output, /Usage/);
  assert.match(output, /Usage \(today\): 0 requests/);
});

test("runNodeTuiWithDeps opens setup and initializes codex-sw for windows terminal", async () => {
  const writes: string[] = [];
  const keys = ["digit:7", "enter", "quit", "quit"] as const;
  let keyIndex = 0;
  let initShell = "";

  const terminal = {
    isInteractive: true,
    colorEnabled: false,
    columns: 100,
    rows: 24,
    enter() {},
    leave() {},
    clear() {},
    async readKey() {
      return keys[keyIndex++] ?? "quit";
    },
  };

  await (__internal as Record<string, unknown>).runNodeTuiWithDeps({
    terminal,
    env: {
      ...process.env,
      CODEX_SWITCHER_TEST_PLATFORM: "win32",
      CODEX_SWITCHER_WINDOWS_CLI_LAUNCHER: "wt",
    },
    getWindowsReadiness: async () => ({
      launchers: [
        { command: "wt.exe", resolved: { source: "env", path: "C:\\Tools\\wt.exe" } },
        { command: "powershell.exe", resolved: { source: "env", path: "C:\\Windows\\powershell.exe" } },
        { command: "cmd.exe", resolved: { source: "env", path: "C:\\Windows\\cmd.exe" } },
      ],
      cliCandidates: [],
      appCandidates: [],
      shellInitFiles: ["a", "b"],
    }),
    runInitForShell: async (shell: string) => {
      initShell = shell;
      return "Initialized codex-sw for windows-terminal | Run: restart Windows Terminal";
    },
    stdout: {
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    } as NodeJS.WriteStream,
  });

  assert.equal(initShell, "windows-terminal");
  assert.match(writes.join(""), /codex-sw-node - Setup/);
  assert.match(writes.join(""), /Recommended: Windows Terminal/);
  assert.match(writes.join(""), /Current launcher: Windows Terminal/);
  assert.match(writes.join(""), /Init target: .*Microsoft\.PowerShell_profile\.ps1/);
  assert.match(writes.join(""), /Enter action: initialize windows-terminal -> .*Microsoft\.PowerShell_profile\.ps1/);
  assert.match(writes.join(""), /launcher wt\.exe: ok/);
  assert.match(writes.join(""), /> Windows Terminal/);
  assert.match(
    writes.join(""),
    /Initialized codex-sw for windows-terminal -> .*Microsoft\.PowerShell_profile\.ps1 \| Run: restart Windows Terminal/,
  );
});

test("runSetupPage shows initialized yes on windows when launcher and profile block exist", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-setup-status-win-"));
  const userProfile = join(root, "User");
  const env = {
    ...process.env,
    HOME: userProfile,
    USERPROFILE: userProfile,
    CODEX_SWITCHER_TEST_PLATFORM: "win32",
    CODEX_SWITCHER_WINDOWS_CLI_LAUNCHER: "wt",
  };
  const runtime = getPlatformRuntime(env, "win32");
  const writes: string[] = [];
  const terminal = {
    isInteractive: true,
    colorEnabled: false,
    columns: 100,
    rows: 24,
    enter() {},
    leave() {},
    clear() {},
    async readKey() {
      return "quit";
    },
  };

  try {
    const launcherPath = join(userProfile, "bin", "codex-sw.cmd");
    const profilePath = runtime.shellInitFiles[1] ?? runtime.shellInitFiles[0];
    assert.ok(profilePath);
    await mkdir(dirname(profilePath), { recursive: true });
    await mkdir(dirname(launcherPath), { recursive: true });
    await writeFile(launcherPath, "@echo off\r\n", "utf8");
    await writeFile(
      profilePath,
      "# >>> codex-sw init >>>\n$env:Path = \"C:\\\\Users\\\\tester\\\\bin;$env:Path\"\n# <<< codex-sw init <<<\n",
      "utf8",
    );

    await (__internal as Record<string, unknown>).runSetupPage(terminal, {
      runtime,
      env,
      getWindowsReadiness: async () => ({
        launchers: [
          { command: "wt.exe", resolved: { source: "env", path: "C:\\Tools\\wt.exe" } },
          { command: "powershell.exe", resolved: { source: "env", path: "C:\\Windows\\powershell.exe" } },
          { command: "cmd.exe", resolved: { source: "env", path: "C:\\Windows\\cmd.exe" } },
        ],
        cliCandidates: [],
        appCandidates: [],
        shellInitFiles: runtime.shellInitFiles,
      }),
      stdout: {
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      } as NodeJS.WriteStream,
    });

    assert.match(writes.join(""), /Initialized: yes/);
    assert.doesNotMatch(writes.join(""), /Issues:/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runSetupPage shows launcher-missing diagnostics on windows", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-setup-status-win-missing-launcher-"));
  const userProfile = join(root, "User");
  const env = {
    ...process.env,
    HOME: userProfile,
    USERPROFILE: userProfile,
    CODEX_SWITCHER_TEST_PLATFORM: "win32",
    CODEX_SWITCHER_WINDOWS_CLI_LAUNCHER: "powershell",
  };
  const runtime = getPlatformRuntime(env, "win32");
  const writes: string[] = [];
  const terminal = {
    isInteractive: true,
    colorEnabled: false,
    columns: 100,
    rows: 24,
    enter() {},
    leave() {},
    clear() {},
    async readKey() {
      return "quit";
    },
  };

  try {
    const profilePath = runtime.shellInitFiles[1] ?? runtime.shellInitFiles[0];
    assert.ok(profilePath);
    await mkdir(dirname(profilePath), { recursive: true });
    await writeFile(
      profilePath,
      "# >>> codex-sw init >>>\n$env:Path = \"C:\\\\Users\\\\tester\\\\bin;$env:Path\"\n# <<< codex-sw init <<<\n",
      "utf8",
    );

    await (__internal as Record<string, unknown>).runSetupPage(terminal, {
      runtime,
      env,
      getWindowsReadiness: async () => ({
        launchers: [
          { command: "wt.exe", resolved: { source: "env", path: "C:\\Tools\\wt.exe" } },
          { command: "powershell.exe", resolved: { source: "env", path: "C:\\Windows\\powershell.exe" } },
          { command: "cmd.exe", resolved: { source: "env", path: "C:\\Windows\\cmd.exe" } },
        ],
        cliCandidates: [],
        appCandidates: [],
        shellInitFiles: runtime.shellInitFiles,
      }),
      stdout: {
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      } as NodeJS.WriteStream,
    });

    assert.match(writes.join(""), /Initialized: no/);
    assert.match(writes.join(""), /Issues: launcher missing/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runSetupPage shows per-target readiness on windows when a different shell is initialized", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-setup-status-win-targets-"));
  const userProfile = join(root, "User");
  const env = {
    ...process.env,
    HOME: userProfile,
    USERPROFILE: userProfile,
    CODEX_SWITCHER_TEST_PLATFORM: "win32",
    CODEX_SWITCHER_WINDOWS_CLI_LAUNCHER: "powershell",
  };
  const runtime = getPlatformRuntime(env, "win32");
  const writes: string[] = [];
  const terminal = {
    isInteractive: true,
    colorEnabled: false,
    columns: 100,
    rows: 24,
    enter() {},
    leave() {},
    clear() {},
    async readKey() {
      return "quit";
    },
  };

  try {
    const launcherPath = join(userProfile, "bin", "codex-sw.cmd");
    const cmdInitPath = join(userProfile, "cmd-init.bat");
    await mkdir(dirname(launcherPath), { recursive: true });
    await writeFile(launcherPath, "@echo off\r\n", "utf8");
    await writeFile(
      cmdInitPath,
      "rem >>> codex-sw init >>>\r\nset PATH=C:\\User\\bin;%PATH%\r\nrem <<< codex-sw init <<<\r\n",
      "utf8",
    );

    await (__internal as Record<string, unknown>).runSetupPage(terminal, {
      runtime,
      env,
      getWindowsReadiness: async () => ({
        launchers: [
          { command: "wt.exe", resolved: { source: "env", path: "C:\\Tools\\wt.exe" } },
          { command: "powershell.exe", resolved: { source: "env", path: "C:\\Windows\\powershell.exe" } },
          { command: "cmd.exe", resolved: { source: "env", path: "C:\\Windows\\cmd.exe" } },
        ],
        cliCandidates: [],
        appCandidates: [],
        shellInitFiles: runtime.shellInitFiles,
      }),
      stdout: {
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      } as NodeJS.WriteStream,
    });

    assert.match(writes.join(""), /Initialized: no/);
    assert.match(writes.join(""), /Issues: init block missing/);
    assert.match(writes.join(""), /Mismatch: current launcher PowerShell is not ready; target cmd is ready/);
    assert.match(writes.join(""), /target PowerShell: init block missing/);
    assert.match(writes.join(""), /target cmd: ready/);
    assert.match(writes.join(""), /Suggestion: ready target available: cmd/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runSetupPage shows init-block-missing diagnostics on unix", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-setup-status-unix-"));
  const env = {
    ...process.env,
    HOME: root,
    SHELL: "/bin/zsh",
    CODEX_SWITCHER_TEST_PLATFORM: "darwin",
  };
  const runtime = getPlatformRuntime(env, "darwin");
  const writes: string[] = [];
  const terminal = {
    isInteractive: true,
    colorEnabled: false,
    columns: 100,
    rows: 24,
    enter() {},
    leave() {},
    clear() {},
    async readKey() {
      return "quit";
    },
  };

  try {
    const launcherPath = join(root, ".local", "bin", "codex-sw");
    await mkdir(dirname(launcherPath), { recursive: true });
    await writeFile(launcherPath, "/tmp/fake-codex-switcher\n", "utf8");

    await (__internal as Record<string, unknown>).runSetupPage(terminal, {
      runtime,
      env,
      stdout: {
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      } as NodeJS.WriteStream,
    });

    assert.match(writes.join(""), /Initialized: no/);
    assert.match(writes.join(""), /Issues: init block missing/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runSetupPage shows per-target readiness on unix when another shell is initialized", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-setup-status-unix-targets-"));
  const env = {
    ...process.env,
    HOME: root,
    SHELL: "/bin/bash",
    CODEX_SWITCHER_TEST_PLATFORM: "darwin",
  };
  const runtime = getPlatformRuntime(env, "darwin");
  const writes: string[] = [];
  const terminal = {
    isInteractive: true,
    colorEnabled: false,
    columns: 100,
    rows: 24,
    enter() {},
    leave() {},
    clear() {},
    async readKey() {
      return "quit";
    },
  };

  try {
    const launcherPath = join(root, ".local", "bin", "codex-sw");
    const zshRcPath = join(root, ".zshrc");
    await mkdir(dirname(launcherPath), { recursive: true });
    await writeFile(launcherPath, "/tmp/fake-codex-switcher\n", "utf8");
    await writeFile(
      zshRcPath,
      "# >>> codex-sw init >>>\nexport PATH=\"$HOME/.local/bin:$PATH\"\n# <<< codex-sw init <<<\n",
      "utf8",
    );

    await (__internal as Record<string, unknown>).runSetupPage(terminal, {
      runtime,
      env,
      stdout: {
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      } as NodeJS.WriteStream,
    });

    assert.match(writes.join(""), /Initialized: no/);
    assert.match(writes.join(""), /Issues: init block missing/);
    assert.match(writes.join(""), /Mismatch: current launcher bash is not ready; target zsh is ready/);
    assert.match(writes.join(""), /target zsh: ready/);
    assert.match(writes.join(""), /target bash: init block missing/);
    assert.match(writes.join(""), /Suggestion: ready target available: zsh/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runSetupPage suggests initializing the recommended target when no target is ready", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-setup-status-win-suggest-init-"));
  const userProfile = join(root, "User");
  const env = {
    ...process.env,
    HOME: userProfile,
    USERPROFILE: userProfile,
    CODEX_SWITCHER_TEST_PLATFORM: "win32",
    CODEX_SWITCHER_WINDOWS_CLI_LAUNCHER: "powershell",
  };
  const runtime = getPlatformRuntime(env, "win32");
  const writes: string[] = [];
  const terminal = {
    isInteractive: true,
    colorEnabled: false,
    columns: 100,
    rows: 24,
    enter() {},
    leave() {},
    clear() {},
    async readKey() {
      return "quit";
    },
  };

  try {
    await (__internal as Record<string, unknown>).runSetupPage(terminal, {
      runtime,
      env,
      getWindowsReadiness: async () => ({
        launchers: [
          { command: "wt.exe", resolved: { source: "env", path: "C:\\Tools\\wt.exe" } },
          { command: "powershell.exe", resolved: { source: "env", path: "C:\\Windows\\powershell.exe" } },
          { command: "cmd.exe", resolved: { source: "env", path: "C:\\Windows\\cmd.exe" } },
        ],
        cliCandidates: [],
        appCandidates: [],
        shellInitFiles: runtime.shellInitFiles,
      }),
      stdout: {
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      } as NodeJS.WriteStream,
    });

    assert.match(writes.join(""), /Initialized: no/);
    assert.match(writes.join(""), /Suggestion: run init for recommended target: PowerShell/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runNodeTuiWithDeps runs one token refresh scan from the home menu", async () => {
  const writes: string[] = [];
  const keys = ["digit:8", "quit"] as const;
  let keyIndex = 0;
  let refreshCalls = 0;

  const terminal = {
    isInteractive: true,
    colorEnabled: false,
    columns: 100,
    rows: 30,
    enter() {},
    leave() {},
    clear() {},
    async readKey() {
      return keys[keyIndex++] ?? "quit";
    },
  };

  await (__internal as Record<string, unknown>).runNodeTuiWithDeps({
    terminal,
    runTokenRefreshOnce: async () => {
      refreshCalls += 1;
      return "Token refresh scan completed";
    },
    stdout: {
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    } as NodeJS.WriteStream,
  });

  assert.equal(refreshCalls, 1);
  assert.match(writes.join(""), /8\.\s+Refresh/);
  assert.match(writes.join(""), /Token refresh scan completed/);
});

test("runNodeTuiWithDeps opens the token refresh log from the home menu", async () => {
  const writes: string[] = [];
  const keys = ["digit:9", "quit", "quit"] as const;
  let keyIndex = 0;

  const terminal = {
    isInteractive: true,
    colorEnabled: false,
    columns: 100,
    rows: 12,
    enter() {},
    leave() {},
    clear() {},
    async readKey() {
      return keys[keyIndex++] ?? "quit";
    },
  };

  await (__internal as Record<string, unknown>).runNodeTuiWithDeps({
    terminal,
    readTokenRefreshLog: async () => "Summary: scanned=1 fresh=1 checked=0 refreshed=0 failed=0 relogin=0 duration=1s\nlast line",
    stdout: {
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    } as NodeJS.WriteStream,
  });

  assert.match(writes.join(""), /codex-sw-node - Token Refresh Log/);
  assert.match(writes.join(""), /Summary: scanned=1 fresh=1 checked=0 refreshed=0 failed=0 relogin=0 duration=1s/);
  assert.match(writes.join(""), /Up\/Down scroll  Esc\/q back/);
});

test("runNodeAppCommand restarts the current app via the shared runtime path", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-app-restart-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const projectHome = join(envsDir, "project", "home");
  const previousEnv = {
    CODEX_SWITCHER_STATE_DIR: process.env.CODEX_SWITCHER_STATE_DIR,
    CODEX_SWITCHER_ENVS_DIR: process.env.CODEX_SWITCHER_ENVS_DIR,
    CODEX_SWITCHER_DEFAULT_HOME: process.env.CODEX_SWITCHER_DEFAULT_HOME,
    CODEX_SWITCHER_WINDOWS_APP_LAUNCHER: process.env.CODEX_SWITCHER_WINDOWS_APP_LAUNCHER,
  };
  const stdout: string[] = [];
  let restarted:
    | {
        codexHome: string;
        stateDir: string;
      }
    | undefined;

  process.env.CODEX_SWITCHER_STATE_DIR = stateDir;
  process.env.CODEX_SWITCHER_ENVS_DIR = envsDir;
  process.env.CODEX_SWITCHER_DEFAULT_HOME = defaultHome;
  process.env.CODEX_SWITCHER_WINDOWS_APP_LAUNCHER = "wt";

  try {
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(projectHome, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "work\n", "utf8");
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "auth.json"),
      JSON.stringify({
        auth_mode: "apikey",
        OPENAI_API_KEY: "sk-project-999999",
      }),
      "utf8",
    );
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "runtime.json"),
      JSON.stringify({
        preferred_auth_method: "apikey",
        openai_base_url_mode: "custom",
        openai_base_url: "https://project.example.test/v1",
      }),
      "utf8",
    );

    const code = await __internal.runNodeAppCommand(
      ["restart-current"],
      {
        restartApp: async (input) => {
          restarted = input;
          return { pid: 7777 };
        },
        stdout: {
          write(chunk: string) {
            stdout.push(chunk);
            return true;
          },
        } as NodeJS.WriteStream,
      },
    );

    assert.equal(code, 0);
    assert.deepEqual(restarted, {
      codexHome: projectHome,
      stateDir,
    });
    assert.equal(stdout.join(""), "Opened Codex App with: project/work (launcher=direct, windows_override=wt)\n");
  } finally {
    if (previousEnv.CODEX_SWITCHER_STATE_DIR === undefined) {
      delete process.env.CODEX_SWITCHER_STATE_DIR;
    } else {
      process.env.CODEX_SWITCHER_STATE_DIR = previousEnv.CODEX_SWITCHER_STATE_DIR;
    }
    if (previousEnv.CODEX_SWITCHER_ENVS_DIR === undefined) {
      delete process.env.CODEX_SWITCHER_ENVS_DIR;
    } else {
      process.env.CODEX_SWITCHER_ENVS_DIR = previousEnv.CODEX_SWITCHER_ENVS_DIR;
    }
    if (previousEnv.CODEX_SWITCHER_DEFAULT_HOME === undefined) {
      delete process.env.CODEX_SWITCHER_DEFAULT_HOME;
    } else {
      process.env.CODEX_SWITCHER_DEFAULT_HOME = previousEnv.CODEX_SWITCHER_DEFAULT_HOME;
    }
    if (previousEnv.CODEX_SWITCHER_WINDOWS_APP_LAUNCHER === undefined) {
      delete process.env.CODEX_SWITCHER_WINDOWS_APP_LAUNCHER;
    } else {
      process.env.CODEX_SWITCHER_WINDOWS_APP_LAUNCHER = previousEnv.CODEX_SWITCHER_WINDOWS_APP_LAUNCHER;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("runNodeAppCommand stops the managed app via an injected runtime path", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-app-stop-managed-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const previousEnv = {
    CODEX_SWITCHER_STATE_DIR: process.env.CODEX_SWITCHER_STATE_DIR,
    CODEX_SWITCHER_ENVS_DIR: process.env.CODEX_SWITCHER_ENVS_DIR,
    CODEX_SWITCHER_DEFAULT_HOME: process.env.CODEX_SWITCHER_DEFAULT_HOME,
  };
  const stdout: string[] = [];
  let receivedStateDir: string | undefined;

  process.env.CODEX_SWITCHER_STATE_DIR = stateDir;
  process.env.CODEX_SWITCHER_ENVS_DIR = envsDir;
  process.env.CODEX_SWITCHER_DEFAULT_HOME = defaultHome;

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });

    const code = await __internal.runNodeAppCommand(
      ["stop-managed"],
      {
        stopManagedApp: async (input) => {
          receivedStateDir = input.stateDir;
          return true;
        },
        stdout: {
          write(chunk: string) {
            stdout.push(chunk);
            return true;
          },
        } as NodeJS.WriteStream,
      },
    );

    assert.equal(code, 0);
    assert.equal(receivedStateDir, stateDir);
    assert.equal(stdout.join(""), "Stopped managed app process\n");
  } finally {
    if (previousEnv.CODEX_SWITCHER_STATE_DIR === undefined) {
      delete process.env.CODEX_SWITCHER_STATE_DIR;
    } else {
      process.env.CODEX_SWITCHER_STATE_DIR = previousEnv.CODEX_SWITCHER_STATE_DIR;
    }
    if (previousEnv.CODEX_SWITCHER_ENVS_DIR === undefined) {
      delete process.env.CODEX_SWITCHER_ENVS_DIR;
    } else {
      process.env.CODEX_SWITCHER_ENVS_DIR = previousEnv.CODEX_SWITCHER_ENVS_DIR;
    }
    if (previousEnv.CODEX_SWITCHER_DEFAULT_HOME === undefined) {
      delete process.env.CODEX_SWITCHER_DEFAULT_HOME;
    } else {
      process.env.CODEX_SWITCHER_DEFAULT_HOME = previousEnv.CODEX_SWITCHER_DEFAULT_HOME;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("runNodeAppCommand logs out the current app target via the shared runtime path", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-app-logout-runtime-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const projectHome = join(envsDir, "project", "home");
  const previousEnv = {
    CODEX_SWITCHER_STATE_DIR: process.env.CODEX_SWITCHER_STATE_DIR,
    CODEX_SWITCHER_ENVS_DIR: process.env.CODEX_SWITCHER_ENVS_DIR,
    CODEX_SWITCHER_DEFAULT_HOME: process.env.CODEX_SWITCHER_DEFAULT_HOME,
  };
  const stdout: string[] = [];

  process.env.CODEX_SWITCHER_STATE_DIR = stateDir;
  process.env.CODEX_SWITCHER_ENVS_DIR = envsDir;
  process.env.CODEX_SWITCHER_DEFAULT_HOME = defaultHome;

  try {
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(projectHome, { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await writeFile(join(stateDir, "current_app_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "work\n", "utf8");
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-project-123456" }),
      "utf8",
    );

    const code = await __internal.runNodeAppCommand(
      ["logout"],
      {
        stdout: {
          write(chunk: string) {
            stdout.push(chunk);
            return true;
          },
        } as NodeJS.WriteStream,
      },
    );

    assert.equal(code, 0);
    assert.match(stdout.join(""), /Logged out account: project\/work/);
    const appAccount = await readFile(join(stateDir, "current_app_account"), "utf8");
    assert.equal(appAccount.trim(), "default");
  } finally {
    if (previousEnv.CODEX_SWITCHER_STATE_DIR === undefined) {
      delete process.env.CODEX_SWITCHER_STATE_DIR;
    } else {
      process.env.CODEX_SWITCHER_STATE_DIR = previousEnv.CODEX_SWITCHER_STATE_DIR;
    }
    if (previousEnv.CODEX_SWITCHER_ENVS_DIR === undefined) {
      delete process.env.CODEX_SWITCHER_ENVS_DIR;
    } else {
      process.env.CODEX_SWITCHER_ENVS_DIR = previousEnv.CODEX_SWITCHER_ENVS_DIR;
    }
    if (previousEnv.CODEX_SWITCHER_DEFAULT_HOME === undefined) {
      delete process.env.CODEX_SWITCHER_DEFAULT_HOME;
    } else {
      process.env.CODEX_SWITCHER_DEFAULT_HOME = previousEnv.CODEX_SWITCHER_DEFAULT_HOME;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("runNodeProxyCommand executes proxy test through the shared runner path", async () => {
  const stdout: string[] = [];
  let called:
    | {
        stateDir: string;
      }
    | undefined;

  const code = await __internal.runNodeProxyCommand(
    ["test"],
    {
      runProxyTest: async (input) => {
        called = input;
        return {
          exitCode: 0,
          stdout: "usage_api_proxy_test: ok (http=200, source=manual, proxy=http://127.0.0.1:7890, env/account=default/default)\n",
          stderr: "",
        };
      },
      stdout: {
        write(chunk: string) {
          stdout.push(chunk);
          return true;
        },
      } as NodeJS.WriteStream,
    },
  );

  assert.equal(code, 0);
  assert.deepEqual(called, {
    stateDir: getPlatformRuntime().paths.stateDir,
  });
  assert.match(stdout.join(""), /usage_api_proxy_test: ok/);
});

test("runNodeAccountLoginCommand supports auth mode through an injected login runner", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-login-auth-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const projectHome = join(envsDir, "project", "home");
  let called:
    | {
        codexHome: string;
      }
    | undefined;

  try {
    await mkdir(join(stateDir, "env-accounts", "project", "default"), { recursive: true });
    await mkdir(projectHome, { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "default\n", "utf8");

    const previousEnv = {
      CODEX_SWITCHER_STATE_DIR: process.env.CODEX_SWITCHER_STATE_DIR,
      CODEX_SWITCHER_ENVS_DIR: process.env.CODEX_SWITCHER_ENVS_DIR,
      CODEX_SWITCHER_DEFAULT_HOME: process.env.CODEX_SWITCHER_DEFAULT_HOME,
    };
    process.env.CODEX_SWITCHER_STATE_DIR = stateDir;
    process.env.CODEX_SWITCHER_ENVS_DIR = envsDir;
    process.env.CODEX_SWITCHER_DEFAULT_HOME = defaultHome;

    try {
      const code = await (__internal as Record<string, unknown>).runNodeAccountLoginCommand(
        ["account-login-auth", "project", "work", "both"],
        {
          authLogin: async (input: { codexHome: string }) => {
            called = input;
            await writeFile(
              join(projectHome, "auth.json"),
              JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "token-123", id_token: "id-456" } }, null, 2),
              "utf8",
            );
          },
          stdout: {
            write() {
              return true;
            },
          } as NodeJS.WriteStream,
        },
      ) as Promise<number>;

      assert.equal(code, 0);
      assert.deepEqual(called, { codexHome: projectHome });
      const authRaw = await readFile(join(stateDir, "env-accounts", "project", "work", "auth.json"), "utf8");
      assert.match(authRaw, /token-123/);
      const cliAccount = await readFile(join(stateDir, "current_cli_account"), "utf8");
      const appAccount = await readFile(join(stateDir, "current_app_account"), "utf8");
      assert.equal(cliAccount.trim(), "work");
      assert.equal(appAccount.trim(), "work");
    } finally {
      if (previousEnv.CODEX_SWITCHER_STATE_DIR === undefined) {
        delete process.env.CODEX_SWITCHER_STATE_DIR;
      } else {
        process.env.CODEX_SWITCHER_STATE_DIR = previousEnv.CODEX_SWITCHER_STATE_DIR;
      }
      if (previousEnv.CODEX_SWITCHER_ENVS_DIR === undefined) {
        delete process.env.CODEX_SWITCHER_ENVS_DIR;
      } else {
        process.env.CODEX_SWITCHER_ENVS_DIR = previousEnv.CODEX_SWITCHER_ENVS_DIR;
      }
      if (previousEnv.CODEX_SWITCHER_DEFAULT_HOME === undefined) {
        delete process.env.CODEX_SWITCHER_DEFAULT_HOME;
      } else {
        process.env.CODEX_SWITCHER_DEFAULT_HOME = previousEnv.CODEX_SWITCHER_DEFAULT_HOME;
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runNodeProxyCommand supports manual proxy set and off through shared state helpers", async () => {
  const stdout: string[] = [];
  let setValue: string | undefined;
  let cleared = false;

  const setCode = await __internal.runNodeProxyCommand(
    ["127.0.0.1:7890"],
    {
      setManualProxy: async (value) => {
        setValue = value;
        return "http://127.0.0.1:7890";
      },
      stdout: {
        write(chunk: string) {
          stdout.push(chunk);
          return true;
        },
      } as NodeJS.WriteStream,
    },
  );

  const offCode = await __internal.runNodeProxyCommand(
    ["off"],
    {
      clearManualProxy: async () => {
        cleared = true;
      },
      stdout: {
        write(chunk: string) {
          stdout.push(chunk);
          return true;
        },
      } as NodeJS.WriteStream,
    },
  );

  assert.equal(setCode, 0);
  assert.equal(offCode, 0);
  assert.equal(setValue, "127.0.0.1:7890");
  assert.equal(cleared, true);
  assert.match(stdout.join(""), /Set usage API proxy: http:\/\/127\.0\.0\.1:7890/);
  assert.match(stdout.join(""), /Manual usage API proxy disabled/);
});

test("runProxyConnectivityTest fails when no proxy is configured", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-proxy-none-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "default\n", "utf8");

    const runProxyConnectivityTest = getRunProxyConnectivityTest();
    const result = await runProxyConnectivityTest({
      stateDir,
      envsDir,
      defaultHome,
      env: {
        DISABLE_SYSTEM_PROXY_DETECT: "true",
      },
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /usage API proxy is off and no auto proxy detected/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runProxyConnectivityTest fails when the current CLI auth has no access token", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-proxy-token-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "default\n", "utf8");
    await writeFile(join(stateDir, "usage_proxy"), "127.0.0.1:7890\n", "utf8");
    await writeFile(
      join(stateDir, "env-accounts", "default", "default", "auth.json"),
      JSON.stringify({ tokens: {} }),
      "utf8",
    );

    const runProxyConnectivityTest = getRunProxyConnectivityTest();
    const result = await runProxyConnectivityTest({
      stateDir,
      envsDir,
      defaultHome,
      env: {},
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /access_token missing/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runProxyConnectivityTest reports ok when the usage endpoint returns HTTP 200", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-proxy-ok-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const server = await withUsageApiServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer token-200");
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
  });

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "default\n", "utf8");
    await writeFile(join(stateDir, "usage_proxy"), "http://127.0.0.1:7890\n", "utf8");
    await writeFile(
      join(stateDir, "env-accounts", "default", "default", "auth.json"),
      JSON.stringify({ tokens: { access_token: "token-200" } }),
      "utf8",
    );

    const runProxyConnectivityTest = getRunProxyConnectivityTest();
    const result = await runProxyConnectivityTest({
      stateDir,
      envsDir,
      defaultHome,
      env: {},
      usageEndpoint: server.endpoint,
      request: async ({ url, accessToken, proxy }) => {
        assert.equal(url, server.endpoint);
        assert.equal(accessToken, "token-200");
        assert.equal(proxy, "http://127.0.0.1:7890");
        return {
          statusCode: 200,
          bodyPreview: '{"ok":true}',
        };
      },
    });

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /usage_api_proxy_test: ok \(http=200, source=manual, proxy=http:\/\/127\.0\.0\.1:7890, env\/account=default\/default\)/);
    assert.equal(result.stderr, "");
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("runProxyConnectivityTest returns response preview when the usage endpoint fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-cli-proxy-fail-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "default\n", "utf8");
    await writeFile(join(stateDir, "usage_proxy"), "127.0.0.1:7890\n", "utf8");
    await writeFile(
      join(stateDir, "env-accounts", "default", "default", "auth.json"),
      JSON.stringify({ tokens: { access_token: "token-500" } }),
      "utf8",
    );

    const runProxyConnectivityTest = getRunProxyConnectivityTest();
    const result = await runProxyConnectivityTest({
      stateDir,
      envsDir,
      defaultHome,
      env: {},
      usageEndpoint: "https://example.test/backend-api/wham/usage",
      request: async ({ accessToken, proxy }) => {
        assert.equal(accessToken, "token-500");
        assert.equal(proxy, "http://127.0.0.1:7890");
        return {
          statusCode: 502,
          bodyPreview: '{"error":"bad gateway"}',
        };
      },
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /usage_api_proxy_test: failed \(http=502, source=manual, proxy=http:\/\/127\.0\.0\.1:7890, env\/account=default\/default\)/);
    assert.match(result.stderr, /response_preview: \{"error":"bad gateway"\}/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runAppPage dispatches stop-managed for the current app target", async () => {
  const writes: string[] = [];
  const keys = ["down", "down", "enter", "quit"] as const;
  let keyIndex = 0;
  let stopCalls = 0;
  const previousLauncher = process.env.CODEX_SWITCHER_WINDOWS_APP_LAUNCHER;

  process.env.CODEX_SWITCHER_WINDOWS_APP_LAUNCHER = "wt";

  const terminal = {
    isInteractive: true,
    colorEnabled: false,
    columns: 100,
    rows: 30,
    enter() {},
    leave() {},
    clear() {},
    async readKey() {
      return keys[keyIndex++] ?? "quit";
    },
  };

  try {
    await __internal.runAppPage(
      terminal,
      {
        getOverview() {
          return {
            envs: [{ name: "project", path: "/tmp/project-home" }],
            accounts: [],
          };
        },
        getStatus() {
          return {
            cli: {
              current: "default/default",
              auth: "-",
              authExpiry: "-",
              loginState: "unknown",
            },
            app: {
              current: "project/work",
              auth: "-",
              authExpiry: "-",
              loginState: "unknown",
            },
            tokenRefresh: {
              guard: "unknown",
              needReloginLastRun: "0",
            },
          };
        },
      } as never,
      {
        stateDir: "/tmp/codex-switcher-state",
      },
      {
        env: process.env,
        getManagedAppState: async () => ({
          lastInstanceId: "instance-2",
          instances: [
            { instanceId: "instance-2", pid: 5555 },
            { instanceId: "instance-1", pid: 4444 },
          ],
        }),
        stopManagedApp: async (input) => {
          stopCalls += 1;
          assert.equal(input.stateDir, "/tmp/codex-switcher-state");
          return true;
        },
        stdout: {
          write(chunk: string) {
            writes.push(chunk);
            return true;
          },
        } as NodeJS.WriteStream,
      },
    );

    assert.equal(stopCalls, 1);
    assert.match(writes.join(""), /Current: project\/work/);
    assert.match(writes.join(""), /Launcher: direct \(windows override: wt\)/);
    assert.match(writes.join(""), /instance-2 \(pid=5555\) \[latest\]/);
    assert.match(writes.join(""), /Stopped managed app process/);
  } finally {
    if (previousLauncher === undefined) {
      delete process.env.CODEX_SWITCHER_WINDOWS_APP_LAUNCHER;
    } else {
      process.env.CODEX_SWITCHER_WINDOWS_APP_LAUNCHER = previousLauncher;
    }
  }
});

test("runAppPage shows launcher details after launching a new app instance", async () => {
  const writes: string[] = [];
  const keys = ["down", "enter", "quit"] as const;
  let keyIndex = 0;
  let launchCalls = 0;
  const previousLauncher = process.env.CODEX_SWITCHER_WINDOWS_APP_LAUNCHER;

  process.env.CODEX_SWITCHER_WINDOWS_APP_LAUNCHER = "wt";

  const terminal = {
    isInteractive: true,
    colorEnabled: false,
    columns: 100,
    rows: 30,
    enter() {},
    leave() {},
    clear() {},
    async readKey() {
      return keys[keyIndex++] ?? "quit";
    },
  };

  try {
    await __internal.runAppPage(
      terminal,
      {
        getOverview() {
          return {
            envs: [{ name: "project", path: "/tmp/project-home" }],
            accounts: [],
          };
        },
        getStatus() {
          return {
            cli: {
              current: "default/default",
              auth: "-",
              authExpiry: "-",
              loginState: "unknown",
            },
            app: {
              current: "project/work",
              auth: "-",
              authExpiry: "-",
              loginState: "unknown",
            },
            tokenRefresh: {
              guard: "unknown",
              needReloginLastRun: "0",
            },
          };
        },
      } as never,
      {
        stateDir: "/tmp/codex-switcher-state",
      },
      {
        getManagedAppState: async () => ({
          lastInstanceId: "instance-2",
          instances: [
            { instanceId: "instance-2", pid: 5555 },
            { instanceId: "instance-1", pid: 4444 },
          ],
        }),
        launchAppNew: async (input) => {
          launchCalls += 1;
          assert.equal(input.codexHome, "/tmp/project-home");
          assert.equal(input.stateDir, "/tmp/codex-switcher-state");
          return { pid: 7777 };
        },
        stdout: {
          write(chunk: string) {
            writes.push(chunk);
            return true;
          },
        } as NodeJS.WriteStream,
      },
    );
  } finally {
    if (previousLauncher === undefined) {
      delete process.env.CODEX_SWITCHER_WINDOWS_APP_LAUNCHER;
    } else {
      process.env.CODEX_SWITCHER_WINDOWS_APP_LAUNCHER = previousLauncher;
    }
  }

  assert.equal(launchCalls, 1);
  assert.match(writes.join(""), /Launcher: direct \(windows override: wt\)/);
  assert.match(writes.join(""), /Opened Codex App with: project\/work \(launcher=direct, windows_override=wt\)/);
});

test("runProxyPage dispatches auto-detect by clearing manual proxy", async () => {
  const writes: string[] = [];
  const keys = ["enter", "quit"] as const;
  let keyIndex = 0;
  let cleared = 0;

  const terminal = {
    isInteractive: true,
    colorEnabled: false,
    columns: 100,
    rows: 30,
    enter() {},
    leave() {},
    clear() {},
    async readKey() {
      return keys[keyIndex++] ?? "quit";
    },
  };

  await __internal.runProxyPage(
    terminal,
    {
      getProxyStatus: async () => ({
        source: "manual",
        value: "http://127.0.0.1:7890",
      }),
      clearManualProxy: async () => {
        cleared += 1;
      },
      stdout: {
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      } as NodeJS.WriteStream,
    },
  );

  assert.equal(cleared, 1);
  assert.match(writes.join(""), /Current: manual \(http:\/\/127\.0\.0\.1:7890\)/);
  assert.match(writes.join(""), /Manual usage API proxy disabled/);
});

test("runProxyPage accepts manual proxy input and saves normalized value", async () => {
  const writes: string[] = [];
  const keys = ["down", "enter", "char:1", "char:2", "char:7", "char:.", "char:0", "char:.", "char:0", "char:.", "char:1", "char::", "char:7", "char:8", "char:9", "char:0", "enter", "quit"] as const;
  let keyIndex = 0;
  let savedValue = "";

  const terminal = {
    isInteractive: true,
    colorEnabled: false,
    columns: 100,
    rows: 30,
    enter() {},
    leave() {},
    clear() {},
    async readKey() {
      return keys[keyIndex++] ?? "quit";
    },
  };

  await __internal.runProxyPage(
    terminal,
    {
      getProxyStatus: async () => ({
        source: "off",
        value: "",
      }),
      clearManualProxy: async () => {},
      setManualProxy: async (value) => {
        savedValue = value;
        return "http://127.0.0.1:7890";
      },
      stdout: {
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      } as NodeJS.WriteStream,
    },
  );

  assert.equal(savedValue, "127.0.0.1:7890");
  assert.match(writes.join(""), /Enter proxy \(host:port or scheme:\/\/host:port\): 127\.0\.0\.1:7890/);
  assert.match(writes.join(""), /Set usage API proxy: http:\/\/127\.0\.0\.1:7890/);
});

test("runProxyPage supports backspace while editing manual proxy input", async () => {
  const writes: string[] = [];
  const keys = ["down", "enter", "char:1", "char:2", "char:8", "backspace", "char:7", "enter", "quit"] as const;
  let keyIndex = 0;
  let savedValue = "";

  const terminal = {
    isInteractive: true,
    colorEnabled: false,
    columns: 100,
    rows: 30,
    enter() {},
    leave() {},
    clear() {},
    async readKey() {
      return keys[keyIndex++] ?? "quit";
    },
  };

  await __internal.runProxyPage(
    terminal,
    {
      getProxyStatus: async () => ({
        source: "off",
        value: "",
      }),
      clearManualProxy: async () => {},
      setManualProxy: async (value) => {
        savedValue = value;
        return `http://${value}`;
      },
      stdout: {
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      } as NodeJS.WriteStream,
    },
  );

  assert.equal(savedValue, "127");
  assert.match(writes.join(""), /Enter proxy \(host:port or scheme:\/\/host:port\): 128/);
  assert.match(writes.join(""), /Enter proxy \(host:port or scheme:\/\/host:port\): 12/);
  assert.match(writes.join(""), /Enter proxy \(host:port or scheme:\/\/host:port\): 127/);
});

test("runProxyPage runs proxy connectivity test and shows the result", async () => {
  const writes: string[] = [];
  const keys = ["down", "down", "enter", "quit"] as const;
  let keyIndex = 0;
  let proxyTests = 0;

  const terminal = {
    isInteractive: true,
    colorEnabled: false,
    columns: 100,
    rows: 30,
    enter() {},
    leave() {},
    clear() {},
    async readKey() {
      return keys[keyIndex++] ?? "quit";
    },
  };

  await __internal.runProxyPage(
    terminal,
    {
      getProxyStatus: async () => ({
        source: "manual",
        value: "http://127.0.0.1:7890",
      }),
      clearManualProxy: async () => {},
      runProxyTest: async () => {
        proxyTests += 1;
        return {
          exitCode: 0,
          stdout:
            "usage_api_proxy_test: ok (http=200, source=manual, proxy=http://127.0.0.1:7890, env/account=default/default)\n",
          stderr: "",
        };
      },
      stdout: {
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      } as NodeJS.WriteStream,
    } as never,
  );

  assert.equal(proxyTests, 1);
  assert.match(writes.join(""), /Test Proxy/);
  assert.match(writes.join(""), /usage_api_proxy_test: ok \(http=200, source=manual, proxy=http:\/\/127\.0\.0\.1:7890, env\/account=default\/default\)/);
});

test("status screen renderer shows current targets and account details", async () => {
  const { renderStatusScreen } = await import("../packages/core/src/tui/status.js");

  const output = renderStatusScreen({
    status: {
      cli: {
        current: "default/work",
        auth: "chatgpt",
        authExpiry: "2030-01-01 00:00:00Z",
        loginState: "logged-in",
      },
      app: {
        current: "default/personal",
        auth: "apikey | base_url: https://proxy.example.test/v1",
        authExpiry: "-",
        loginState: "logged-in",
      },
      tokenRefresh: {
        guard: "unknown",
        needReloginLastRun: "1",
      },
      setup: {
        summary: "Mismatch: current launcher PowerShell is not ready; target cmd is ready",
        suggestion: "Suggestion: ready target available: cmd",
      },
    },
    accounts: [
      {
        envName: "default",
        name: "personal",
        isCurrentApp: true,
        authMode: "apikey",
        apiKeyPreview: "sk-***7890",
        runtime: {
          preferredAuthMethod: "apikey",
          openaiBaseUrl: "https://proxy.example.test/v1",
        },
      },
    ],
    viewLines: 30,
  });

  assert.match(output, /CLI \[logged-in\]/);
  assert.match(output, /APP \[logged-in\]/);
  assert.match(output, /SETUP         Mismatch: current launcher PowerShell is not ready; target cmd is ready/);
  assert.match(output, /ACTION        Suggestion: ready target available: cmd/);
  assert.match(output, /personal \[app\]/);
  assert.match(output, /api key: sk-\*\*\*7890/);
});

test("accounts screen renderer shows grouped accounts and flags", async () => {
  const { renderAccountsScreen } = await import("../packages/core/src/tui/accounts.js");

  const output = renderAccountsScreen({
    accounts: [
      {
        envName: "default",
        name: "work",
        authMode: "auth",
        isCurrentCli: true,
        runtime: {
          preferredAuthMethod: "chatgpt",
        },
      },
      {
        envName: "default",
        name: "personal",
        authMode: "apikey",
        isCurrentApp: true,
        apiKeyPreview: "sk-***7890",
        runtime: {
          preferredAuthMethod: "apikey",
          openaiBaseUrl: "https://proxy.example.test/v1",
        },
      },
    ],
    viewLines: 30,
  });

  assert.match(output, /codex-sw-node - Accounts/);
  assert.match(output, /work \[cli\]/);
  assert.match(output, /personal \[app\]/);
  assert.match(output, /api key: sk-\*\*\*7890/);
});

test("environments screen renderer shows home paths and counts", async () => {
  const { renderEnvsScreen } = await import("../packages/core/src/tui/envs.js");

  const output = renderEnvsScreen({
    envs: [
      {
        name: "default",
        path: "/tmp/default-home",
        isCurrentCli: true,
        accountCount: 2,
      },
      {
        name: "project",
        path: "/tmp/project-home",
        isCurrentApp: true,
        accountCount: 1,
      },
    ],
    viewLines: 30,
  });

  assert.match(output, /codex-sw-node - Environments/);
  assert.match(output, /default \[cli\]/);
  assert.match(output, /home: \/tmp\/default-home/);
  assert.match(output, /project \[app\]/);
});

test("switch summary renderer shows a concrete switch preview", async () => {
  const { renderSwitchSummary } = await import("../packages/core/src/tui/switch.js");

  const output = renderSwitchSummary({
    target: "cli",
    envName: "default",
    accountName: "work",
    actionLabel: "launch-cli-or-switch",
  });

  assert.match(output, /codex-sw-node - Switch/);
  assert.match(output, /Target:\s+cli/);
  assert.match(output, /Env:\s+default/);
  assert.match(output, /Account:\s+work/);
  assert.match(output, /Action:\s+launch-cli-or-switch/);
});

test("executeSwitchSelection launches codex cli after real switch", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-tui-switch-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const projectHome = join(envsDir, "project", "home");

  const previousEnv = {
    CODEX_SWITCHER_STATE_DIR: process.env.CODEX_SWITCHER_STATE_DIR,
    CODEX_SWITCHER_ENVS_DIR: process.env.CODEX_SWITCHER_ENVS_DIR,
    CODEX_SWITCHER_DEFAULT_HOME: process.env.CODEX_SWITCHER_DEFAULT_HOME,
  };

  process.env.CODEX_SWITCHER_STATE_DIR = stateDir;
  process.env.CODEX_SWITCHER_ENVS_DIR = envsDir;
  process.env.CODEX_SWITCHER_DEFAULT_HOME = defaultHome;

  let launched:
    | {
        codexHome: string;
        args?: string[];
      }
    | undefined;

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "personal"), { recursive: true });
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(projectHome, { recursive: true });

    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "personal\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "personal\n", "utf8");
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "auth.json"),
      JSON.stringify({
        auth_mode: "apikey",
        OPENAI_API_KEY: "sk-project-999999",
      }),
      "utf8",
    );
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "runtime.json"),
      JSON.stringify({
        preferred_auth_method: "apikey",
        openai_base_url_mode: "custom",
        openai_base_url: "https://project.example.test/v1",
      }),
      "utf8",
    );

    const { createCoreApi } = await import("../packages/core/src/api/core-api.js");
    const { readLegacyState } = await import("../packages/core/src/state/legacy.js");

    const initialState = await readLegacyState({
      stateDir,
      envsDir,
      defaultHome,
    });
    const api = createCoreApi({
      getState: () => initialState,
    });

    await __internal.executeSwitchSelection(
      api,
      {
        target: "cli",
        envName: "project",
        accountName: "work",
        action: "launch-cli",
        stateDir,
      },
      async (input) => {
        launched = {
          codexHome: input.codexHome,
          args: input.args,
        };
        return { exitCode: 0 };
      },
      async () => ({ pid: null }),
      async () => ({ pid: null }),
    );

    assert.equal(launched?.codexHome, projectHome);

    const pointerEnv = await readFile(join(stateDir, "current_cli_env"), "utf8");
    const pointerAccount = await readFile(join(stateDir, "current_cli_account"), "utf8");
    assert.equal(pointerEnv.trim(), "project");
    assert.equal(pointerAccount.trim(), "work");
  } finally {
    if (previousEnv.CODEX_SWITCHER_STATE_DIR === undefined) {
      delete process.env.CODEX_SWITCHER_STATE_DIR;
    } else {
      process.env.CODEX_SWITCHER_STATE_DIR = previousEnv.CODEX_SWITCHER_STATE_DIR;
    }
    if (previousEnv.CODEX_SWITCHER_ENVS_DIR === undefined) {
      delete process.env.CODEX_SWITCHER_ENVS_DIR;
    } else {
      process.env.CODEX_SWITCHER_ENVS_DIR = previousEnv.CODEX_SWITCHER_ENVS_DIR;
    }
    if (previousEnv.CODEX_SWITCHER_DEFAULT_HOME === undefined) {
      delete process.env.CODEX_SWITCHER_DEFAULT_HOME;
    } else {
      process.env.CODEX_SWITCHER_DEFAULT_HOME = previousEnv.CODEX_SWITCHER_DEFAULT_HOME;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("executeSwitchSelection launches codex app after real app switch", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-tui-app-switch-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const projectHome = join(envsDir, "project", "home");

  const previousEnv = {
    CODEX_SWITCHER_STATE_DIR: process.env.CODEX_SWITCHER_STATE_DIR,
    CODEX_SWITCHER_ENVS_DIR: process.env.CODEX_SWITCHER_ENVS_DIR,
    CODEX_SWITCHER_DEFAULT_HOME: process.env.CODEX_SWITCHER_DEFAULT_HOME,
  };

  process.env.CODEX_SWITCHER_STATE_DIR = stateDir;
  process.env.CODEX_SWITCHER_ENVS_DIR = envsDir;
  process.env.CODEX_SWITCHER_DEFAULT_HOME = defaultHome;

  let launchedHome: string | undefined;

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "personal"), { recursive: true });
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(projectHome, { recursive: true });

    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "personal\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "personal\n", "utf8");
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "auth.json"),
      JSON.stringify({
        auth_mode: "apikey",
        OPENAI_API_KEY: "sk-project-999999",
      }),
      "utf8",
    );
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "runtime.json"),
      JSON.stringify({
        preferred_auth_method: "apikey",
        openai_base_url_mode: "custom",
        openai_base_url: "https://project.example.test/v1",
      }),
      "utf8",
    );

    const { createCoreApi } = await import("../packages/core/src/api/core-api.js");
    const { readLegacyState } = await import("../packages/core/src/state/legacy.js");

    const initialState = await readLegacyState({
      stateDir,
      envsDir,
      defaultHome,
    });
    const api = createCoreApi({
      getState: () => initialState,
    });

    await __internal.executeSwitchSelection(
      api,
      {
        target: "app",
        envName: "project",
        accountName: "work",
        action: "restart-current",
        stateDir,
      },
      async () => ({ exitCode: 0 }),
      async () => ({ pid: null }),
      async (input) => {
        launchedHome = input.codexHome;
        return { pid: 4321 };
      },
    );

    assert.equal(launchedHome, projectHome);

    const pointerEnv = await readFile(join(stateDir, "current_app_env"), "utf8");
    const pointerAccount = await readFile(join(stateDir, "current_app_account"), "utf8");
    assert.equal(pointerEnv.trim(), "project");
    assert.equal(pointerAccount.trim(), "work");
  } finally {
    if (previousEnv.CODEX_SWITCHER_STATE_DIR === undefined) {
      delete process.env.CODEX_SWITCHER_STATE_DIR;
    } else {
      process.env.CODEX_SWITCHER_STATE_DIR = previousEnv.CODEX_SWITCHER_STATE_DIR;
    }
    if (previousEnv.CODEX_SWITCHER_ENVS_DIR === undefined) {
      delete process.env.CODEX_SWITCHER_ENVS_DIR;
    } else {
      process.env.CODEX_SWITCHER_ENVS_DIR = previousEnv.CODEX_SWITCHER_ENVS_DIR;
    }
    if (previousEnv.CODEX_SWITCHER_DEFAULT_HOME === undefined) {
      delete process.env.CODEX_SWITCHER_DEFAULT_HOME;
    } else {
      process.env.CODEX_SWITCHER_DEFAULT_HOME = previousEnv.CODEX_SWITCHER_DEFAULT_HOME;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("executeSwitchSelection can launch a new app instance", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-node-tui-app-launch-new-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const projectHome = join(envsDir, "project", "home");

  const previousEnv = {
    CODEX_SWITCHER_STATE_DIR: process.env.CODEX_SWITCHER_STATE_DIR,
    CODEX_SWITCHER_ENVS_DIR: process.env.CODEX_SWITCHER_ENVS_DIR,
    CODEX_SWITCHER_DEFAULT_HOME: process.env.CODEX_SWITCHER_DEFAULT_HOME,
  };

  process.env.CODEX_SWITCHER_STATE_DIR = stateDir;
  process.env.CODEX_SWITCHER_ENVS_DIR = envsDir;
  process.env.CODEX_SWITCHER_DEFAULT_HOME = defaultHome;

  let launchedHome: string | undefined;

  try {
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(projectHome, { recursive: true });

    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "default\n", "utf8");
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "auth.json"),
      JSON.stringify({
        auth_mode: "apikey",
        OPENAI_API_KEY: "sk-project-999999",
      }),
      "utf8",
    );
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "runtime.json"),
      JSON.stringify({
        preferred_auth_method: "apikey",
        openai_base_url_mode: "custom",
        openai_base_url: "https://project.example.test/v1",
      }),
      "utf8",
    );

    const { createCoreApi } = await import("../packages/core/src/api/core-api.js");
    const { readLegacyState } = await import("../packages/core/src/state/legacy.js");

    const initialState = await readLegacyState({
      stateDir,
      envsDir,
      defaultHome,
    });
    const api = createCoreApi({
      getState: () => initialState,
    });

    await __internal.executeSwitchSelection(
      api,
      {
        target: "app",
        envName: "project",
        accountName: "work",
        action: "launch-new",
        stateDir,
      },
      async () => ({ exitCode: 0 }),
      async (input) => {
        launchedHome = input.codexHome;
        return { pid: 9876 };
      },
      async () => ({ pid: null }),
    );

    assert.equal(launchedHome, projectHome);
  } finally {
    if (previousEnv.CODEX_SWITCHER_STATE_DIR === undefined) {
      delete process.env.CODEX_SWITCHER_STATE_DIR;
    } else {
      process.env.CODEX_SWITCHER_STATE_DIR = previousEnv.CODEX_SWITCHER_STATE_DIR;
    }
    if (previousEnv.CODEX_SWITCHER_ENVS_DIR === undefined) {
      delete process.env.CODEX_SWITCHER_ENVS_DIR;
    } else {
      process.env.CODEX_SWITCHER_ENVS_DIR = previousEnv.CODEX_SWITCHER_ENVS_DIR;
    }
    if (previousEnv.CODEX_SWITCHER_DEFAULT_HOME === undefined) {
      delete process.env.CODEX_SWITCHER_DEFAULT_HOME;
    } else {
      process.env.CODEX_SWITCHER_DEFAULT_HOME = previousEnv.CODEX_SWITCHER_DEFAULT_HOME;
    }
    await rm(root, { recursive: true, force: true });
  }
});
