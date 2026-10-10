import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createModelCatalogStore,
  filterModelCatalogBindings,
  normalizeCustomModelInput,
} from "./model-catalog-store.js";

const entry = {
  slug: "mimo-v2.5-pro",
  display_name: "MiMo V2.5 Pro",
  description: "Third-party model",
};

test("model catalog store persists models and many-to-many account bindings", async () => {
  const root = await mkdtemp(join(tmpdir(), "model-catalog-store-"));
  const store = createModelCatalogStore(join(root, "models.json"));

  const model = await store.saveModel({ entry });
  await store.setAccountBindings("default/default", [model.id]);
  await store.setAccountBindings("work/team", [model.id]);

  const snapshot = await store.load();
  assert.equal(snapshot.models.length, 1);
  assert.deepEqual(snapshot.accountBindings, {
    "default/default": [model.id],
    "work/team": [model.id],
  });
});

test("model catalog store rejects duplicate slugs and unknown binding ids", async () => {
  const root = await mkdtemp(join(tmpdir(), "model-catalog-store-errors-"));
  const store = createModelCatalogStore(join(root, "models.json"));
  await store.saveModel({ entry });

  await assert.rejects(
    store.saveModel({ entry: { ...entry, display_name: "Duplicate" } }),
    /already exists/,
  );
  await assert.rejects(store.setAccountBindings("default/default", ["missing"]), /not found/);
});

test("normalizer preserves advanced JSON fields and creates stable defaults", () => {
  const normalized = normalizeCustomModelInput({
    slug: "custom-model",
    display_name: "Custom Model",
    vendor_extension: { enabled: true },
  });
  assert.equal(normalized.slug, "custom-model");
  assert.deepEqual(normalized.vendor_extension, { enabled: true });
  assert.equal(normalized.default_reasoning_level, "medium");
  assert.equal(normalized.prefer_websockets, false);
  assert.ok(normalized.truncation_policy);
});

test("normalizer rejects unsupported protocols and invalid context windows", () => {
  assert.throws(() => normalizeCustomModelInput({ slug: "bad-protocol", display_name: "Bad", protocol: "xml" }), /must be one of/);
  assert.throws(() => normalizeCustomModelInput({ slug: "bad-context", display_name: "Bad", context_window: 0 }), /positive number/);
});

test("model bindings replace all account relations in one atomic update", async () => {
  const root = await mkdtemp(join(tmpdir(), "model-binding-store-"));
  const store = createModelCatalogStore(join(root, "models.json"));
  const model = await store.saveModel({ entry });
  await store.setModelBindings(model.id, ["default/one", "work/two"]);
  await store.setModelBindings(model.id, ["work/two", "work/three"]);
  assert.deepEqual((await store.load()).accountBindings, {
    "work/two": [model.id],
    "work/three": [model.id],
  });
});

test("model bindings persist per-account upstream and pool options", async () => {
  const root = await mkdtemp(join(tmpdir(), "model-binding-options-"));
  const store = createModelCatalogStore(join(root, "models.json"));
  const model = await store.saveModel({ entry });

  await store.setModelBindings(model.id, ["work/one", "work/two"], {
    "work/one": { upstreamModelId: "vendor-model-v2", priority: 2, weight: 3 },
    "work/two": { enabled: false },
  });

  const snapshot = await store.load();
  assert.equal(snapshot.accountBindingOptions?.["work/one"]?.[model.id]?.upstreamModelId, "vendor-model-v2");
  assert.equal(snapshot.accountBindingOptions?.["work/one"]?.[model.id]?.weight, 3);
  assert.equal(snapshot.accountBindingOptions?.["work/two"]?.[model.id]?.enabled, false);
});

test("model catalog binding filter hides stale account keys", () => {
  const snapshot = {
    version: 1 as const,
    models: [],
    accountBindings: {
      "default/live": ["model-1"],
      "old/missing": ["model-1"],
    },
  };

  assert.deepEqual(
    filterModelCatalogBindings(snapshot, new Set(["default/live"])).accountBindings,
    { "default/live": ["model-1"] },
  );
});

test("account model discovery persists a sanitized snapshot and creates a catalog model", async () => {
  const root = await mkdtemp(join(tmpdir(), "model-discovery-store-"));
  const path = join(root, "models.json");
  const store = createModelCatalogStore(path);

  const discovered = {
    providerModelKey: "kimi:kimi-k3",
    providerId: "kimi",
    upstreamModelId: "kimi-k3",
    displayName: "Kimi K3",
    iconKey: "kimi",
    protocols: ["chat_completions"],
    capabilities: { reasoning: true, tools: true, vision: false, streaming: true },
    source: "discovery",
    status: "available",
    secret: "sk-should-not-be-written",
  } as never;
  await store.saveAccountModelDiscovery({
    accountKey: "work/kimi",
    providerId: "kimi",
    state: "ready",
    models: [discovered],
  });

  const snapshot = await store.load();
  assert.equal(snapshot.accountModelDiscoveries?.["work/kimi"]?.models[0]?.upstreamModelId, "kimi-k3");
  assert.equal(snapshot.models[0]?.entry.slug, "kimi:kimi-k3");
  assert.equal(snapshot.models[0]?.entry.provider_model_key, "kimi:kimi-k3");
  const raw = await readFile(path, "utf8");
  assert.equal(raw.includes("sk-should-not-be-written"), false);
  assert.equal(raw.includes("OPENAI_API_KEY"), false);
});

