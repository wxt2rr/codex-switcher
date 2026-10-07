import assert from "node:assert/strict";
import test from "node:test";

import { buildLegacyGatewayEnvironmentState } from "../../../packages/core/dist/gateway/legacy-adapter.js";
import type { EnvState } from "../../../packages/core/dist/state/store.js";
import { applyModelCatalogBindings } from "./gateway-model-bindings.js";
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
    },
  };
}

function snapshot(): ModelCatalogSnapshot {
  return {
    version: 1,
    models: [
      {
        id: "model-shared",
        entry: { slug: "shared-model", display_name: "Shared Model" },
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
  assert.equal(Object.values(result.routeGroups).some((candidate) => candidate.exposedModelId === "other-env-model"), false);
});

test("recompiling removes stale generated bindings without removing legacy routes", () => {
  const env = environment();
  const initial = applyModelCatalogBindings(env, buildLegacyGatewayEnvironmentState(env), snapshot());
  const empty: ModelCatalogSnapshot = { version: 1, models: [], accountBindings: {} };
  const result = applyModelCatalogBindings(env, initial, empty);

  assert.equal(Object.values(result.models).some((model) => model.id.startsWith("catalog-model:")), false);
  assert.equal(Object.values(result.routeGroups).some((group) => group.id.startsWith("catalog-route-group:")), false);
});
