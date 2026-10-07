import test from "node:test";
import assert from "node:assert/strict";

import { discoverGatewayProviderModels } from "./gateway-model-discovery.js";
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
