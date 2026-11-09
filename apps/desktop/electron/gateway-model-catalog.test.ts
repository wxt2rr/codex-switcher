import test from "node:test";
import assert from "node:assert/strict";

import { buildGatewayModelCatalog, buildGatewayModelEntry, normalizeGatewayModelSlug } from "./gateway-model-catalog.js";

test("gateway model catalog namespaces provider models without slash-based slugs", () => {
  assert.equal(normalizeGatewayModelSlug("deepseek/deepseek-chat"), "deepseek:deepseek-chat");
  const entries = buildGatewayModelCatalog({
    schemaVersion: 1,
    mode: "gateway",
    gatewayId: "gateway-work",
    providers: { deepseek: { id: "deepseek", displayName: "DeepSeek", kind: "custom", endpoints: { responses: "https://api.deepseek.com/v1" }, modelDiscovery: "preset", enabled: true } },
    credentials: { deepseek: { id: "credential-deepseek", providerId: "deepseek", displayName: "DeepSeek", kind: "api_key", secretRef: "secure/deepseek", supportedProtocols: ["responses"], status: "active" } },
    models: {
      deepseek: {
        id: "deepseek/deepseek-chat",
        providerId: "deepseek",
        upstreamModelId: "deepseek-chat",
        displayName: "DeepSeek Chat",
        protocols: ["responses"],
        capabilities: { tools: true },
        enabled: true,
      },
    },
    routeGroups: {
      coding: {
        id: "coding",
        displayName: "Coding Route",
        exposedModelId: "group/coding",
        members: [],
        strategy: "smart",
        sessionPolicy: "auto",
        fallbackEnabled: true,
      },
    },
    catalogVersion: 1,
  });
  assert.deepEqual(entries.map((entry) => entry.slug), ["deepseek:deepseek-chat"]);
  assert.equal(entries[0]?.default_reasoning_level, "medium");
  assert.deepEqual(
    (entries[0]?.supported_reasoning_levels as Array<{ effort: string }>).map((level) => level.effort),
    ["low", "medium", "high"],
  );
  assert.equal(entries[0]?.shell_type, "shell_command");
  assert.equal(entries[0]?.prefer_websockets, false);
  assert.deepEqual(entries[0]?.truncation_policy, { mode: "bytes", limit: 10000 });
});

test("gateway model catalog exposes a grouped model once instead of exposing internal members", () => {
  const entries = buildGatewayModelCatalog({
    schemaVersion: 1,
    mode: "gateway",
    gatewayId: "gateway-work",
    providers: { openai: { id: "openai", displayName: "OpenAI", kind: "openai", endpoints: { responses: "https://api.openai.com/v1" }, modelDiscovery: "models_endpoint", enabled: true } },
    credentials: { "credential-a": { id: "credential-a", providerId: "openai", displayName: "OpenAI", kind: "api_key", secretRef: "secure/openai", supportedProtocols: ["responses"], status: "active" } },
    models: {
      "catalog-model:internal": {
        id: "catalog-model:internal",
        providerId: "openai",
        upstreamModelId: "vendor-model",
        displayName: "Vendor Model",
        protocols: ["responses"],
        capabilities: {},
        enabled: true,
      },
    },
    routeGroups: {
      model: {
        id: "catalog-route-group:model",
        displayName: "Shared Vendor Model",
        exposedModelId: "shared-vendor-model",
        members: [{
          providerId: "openai",
          modelId: "catalog-model:internal",
          credentialSelector: { credentialIds: ["credential-a"] },
          priority: 0,
          weight: 1,
        }],
        strategy: "smart",
        sessionPolicy: "auto",
        fallbackEnabled: true,
      },
    },
    catalogVersion: 1,
  });

  assert.deepEqual(entries.map((entry) => entry.slug), ["shared-vendor-model"]);
});

