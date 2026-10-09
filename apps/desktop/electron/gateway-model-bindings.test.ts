import assert from "node:assert/strict";
import test from "node:test";

import { buildLegacyGatewayEnvironmentState } from "../../../packages/core/dist/gateway/legacy-adapter.js";
import type { EnvState } from "../../../packages/core/dist/state/store.js";
import { applyModelCatalogBindings, inspectGatewayModelBindings } from "./gateway-model-bindings.js";
import type { ModelCatalogSnapshot } from "./model-catalog-store.js";

function environment(): EnvState {
  return {
    name: "wangxt",
    path: "/tmp/wangxt",
    accounts: {
      alpha: {
        name: "alpha",
        authMode: "apikey",
        runtime: {
          preferredAuthMethod: "apikey",
          openaiBaseUrlMode: "custom",
          openaiBaseUrl: "https://alpha.example/v1",
          providerId: "openai",
          apiProtocol: "responses",
        },
      },
      beta: {
        name: "beta",
        authMode: "apikey",
        runtime: {
          preferredAuthMethod: "apikey",
          openaiBaseUrlMode: "custom",
          openaiBaseUrl: "https://beta.example/v1",
          providerId: "deepseek",
          apiProtocol: "responses",
        },
      },
      codex: {
        name: "codex",
        authMode: "auth",
        runtime: {
          preferredAuthMethod: "chatgpt",
          openaiBaseUrlMode: "custom",
          openaiBaseUrl: "https://chatgpt.example/backend-api/codex",
          providerId: "chatgpt",
          apiProtocol: "responses",
        },
      },
    },
  };
}

