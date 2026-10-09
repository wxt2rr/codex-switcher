import test from "node:test";
import assert from "node:assert/strict";

import { discoverGatewayAccountModels, discoverGatewayProviderModels } from "./gateway-model-discovery.js";
import { closeUpstreamProxyAgents } from "./upstream-proxy.js";

test("desktop gateway model discovery resolves a legacy credential and returns metadata only", async () => {
  const result = await discoverGatewayProviderModels({
    environment: {
      accounts: {
        primary: {
          name: "primary",
          authMode: "apikey",
          authData: { OPENAI_API_KEY: "secret-not-output" },
        },
      },
    },
    envName: "default",
    gateway: {
      schemaVersion: 1,
      mode: "gateway",
      gatewayId: "gateway-default",
      providers: { openai: { id: "openai", displayName: "OpenAI", kind: "openai", endpoints: { responses: "https://api.openai.com/v1" }, modelDiscovery: "models_endpoint", enabled: true } },
      credentials: { primary: { id: "primary", providerId: "openai", displayName: "primary", kind: "api_key", secretRef: "account:default:primary", supportedProtocols: ["responses"], status: "active" } },
      models: {}, routeGroups: {}, catalogVersion: 0,
    },
    providerId: "openai",
    fetchImpl: async (_url, init) => {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret-not-output");
      return new Response(JSON.stringify({ data: [{ id: "gpt-desktop-discovered" }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.equal(result.credentialsUsed, 1);
  assert.ok(result.models.some((model) => model.id === "openai/gpt-desktop-discovered"));
  assert.doesNotMatch(JSON.stringify(result), /secret-not-output/);
});

test("desktop account discovery is scoped to the selected account", async () => {
  const result = await discoverGatewayAccountModels({
    environment: {
      accounts: {
        primary: { name: "primary", authMode: "apikey", authData: { OPENAI_API_KEY: "primary-secret" } },
        other: { name: "other", authMode: "apikey", authData: { OPENAI_API_KEY: "other-secret" } },
      },
    },
    envName: "default",
    accountName: "primary",
    gateway: {
      schemaVersion: 1,
      mode: "gateway",
      gatewayId: "gateway-default",
      providers: { openai: { id: "openai", displayName: "OpenAI", kind: "openai", endpoints: { responses: "https://api.openai.com/v1" }, modelDiscovery: "models_endpoint", enabled: true } },
      credentials: {
        primary: { id: "primary", providerId: "openai", displayName: "primary", kind: "api_key", secretRef: "account:default:primary", supportedProtocols: ["responses"], status: "active" },
        other: { id: "other", providerId: "openai", displayName: "other", kind: "api_key", secretRef: "account:default:other", supportedProtocols: ["responses"], status: "active" },
      },
      models: {}, routeGroups: {}, catalogVersion: 0,
    },
    providerId: "openai",
    fetchImpl: async (_url, init) => {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer primary-secret");
      return new Response(JSON.stringify({ data: [{ id: "primary-only-model" }] }), { status: 200 });
    },
  });

  assert.equal(result.accountName, "primary");
  const ids = result.models.map((model) => model.upstreamModelId);
  assert.ok(ids.includes("primary-only-model"));
  assert.equal(ids.includes("other-only-model"), false);
});

test("desktop gateway model discovery applies provider and credential headers and filters models per credential", async () => {
  const result = await discoverGatewayProviderModels({
    environment: {
      accounts: {
        primary: {
          name: "primary",
          authMode: "apikey",
          authData: { OPENAI_API_KEY: "secret-not-output" },
        },
      },
    },
    envName: "default",
    gateway: {
      schemaVersion: 1,
      mode: "gateway",
      gatewayId: "gateway-default",
      providers: {
        openai: {
          id: "openai",
          displayName: "OpenAI",
          kind: "openai",
          endpoints: { responses: "https://api.openai.com/v1" },
          requestHeaders: { "x-provider-scope": "shared" },
          proxyUrl: "http://127.0.0.1:7890",
          modelDiscovery: "models_endpoint",
          enabled: true,
        },
      },
      credentials: {
        primary: {
          id: "primary",
          providerId: "openai",
          displayName: "primary",
          kind: "api_key",
          secretRef: "account:default:primary",
          supportedProtocols: ["responses"],
          status: "active",
          modelIds: ["allowed-model"],
          requestHeaders: { "x-credential-scope": "primary" },
          proxyUrl: "http://127.0.0.1:7891",
        },
      },
      models: {},
      routeGroups: {},
      catalogVersion: 0,
    },
    providerId: "openai",
    fetchImpl: async (_url, init) => {
      const headers = new Headers(init?.headers);
      assert.ok((init as RequestInit & { dispatcher?: unknown }).dispatcher);
      assert.equal(headers.get("x-provider-scope"), "shared");
      assert.equal(headers.get("x-credential-scope"), "primary");
      assert.equal(headers.get("authorization"), "Bearer secret-not-output");
      return new Response(JSON.stringify({ data: [{ id: "allowed-model" }, { id: "filtered-model" }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.deepEqual(result.models.map((model) => model.upstreamModelId), ["allowed-model"]);
  assert.doesNotMatch(JSON.stringify(result), /secret-not-output/);
  await closeUpstreamProxyAgents();
});

test("desktop gateway model discovery uses the environment endpoint instead of a preset endpoint", async () => {
  let requestedUrl = "";
  const result = await discoverGatewayProviderModels({
    environment: {
      accounts: {
        primary: {
          name: "primary",
          authMode: "apikey",
          authData: { OPENAI_API_KEY: "secret" },
        },
      },
    },
    envName: "default",
    gateway: {
      schemaVersion: 1,
      mode: "gateway",
      gatewayId: "gateway-default",
      providers: {
        openai: {
          id: "openai",
          displayName: "OpenAI",
          kind: "openai",
          endpoints: { chatCompletions: "https://custom.example/openai/v1" },
          modelDiscovery: "models_endpoint",
          enabled: true,
        },
      },
      credentials: { primary: { id: "primary", providerId: "openai", displayName: "primary", kind: "api_key", secretRef: "account:default:primary", supportedProtocols: ["chat_completions"], status: "active" } },
      models: {}, routeGroups: {}, catalogVersion: 0,
    },
    providerId: "openai",
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({ data: [{ id: "custom-endpoint-model" }] }), { status: 200 });
    },
  });

  assert.equal(requestedUrl, "https://custom.example/openai/v1/models");
  assert.equal(result.models[0]?.protocols.includes("chat_completions"), true);
});

test("desktop gateway model discovery resolves imported subscription tokens from provider metadata", async () => {
  const result = await discoverGatewayProviderModels({
    environment: {
      accounts: {
        subscription: {
          name: "subscription",
          authMode: "apikey",
          runtime: { providerAuthMethod: "subscription" },
          authData: { tokens: { access_token: "subscription-secret" } },
        },
      },
    },
    envName: "default",
    gateway: {
      schemaVersion: 1,
      mode: "gateway",
      gatewayId: "gateway-default",
      providers: { "claude-subscription": { id: "claude-subscription", displayName: "Claude", kind: "custom", endpoints: { anthropicMessages: "https://provider.example/v1" }, modelDiscovery: "models_endpoint", enabled: true } },
      credentials: { subscription: { id: "subscription", providerId: "claude-subscription", displayName: "subscription", kind: "api_key", secretRef: "account:default:subscription", supportedProtocols: ["anthropic"], status: "active" } },
      models: {}, routeGroups: {}, catalogVersion: 0,
    },
    providerId: "claude-subscription",
    fetchImpl: async (_url, init) => {
      assert.equal(new Headers(init?.headers).get("x-api-key"), "subscription-secret");
      return new Response(JSON.stringify({ data: [{ id: "claude-live" }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(result.credentialsUsed, 1);
  assert.ok(result.models.some((model) => model.upstreamModelId === "claude-live"));
});

test("subscription discovery falls back to provider presets when the listing endpoint is unavailable", async () => {
  const result = await discoverGatewayAccountModels({
    environment: {
      accounts: {
        subscription: {
          name: "subscription",
          authMode: "auth",
          runtime: { providerAuthMethod: "subscription" },
          authData: { tokens: { access_token: "subscription-secret" } },
        },
      },
    },
    envName: "default",
    accountName: "subscription",
    providerId: "chatgpt",
    gateway: {
      schemaVersion: 1,
      mode: "gateway",
      gatewayId: "gateway-default",
      providers: { "chatgpt": { id: "chatgpt", displayName: "ChatGPT", kind: "chatgpt", endpoints: { responses: "https://provider.example/v1" }, modelDiscovery: "models_endpoint", enabled: true } },
      credentials: { subscription: { id: "subscription", providerId: "chatgpt", displayName: "subscription", kind: "oauth", secretRef: "account:default:subscription", supportedProtocols: ["responses"], status: "active" } },
      models: {}, routeGroups: {}, catalogVersion: 0,
    },
    fetchImpl: async () => new Response("unavailable", { status: 404 }),
  });
  assert.ok(result.models.some((model) => model.upstreamModelId === "chatgpt-auto"));
});
