import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
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
  assert.ok(normalized.truncation_policy);
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