function snapshot(): ModelCatalogSnapshot {
  return {
    version: 1,
    models: [
      {
        id: "model-shared",
        entry: {
          slug: "shared-model",
          display_name: "Shared Model",
          supports_parallel_tool_calls: false,
          tool_mode: null,
          apply_patch_tool_type: "freeform",
          shell_type: "shell_command",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "model-other-env",
        entry: { slug: "other-env-model", display_name: "Other Env Model" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    accountBindings: {
      "wangxt/alpha": ["model-shared"],
      "wangxt/beta": ["model-shared"],
      "other/alpha": ["model-other-env"],
    },
    accountBindingOptions: {
      "wangxt/alpha": {
        "model-shared": { upstreamModelId: "alpha-shared", priority: 0, weight: 2 },
      },
      "wangxt/beta": {
        "model-shared": { upstreamModelId: "beta-shared", priority: 1, weight: 1 },
      },
    },
  };
}

test("model page bindings compile into an environment-scoped route group", () => {
  const env = environment();
  const result = applyModelCatalogBindings(
    env,
    buildLegacyGatewayEnvironmentState(env),
    snapshot(),
  );

  const group = Object.values(result.routeGroups).find((candidate) => candidate.exposedModelId === "shared-model");
  assert.ok(group);
  assert.equal(group.members.length, 2);
  assert.deepEqual(group.members.map((member) => member.priority), [0, 1]);
  assert.deepEqual(
    Object.values(result.models).map((model) => model.upstreamModelId).sort(),
    ["alpha-shared", "beta-shared"],
  );
  assert.equal(group.capabilities?.tools, true);
  assert.equal(Object.values(result.routeGroups).some((candidate) => candidate.exposedModelId === "other-env-model"), false);
});

test("explicitly disabled tool models remain incompatible with tool requests", () => {
  const env = environment();
  const disabled: ModelCatalogSnapshot = {
    version: 1,
    models: [{
      id: "model-disabled-tools",
      entry: {
        slug: "disabled-tools",
        display_name: "Disabled Tools",
        tools: false,
        tool_mode: "disabled",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }],
    accountBindings: { "wangxt/alpha": ["model-disabled-tools"] },
    accountBindingOptions: {
      "wangxt/alpha": { "model-disabled-tools": { upstreamModelId: "disabled-tools" } },
    },
  };

  const result = applyModelCatalogBindings(
    env,
    buildLegacyGatewayEnvironmentState(env),
    disabled,
  );
  const group = Object.values(result.routeGroups).find((candidate) => candidate.exposedModelId === "disabled-tools");
  assert.ok(group);
  assert.equal(group.capabilities?.tools, false);
});

test("unavailable discovered models are not compiled into gateway routes", () => {
  const env = environment();
  const unavailable: ModelCatalogSnapshot = {
    version: 1,
    models: [{
      id: "model-retired",
      entry: {
        slug: "openai:retired-model",
        display_name: "Retired Model",
        provider_id: "openai",
        provider_model_key: "openai:retired-model",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }],
    accountBindings: { "wangxt/alpha": ["model-retired"] },
    accountModelDiscoveries: {
      "wangxt/alpha": {
        providerId: "openai",
        state: "ready",
        models: [{
          providerModelKey: "openai:retired-model",
          providerId: "openai",
          upstreamModelId: "retired-model",
          displayName: "Retired Model",
          protocols: ["responses"],
          capabilities: { reasoning: false, tools: true, vision: false, streaming: true },
          source: "discovery",
          status: "unavailable",
          firstSeenAt: "2026-01-01T00:00:00.000Z",
          lastSeenAt: "2026-01-02T00:00:00.000Z",
        }],
      },
    },
  };
  const result = applyModelCatalogBindings(env, buildLegacyGatewayEnvironmentState(env), unavailable);
  assert.equal(Object.values(result.routeGroups).some((group) => group.exposedModelId === "openai:retired-model"), false);
});

test("bundled Codex models compile into route groups for AUTH accounts", () => {
  const env = environment();
  const result = applyModelCatalogBindings(
    env,
    buildLegacyGatewayEnvironmentState(env),
    snapshot(),
    [{
      slug: "gpt-5.6-luna",
      display_name: "GPT-5.6 Luna",
      supported_in_api: true,
      supported_reasoning_levels: [{ effort: "medium", description: "Balanced" }],
      shell_type: "shell_command",
      input_modalities: ["text", "image"],
      supports_parallel_tool_calls: true,
      tool_mode: null,
    }],
  );

  const group = Object.values(result.routeGroups).find((candidate) => candidate.exposedModelId === "gpt-5.6-luna");
  assert.ok(group);
  assert.equal(group.id, "builtin-route-group:wangxt:gpt-5.6-luna");
  assert.deepEqual(group.members.map((member) => member.credentialSelector.credentialIds), [["credential:wangxt:codex"]]);
  const model = Object.values(result.models).find((candidate) => candidate.upstreamModelId === "gpt-5.6-luna");
  assert.ok(model);
  assert.equal(model.providerId, "chatgpt");
  assert.equal(model.capabilities.vision, true);
});

test("recompiling removes stale generated bindings without removing legacy routes", () => {
  const env = environment();
  const initial = applyModelCatalogBindings(env, buildLegacyGatewayEnvironmentState(env), snapshot());
  const empty: ModelCatalogSnapshot = { version: 1, models: [], accountBindings: {} };
  const result = applyModelCatalogBindings(env, initial, empty);

  assert.equal(Object.values(result.models).some((model) => model.id.startsWith("catalog-model:")), false);
  assert.equal(Object.values(result.routeGroups).some((group) => group.id.startsWith("catalog-route-group:")), false);
});

test("one catalog model keeps the union of protocols from all bound accounts", async () => {
  const env = environment();
  env.accounts.beta.runtime.apiProtocol = "chat_completions";
  env.accounts.beta.runtime.providerId = "openai";
  const mixed = snapshot();
  mixed.accountBindingOptions!["wangxt/beta"]!["model-shared"]!.upstreamModelId = "alpha-shared";

  const result = applyModelCatalogBindings(
    env,
    buildLegacyGatewayEnvironmentState(env),
    mixed,
  );
  const model = Object.values(result.models).find((candidate) => candidate.upstreamModelId === "alpha-shared");
  assert.ok(model);
  assert.deepEqual([...model.protocols].sort(), ["chat_completions", "responses"]);
  assert.equal(result.providers.openai?.endpoints.chatCompletions, "https://beta.example/v1");
  assert.deepEqual(await inspectGatewayModelBindings(result), []);
});

test("provider-native protocols are compiled separately from the Codex ingress protocol", async () => {
  const env = environment();
  env.accounts.claude = {
    name: "claude",
    authMode: "apikey",
    runtime: {
      preferredAuthMethod: "apikey",
      openaiBaseUrlMode: "custom",
      openaiBaseUrl: "https://api.anthropic.com",
      providerId: "anthropic",
      // Codex still enters through the local Responses gateway.
      apiProtocol: "responses",
    },
  };
  const custom: ModelCatalogSnapshot = {
    version: 1,
    models: [{
      id: "claude-model",
      entry: { slug: "claude-sonnet", display_name: "Claude Sonnet", protocol: "anthropic" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }],
    accountBindings: { "wangxt/claude": ["claude-model"] },
  };
  const result = applyModelCatalogBindings(env, buildLegacyGatewayEnvironmentState(env), custom);
  const model = Object.values(result.models).find((candidate) => candidate.upstreamModelId === "claude-sonnet");
  const credential = Object.values(result.credentials).find((candidate) => candidate.displayName === "claude");
  assert.deepEqual(model?.protocols, ["anthropic"]);
  assert.equal(credential?.supportedProtocols.includes("anthropic"), true);
  assert.equal((await inspectGatewayModelBindings(result)).length, 0);
});
