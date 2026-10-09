import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { BUILT_IN_PROVIDER_IDS, canonicalProviderDefinitions, createBuiltInProviderAdapters, createProviderAdapter, normalizeBuiltInProviderId, type ProviderHttpClient } from "./adapters.js";
import type { JsonObject } from "../protocol.js";
import { ProviderRegistry } from "./registry.js";

test("provider registry covers API key, local, OAuth and subscription providers", () => {
  assert.equal(new Set(BUILT_IN_PROVIDER_IDS).size, BUILT_IN_PROVIDER_IDS.length);
  const registry = new ProviderRegistry();
  assert.equal(registry.list().length, BUILT_IN_PROVIDER_IDS.length);
  assert.ok(registry.get("openai").authMethods.includes("api_key"));
  assert.ok(registry.get("qianfan").authMethods.includes("api_key"));
  assert.ok(registry.get("nvidia-nim").authMethods.includes("api_key"));
  assert.ok(registry.get("ollama").authMethods.includes("none"));
  assert.equal(registry.get("qianfan").category, "api");
  assert.equal(registry.get("ollama").category, "local");
  assert.equal(registry.get("chatgpt-subscription").category, "subscription");
  assert.equal(registry.get("chatgpt-subscription").iconKey, "openai");
  assert.ok(registry.get("chatgpt").authMethods.includes("subscription"));
  assert.ok(registry.get("claude-subscription").authMethods.includes("oauth"));
});

test("canonical provider catalog covers the complete cloud, local, custom and subscription surface", () => {
  const ids = new Set(canonicalProviderDefinitions().map((definition) => definition.id));
  for (const id of [
    "anthropic", "openai", "gemini", "deepseek", "moonshot", "zhipu", "minimax", "stepfun", "qwen",
    "qianfan", "tencent-cloud", "huawei-maas", "volcengine-ark", "mistral", "groq", "xai", "openrouter",
    "together", "fireworks", "siliconflow", "nvidia-nim", "modelscope", "ollama", "lmstudio", "custom-openai",
    "custom-anthropic", "chatgpt-subscription", "claude-subscription", "copilot-subscription", "gemini-subscription",
    "grok-subscription", "cursor-subscription", "devin-subscription",
  ] as const) assert.ok(ids.has(id), `missing canonical provider ${id}`);
  assert.equal(normalizeBuiltInProviderId("kimi"), "moonshot");
  assert.equal(normalizeBuiltInProviderId("glm"), "zhipu");
  assert.equal(normalizeBuiltInProviderId("codex-subscription"), "chatgpt-subscription");
  assert.equal(canonicalProviderDefinitions().every((definition) => definition.iconKey), true);
});

test("provider adapter performs stateful login and model discovery without storing plaintext in the account ref", async () => {
  const adapter = createBuiltInProviderAdapters(() => "state-1").get("openai")!;
  const login = adapter.beginLogin("http://127.0.0.1/callback", 1000);
  assert.equal(login.state, "state-1");
  assert.match(login.authorizationUrl, /state=state-1/);
  const credential = adapter.completeLogin({ state: "state-1", expectedState: "state-1", code: "oauth-code", accountId: "a1" });
  assert.equal(credential.account.secretRef, "provider/openai/a1");
  assert.equal(credential.account.status, "active");
  const client: ProviderHttpClient = {
    async request(url, init, context) {
      assert.equal(context?.accountId, "a1");
      assert.equal(context?.proxyUrl, "http://127.0.0.1:7890");
      assert.equal(init.headers.get("authorization"), "Bearer secret");
      return { status: 200, headers: new Headers(), async json() { return { data: [{ id: "new-model" }] }; } };
    },
  };
  const models = await adapter.discoverModels(client, { ...credential.account, proxyUrl: "http://127.0.0.1:7890" }, "secret");
  assert.ok(models.some((model) => model.id === "new-model"));
  assert.ok(models.some((model) => model.id === "gpt-5"));
});

test("provider lifecycle refreshes and revokes credentials without persisting secrets", async () => {
  const adapter = createBuiltInProviderAdapters().get("chatgpt")!;
  const account = { accountId: "a1", displayName: "A1", authMethod: "oauth" as const, secretRef: "provider/chatgpt/a1", status: "expired" as const };
  let refreshBody = "";
  let revokeBody = "";
  const client: ProviderHttpClient = {
    async request(_url, init) {
      if (init.method === "POST" && init.headers.get("content-type")?.includes("form-urlencoded")) {
        if (init.body?.includes("grant_type")) { refreshBody = init.body; return { status: 200, headers: new Headers(), async json() { return { access_token: "access-secret", refresh_token: "next-refresh", expires_in: 120 }; } }; }
        revokeBody = init.body ?? "";
      }
      return { status: 204, headers: new Headers(), async json() { return {}; } };
    },
  };
  const refreshed = await adapter.refresh(client, account, "refresh-secret", 1_000);
  assert.equal(refreshed.accessToken, "access-secret");
  assert.equal(refreshed.refreshToken, "next-refresh");
  assert.equal(refreshed.account.secretRef, account.secretRef);
  assert.equal(refreshed.account.expiresAt, 121_000);
  assert.match(refreshBody, /refresh_token=refresh-secret/);
  await adapter.revoke(client, refreshed.account, "access-secret");
  assert.match(revokeBody, /token=access-secret/);
});

