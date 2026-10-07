import test from "node:test";
import assert from "node:assert/strict";

import { buildGatewayModelCatalog, normalizeGatewayModelSlug } from "./gateway-model-catalog.js";

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
});