test("gateway model catalog preserves the bound model metadata for a route group", () => {
  const entries = buildGatewayModelCatalog(
    {
      schemaVersion: 1,
      mode: "gateway",
      gatewayId: "gateway-work",
      providers: {
        ckt: {
          id: "ckt",
          displayName: "ckt-aicode",
          kind: "custom",
          endpoints: { responses: "https://aicode.ckt.cn/v1" },
          modelDiscovery: "manual",
          enabled: true,
        },
      },
      credentials: {
        ckt: {
          id: "ckt",
          providerId: "ckt",
          displayName: "ckt-aicode",
          kind: "api_key",
          secretRef: "account:work:ckt-aicode",
          supportedProtocols: ["responses"],
          status: "active",
        },
      },
      models: {
        internal: {
          id: "internal",
          providerId: "ckt",
          upstreamModelId: "gpt-6.1-sol",
          displayName: "ckt-aicode:6.1-sol",
          protocols: ["responses"],
          capabilities: { reasoning: true, tools: true, vision: false, streaming: true },
          enabled: true,
        },
      },
      routeGroups: {
        route: {
          id: "catalog-route-group:work:ckt-6.1-sol",
          displayName: "ckt-aicode:6.1-sol",
          exposedModelId: "custom-openai:aicode.ckt.cn:gpt-6.1-sol",
          members: [{
            providerId: "ckt",
            modelId: "internal",
            credentialSelector: { credentialIds: ["ckt"] },
            priority: 0,
            weight: 1,
          }],
          strategy: "smart",
          sessionPolicy: "auto",
          fallbackEnabled: true,
        },
      },
      catalogVersion: 1,
    },
    {
      version: 1,
      models: [{
        id: "custom-model-6.1-sol",
        entry: {
          slug: "custom-openai:aicode.ckt.cn:gpt-6.1-sol",
          display_name: "gpt-6.1-sol",
          provider_id: "custom-openai:aicode.ckt.cn",
          upstream_model_id: "gpt-6.1-sol",
          context_window: 275000,
          max_context_window: 825000,
          effective_context_window_percent: 95,
          input_modalities: ["text"],
          model_messages: { persistent_instructions: "custom instructions" },
          truncation_policy: { mode: "tokens", limit: 16000 },
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
      accountBindings: {},
    },
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.context_window, 275000);
  assert.equal(entries[0]?.max_context_window, 825000);
  assert.deepEqual(entries[0]?.input_modalities, ["text"]);
  assert.deepEqual(entries[0]?.model_messages, { persistent_instructions: "custom instructions" });
  assert.deepEqual(entries[0]?.truncation_policy, { mode: "tokens", limit: 16000 });
  assert.equal(entries[0]?.display_name, "ckt-aicode:6.1-sol");
  assert.equal(entries[0]?.description, "Gateway route group · smart");
  assert.equal(entries[0]?.prefer_websockets, false);
});

test("gateway model entries use the complete Codex model catalog shape", () => {
  const entry = buildGatewayModelEntry({
    id: "catalog-model:openai:gpt-5",
    providerId: "openai",
    upstreamModelId: "gpt-5",
    displayName: "GPT-5",
    protocols: ["responses"],
    capabilities: { reasoning: true, tools: true, vision: true, streaming: true },
    enabled: true,
  });

  for (const field of [
    "default_reasoning_level",
    "supported_reasoning_levels",
    "shell_type",
    "visibility",
    "supported_in_api",
    "truncation_policy",
    "context_window",
    "max_context_window",
    "input_modalities",
  ]) {
    assert.ok(field in entry, `missing ${field}`);
  }
});

test("bundled Codex route groups do not duplicate the bundled model catalog", () => {
  const entries = buildGatewayModelCatalog({
    schemaVersion: 1,
    mode: "gateway",
    gatewayId: "gateway-work",
    providers: { chatgpt: { id: "chatgpt", displayName: "ChatGPT", kind: "chatgpt", endpoints: { responses: "https://chatgpt.com/backend-api/codex" }, modelDiscovery: "preset", enabled: true } },
    credentials: { credential: { id: "credential", providerId: "chatgpt", displayName: "ChatGPT", kind: "auth", secretRef: "secure/chatgpt", supportedProtocols: ["responses"], status: "active" } },
    models: {
      builtin: {
        id: "builtin-model:work:gpt-5.6-luna:chatgpt",
        providerId: "chatgpt",
        upstreamModelId: "gpt-5.6-luna",
        displayName: "GPT-5.6 Luna",
        protocols: ["responses"],
        capabilities: { reasoning: true, tools: true, vision: true, streaming: true },
        enabled: true,
      },
    },
    routeGroups: {
      builtin: {
        id: "builtin-route-group:work:gpt-5.6-luna",
        displayName: "GPT-5.6 Luna",
        exposedModelId: "gpt-5.6-luna",
        members: [{
          providerId: "chatgpt",
          modelId: "builtin-model:work:gpt-5.6-luna:chatgpt",
          credentialSelector: { credentialIds: ["credential"] },
          priority: 0,
          weight: 1,
        }],
        strategy: "smart",
        sessionPolicy: "auto",
        fallbackEnabled: true,
      },
    },
    catalogVersion: 1,
  });

  assert.deepEqual(entries, []);
});