test("provider signing and error classification produce transport-ready requests", () => {
  const adapter = createBuiltInProviderAdapters().get("anthropic")!;
  const account = { accountId: "a", displayName: "A", authMethod: "api_key" as const, secretRef: "secret-ref", status: "active" as const };
  const signed = adapter.signRequest({ account, secret: "secret", protocol: "anthropic", url: "https://example.test/v1/messages", method: "POST", body: "{}" });
  assert.equal(signed.init.headers.get("x-api-key"), "secret");
  assert.equal(signed.init.headers.get("content-type"), "application/json");
  assert.equal(adapter.classifyError({ status: 429 }), "rate_limit");
  assert.equal(adapter.classifyError({ status: 401 }), "unauthorized");
  assert.equal(adapter.classifyError({ message: "context too long" }), "validation");
  assert.equal(adapter.classifyError({ status: 503 }), "upstream_5xx");
});

test("provider adapters apply protocol-specific authorization headers", () => {
  const adapters = createBuiltInProviderAdapters();
  const anthropic = adapters.get("anthropic")!.authorizationHeaders({ accountId: "a", displayName: "a", authMethod: "api_key", secretRef: "ref", status: "active" }, "secret", "anthropic");
  assert.equal(anthropic.get("x-api-key"), "secret");
  assert.equal(anthropic.get("anthropic-version"), "2023-06-01");
  const gemini = adapters.get("gemini")!.authorizationHeaders({ accountId: "a", displayName: "a", authMethod: "api_key", secretRef: "ref", status: "active" }, "secret", "gemini");
  assert.equal(gemini.get("x-goog-api-key"), "secret");
});

test("provider adapter lifecycle works through a real local HTTP transport", async () => {
  const requests: Array<{ method: string; path: string; authorization: string | null; body: string }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: request.method ?? "", path: request.url ?? "", authorization: request.headers.authorization ?? null, body });
      response.setHeader("content-type", "application/json");
      if (request.method === "GET" && request.url === "/v1/models") {
        response.writeHead(200);
        response.end(JSON.stringify({ data: [{ id: "local-live-model" }] }));
        return;
      }
      if (request.method === "GET" && request.url === "/v1/quota") {
        response.writeHead(200);
        response.end(JSON.stringify({ requests_remaining: 7, tokens_remaining: 800, reset_at: 123_456, plan: "local-pro" }));
        return;
      }
      if (request.method === "POST" && request.url === "/v1/oauth/token") {
        response.writeHead(200);
        response.end(JSON.stringify({ access_token: "next-access", refresh_token: "next-refresh", expires_in: 120 }));
        return;
      }
      if (request.method === "POST" && request.url === "/v1/oauth/revoke") {
        response.writeHead(204);
        response.end();
        return;
      }
      response.writeHead(404);
      response.end(JSON.stringify({ error: "not found" }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const adapter = createProviderAdapter({
      id: "custom",
      displayName: "Local Test Provider",
      authMethods: ["oauth"],
      endpoints: [{ protocol: "chat_completions", baseUrl: `http://127.0.0.1:${address.port}/v1`, modelsPath: "/models", quotaPath: "/quota" }],
      presets: [],
      refreshPath: "/oauth/token",
      revokePath: "/oauth/revoke",
    });
    const account = { accountId: "local-account", displayName: "Local Account", authMethod: "oauth" as const, secretRef: "provider/custom/local-account", status: "active" as const };
    const client: ProviderHttpClient = {
      async request(url, init) {
        const response = await fetch(url, init);
        return { status: response.status, headers: response.headers, async json() { return await response.json() as JsonObject; } };
      },
    };

    const models = await adapter.discoverModels(client, account, "live-secret");
    assert.deepEqual(models.map((model) => model.id), ["local-live-model"]);
    const quota = await adapter.readQuota(client, account, "live-secret");
    assert.deepEqual(quota && { requestsRemaining: quota.requestsRemaining, tokensRemaining: quota.tokensRemaining, plan: quota.plan }, { requestsRemaining: 7, tokensRemaining: 800, plan: "local-pro" });
    const refreshed = await adapter.refresh(client, account, "old-refresh", 1_000);
    assert.equal(refreshed.accessToken, "next-access");
    assert.equal(refreshed.refreshToken, "next-refresh");
    await adapter.revoke(client, refreshed.account, refreshed.accessToken);

    assert.deepEqual(requests.map(({ method, path }) => ({ method, path })), [
      { method: "GET", path: "/v1/models" },
      { method: "GET", path: "/v1/quota" },
      { method: "POST", path: "/v1/oauth/token" },
      { method: "POST", path: "/v1/oauth/revoke" },
    ]);
    assert.equal(requests[0]?.authorization, "Bearer live-secret");
    assert.equal(requests[1]?.authorization, "Bearer live-secret");
    assert.match(requests[2]?.body ?? "", /grant_type=refresh_token/);
    assert.match(requests[2]?.body ?? "", /refresh_token=old-refresh/);
    assert.equal(requests[3]?.authorization, "Bearer next-access");
    assert.match(requests[3]?.body ?? "", /token=next-access/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
