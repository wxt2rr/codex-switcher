import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildAccountModelCandidates, providerIdForAccountModel } from "./account-model-exposure-utils";
import type { ModelCatalogSnapshot } from "../bridge";

const source = readFileSync(new URL("./account-model-exposure-panel.tsx", import.meta.url), "utf8");

test("account model exposure panel keeps discovery, manual models, retry, and explicit save paths", () => {
  assert.match(source, /discoverAccountModels/);
  assert.match(source, /model_source/);
  assert.match(source, /setAccountModelBindings/);
  assert.match(source, /Select visible/);
  assert.match(source, /stale/);
  assert.match(source, /providerFilter/);
  assert.match(source, /全部服务商/);
  assert.match(source, /providerOptions/);
  assert.match(source, /<Select/);
  assert.doesNotMatch(source, /<select[\s>]/);
});

function model(id: string, slug: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    entry: { slug, display_name: slug, ...extra },
    createdAt: "2026-10-09T00:00:00.000Z",
    updatedAt: "2026-10-09T00:00:00.000Z",
  };
}

test("account model candidates do not leak another account's discovered models", () => {
  const snapshot: ModelCatalogSnapshot = {
    version: 1,
    models: [
      model("chatgpt", "chatgpt:chatgpt-auto", {
        provider_id: "chatgpt",
        provider_model_key: "chatgpt:chatgpt-auto",
        model_source: "discovered",
      }),
      model("aliyun-deepseek", "openai:deepseek-v4-flash", {
        provider_id: "openai",
        provider_model_key: "openai:deepseek-v4-flash",
        model_source: "discovered",
      }),
      model("manual", "my-manual-model"),
    ],
    accountBindings: {},
    accountModelDiscoveries: {
      "test/plus-0824": {
        providerId: "chatgpt",
        state: "ready",
        models: [{
          providerModelKey: "chatgpt:chatgpt-auto",
          providerId: "chatgpt",
          upstreamModelId: "chatgpt-auto",
          displayName: "chatgpt-auto",
          protocols: ["responses"],
          capabilities: { reasoning: false, tools: true, vision: true, streaming: true },
          source: "discovery",
          status: "available",
          firstSeenAt: "2026-10-09T00:00:00.000Z",
          lastSeenAt: "2026-10-09T00:00:00.000Z",
        }],
      },
    },
  };

  const candidates = buildAccountModelCandidates(snapshot, "test/plus-0824", []);
  assert.deepEqual(candidates.map((candidate) => candidate.id).sort(), ["chatgpt", "manual"]);
});

test("provider classification trusts the current account discovery snapshot", () => {
  const discovered = model("model", "openai:renamed", {
    provider_id: "openai",
    provider_model_key: "chatgpt:chatgpt-auto",
  });
  const discovery = new Map([[
    "chatgpt:chatgpt-auto",
    {
      providerModelKey: "chatgpt:chatgpt-auto",
      providerId: "chatgpt",
      upstreamModelId: "chatgpt-auto",
      displayName: "chatgpt-auto",
      protocols: ["responses"],
      capabilities: { reasoning: false, tools: true, vision: true, streaming: true },
      source: "discovery" as const,
      status: "available" as const,
      firstSeenAt: "2026-10-09T00:00:00.000Z",
      lastSeenAt: "2026-10-09T00:00:00.000Z",
    },
  ]]);
  assert.equal(providerIdForAccountModel(discovered, discovery), "chatgpt");
});
