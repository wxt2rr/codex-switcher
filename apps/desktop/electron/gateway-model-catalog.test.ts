import test from "node:test";
import assert from "node:assert/strict";

import { buildGatewayModelCatalog, buildGatewayModelEntry, normalizeGatewayModelSlug } from "./gateway-model-catalog.js";

test("gateway model catalog namespaces provider models without slash-based slugs", () => {
  assert.equal(normalizeGatewayModelSlug("deepseek/deepseek-chat"), "deepseek:deepseek-chat");
  const entries = buildGatewayModelCatalog({
    schemaVersion: 1,
    mode: "gateway",
    gatewayId: "gateway-work",
    providers: {},
    credentials: {},
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
    providers: {},
    credentials: {},
    models: {
      internal: {
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
    providers: {},
    credentials: {},
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