test("account discovery reuses a matching provider preset instead of duplicating it", async () => {
  const root = await mkdtemp(join(tmpdir(), "model-discovery-preset-"));
  const store = createModelCatalogStore(join(root, "models.json"));
  const preset = await store.saveModel({ entry: { slug: "kimi-k3", display_name: "Kimi K3" } });
  await store.saveAccountModelDiscovery({
    accountKey: "work/kimi",
    providerId: "kimi",
    state: "ready",
    models: [{
      providerModelKey: "kimi:kimi-k3",
      providerId: "kimi",
      upstreamModelId: "kimi-k3",
      displayName: "Kimi K3",
      protocols: ["chat_completions"],
      capabilities: { reasoning: true, tools: true, vision: false, streaming: true },
      source: "discovery",
    }],
  });
  const snapshot = await store.load();
  assert.equal(snapshot.models.length, 1);
  assert.equal(snapshot.models[0]?.id, preset.id);
  assert.equal(snapshot.models[0]?.entry.provider_model_key, "kimi:kimi-k3");
});

test("account model discovery preserves selected history and marks missing models unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "model-discovery-lifecycle-"));
  const store = createModelCatalogStore(join(root, "models.json"));
  const model = {
    providerModelKey: "deepseek:deepseek-chat",
    providerId: "deepseek",
    upstreamModelId: "deepseek-chat",
    displayName: "DeepSeek Chat",
    protocols: ["responses"],
    capabilities: { reasoning: false, tools: true, vision: false, streaming: true },
    source: "discovery" as const,
  };

  await store.saveAccountModelDiscovery({ accountKey: "default/deepseek", providerId: "deepseek", state: "ready", models: [model] });
  const catalogModel = (await store.load()).models[0]!;
  await store.setAccountBindings("default/deepseek", [catalogModel.id]);
  await store.saveAccountModelDiscovery({
    accountKey: "default/deepseek",
    providerId: "deepseek",
    state: "ready",
    models: [],
  });

  const snapshot = await store.load();
  assert.deepEqual(snapshot.accountBindings["default/deepseek"], [catalogModel.id]);
  assert.equal(snapshot.accountModelDiscoveries?.["default/deepseek"]?.models[0]?.status, "unavailable");
});

test("provider switch migrates the selected account binding to the new provider model", async () => {
  const root = await mkdtemp(join(tmpdir(), "model-discovery-provider-switch-"));
  const store = createModelCatalogStore(join(root, "models.json"));
  const oldModel = {
    providerModelKey: "openai:qwen-plus",
    providerId: "openai",
    upstreamModelId: "qwen-plus",
    displayName: "Qwen Plus",
    protocols: ["chat_completions"],
    capabilities: { reasoning: true, tools: true, vision: false, streaming: true },
    source: "discovery" as const,
  };
  await store.saveAccountModelDiscovery({ accountKey: "test/阿里云", providerId: "openai", state: "ready", models: [oldModel] });
  const oldCatalogModel = (await store.load()).models[0]!;
  await store.setAccountBindings("test/阿里云", [oldCatalogModel.id], {
    [oldCatalogModel.id]: { upstreamModelId: "qwen-plus", priority: 3, weight: 2 },
  });

  await store.saveAccountModelDiscovery({
    accountKey: "test/阿里云",
    providerId: "qwen",
    state: "ready",
    models: [{ ...oldModel, providerModelKey: "qwen:qwen-plus", providerId: "qwen" }],
  });

  const snapshot = await store.load();
  const nextModel = snapshot.models.find((model) => model.entry.provider_model_key === "qwen:qwen-plus");
  assert.ok(nextModel);
  assert.deepEqual(snapshot.accountBindings["test/阿里云"], [nextModel.id]);
  assert.deepEqual(snapshot.accountBindingOptions?.["test/阿里云"]?.[nextModel.id], {
    upstreamModelId: "qwen-plus",
    priority: 3,
    weight: 2,
  });
  assert.equal(snapshot.accountBindings["test/阿里云"]?.includes(oldCatalogModel.id), false);
});

test("failed discovery preserves the previous models as stale", async () => {
  const root = await mkdtemp(join(tmpdir(), "model-discovery-failure-"));
  const store = createModelCatalogStore(join(root, "models.json"));
  await store.saveAccountModelDiscovery({
    accountKey: "default/account",
    providerId: "openai",
    state: "ready",
    models: [{
      providerModelKey: "openai:gpt-5",
      providerId: "openai",
      upstreamModelId: "gpt-5",
      displayName: "GPT-5",
      protocols: ["responses"],
      capabilities: { reasoning: true, tools: true, vision: true, streaming: true },
      source: "discovery",
    }],
  });
  await store.saveAccountModelDiscovery({
    accountKey: "default/account",
    providerId: "openai",
    state: "failed",
    lastError: "upstream unavailable",
  });

  const snapshot = await store.load();
  const accountSnapshot = snapshot.accountModelDiscoveries?.["default/account"];
  assert.equal(accountSnapshot?.state, "failed");
  assert.equal(accountSnapshot?.models[0]?.status, "stale");
  assert.equal(accountSnapshot?.lastError, "upstream unavailable");
});

test("removing an account clears its discovery and binding relations", async () => {
  const root = await mkdtemp(join(tmpdir(), "model-discovery-remove-"));
  const store = createModelCatalogStore(join(root, "models.json"));
  const model = await store.saveModel({ entry: { slug: "remove-me", display_name: "Remove Me" } });
  await store.setAccountBindings("work/remove", [model.id]);
  await store.saveAccountModelDiscovery({
    accountKey: "work/remove",
    providerId: "openai",
    state: "ready",
    models: [],
  });
  const snapshot = await store.removeAccountModelDiscovery("work/remove");
  assert.equal(snapshot.accountBindings["work/remove"], undefined);
  assert.equal(snapshot.accountModelDiscoveries?.["work/remove"], undefined);
  assert.equal(snapshot.models.length, 1);
});
