import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildBundledCatalogCommand, synchronizeAccountModelCatalog, synchronizeEnvironmentGatewayModelCatalog } from "./account-model-catalog.js";
import { createModelCatalogStore } from "./model-catalog-store.js";

test("account catalog merges bundled models with the account's bound custom models", async () => {
  const root = await mkdtemp(join(tmpdir(), "account-model-catalog-"));
  const store = createModelCatalogStore(join(root, "custom-models.json"));
  const custom = await store.saveModel({ entry: { slug: "custom-one", display_name: "Custom One" } });
  await store.setAccountBindings("work/alice", [custom.id]);

  const configPath = join(root, "home", "config.toml");
  await writeFile(configPath, 'preferred_auth_method = "apikey"\n', { encoding: "utf8", flag: "w" }).catch(async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, "home"), { recursive: true });
    await writeFile(configPath, 'preferred_auth_method = "apikey"\n');
  });

  const result = await synchronizeAccountModelCatalog({
    envName: "work",
    accountName: "alice",
    homePath: join(root, "home"),
    store,
    loadBundledCatalog: async () => ({ models: [{ slug: "gpt-official", display_name: "Official" }] }),
  });

  assert.equal(result.enabled, true);
  const generated = JSON.parse(await readFile(result.catalogPath!, "utf8"));
  assert.deepEqual(generated.models.map((entry: { slug: string }) => entry.slug), ["gpt-official", "custom-one"]);
  assert.ok(Array.isArray(generated.models[0].supported_reasoning_levels));
  assert.equal(generated.models[0].supported_in_api, true);
  assert.match(await readFile(configPath, "utf8"), /model_catalog_json = /);
});

test("account catalog removes model_catalog_json when the account has no bindings", async () => {
  const root = await mkdtemp(join(tmpdir(), "account-model-catalog-clear-"));
  const homePath = join(root, "home");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(homePath, { recursive: true });
  await writeFile(join(homePath, "config.toml"), 'model_catalog_json = "/old/catalog.json"\nmodel = "gpt-5.4"\n');
  const store = createModelCatalogStore(join(root, "custom-models.json"));

  const result = await synchronizeAccountModelCatalog({
    envName: "work",
    accountName: "bob",
    homePath,
    store,
    loadBundledCatalog: async () => ({ models: [] }),
  });

  assert.equal(result.enabled, false);
  const config = await readFile(join(homePath, "config.toml"), "utf8");
  assert.doesNotMatch(config, /model_catalog_json/);
  assert.match(config, /model = "gpt-5.4"/);
});

test("environment gateway catalog writes aggregated models for Codex App", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-gateway-catalog-"));
  const homePath = join(root, "home");
  const configPath = join(homePath, "config.toml");
  try {
    await mkdir(homePath, { recursive: true });
    await writeFile(configPath, 'model = "gpt-5"\n', "utf8");
    const result = await synchronizeEnvironmentGatewayModelCatalog({
      homePath,
      environmentName: "work",
      diagnosticLogPath: join(root, "switcher.log"),
      gateway: {
        schemaVersion: 1,
        mode: "gateway",
        gatewayId: "gateway-work",
        providers: { deepseek: { id: "deepseek", displayName: "DeepSeek", kind: "custom", endpoints: { responses: "https://api.deepseek.com/v1" }, modelDiscovery: "preset", enabled: true } },
        credentials: { deepseek: { id: "deepseek", providerId: "deepseek", displayName: "deepseek", kind: "api_key", secretRef: "account:default:deepseek", supportedProtocols: ["responses"], status: "active" } },
        models: {
          deepseek: {
            id: "deepseek/deepseek-chat",
            providerId: "deepseek",
            upstreamModelId: "deepseek-chat",
            displayName: "DeepSeek Chat",
            protocols: ["responses"],
            capabilities: {},
            enabled: true,
          },
        },
        routeGroups: {},
        catalogVersion: 1,
      },
      loadBundledCatalog: async () => ({ models: [{ slug: "gpt-official", display_name: "Official" }] }),
    });
    assert.equal(result.enabled, true);
    const catalog = JSON.parse(await readFile(result.catalogPath!, "utf8")) as { models: Array<{ slug: string }> };
    assert.deepEqual(catalog.models.map((model) => model.slug), ["gpt-official", "deepseek:deepseek-chat"]);
    assert.ok(Array.isArray((catalog.models[0] as Record<string, unknown>).supported_reasoning_levels));
    assert.match(await readFile(configPath, "utf8"), /model_catalog_json = .*codex-switcher-gateway-models\.json/);
    assert.match(await readFile(join(root, "switcher.log"), "utf8"), /"event":"model_catalog_sync"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("account catalog keeps custom models when Codex CLI is unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "account-model-catalog-no-cli-"));
  const store = createModelCatalogStore(join(root, "custom-models.json"));
  const custom = await store.saveModel({ entry: { slug: "custom-only", display_name: "Custom Only" } });
  await store.setAccountBindings("work/alice", [custom.id]);

  const result = await synchronizeAccountModelCatalog({
    envName: "work",
    accountName: "alice",
    homePath: join(root, "home"),
    store,
  });

  assert.equal(result.enabled, true);
  const generated = JSON.parse(await readFile(result.catalogPath!, "utf8"));
  assert.deepEqual(generated.models.map((entry: { slug: string }) => entry.slug), ["custom-only"]);
});

test("account catalog does not publish a discovered model after it becomes unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "account-model-catalog-unavailable-"));
  const store = createModelCatalogStore(join(root, "custom-models.json"));
  await store.saveAccountModelDiscovery({
    accountKey: "work/alice",
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
    }],
  });
  const model = (await store.load()).models[0]!;
  await store.setAccountBindings("work/alice", [model.id]);
  await store.saveAccountModelDiscovery({ accountKey: "work/alice", providerId: "openai", state: "ready", models: [] });

  const result = await synchronizeAccountModelCatalog({
    envName: "work",
    accountName: "alice",
    homePath: join(root, "home"),
    store,
    loadBundledCatalog: async () => ({ models: [] }),
  });
  assert.equal(result.enabled, false);
});

test("account catalog rejects custom slugs that collide with bundled models", async () => {
  const root = await mkdtemp(join(tmpdir(), "account-model-catalog-collision-"));
  const store = createModelCatalogStore(join(root, "custom-models.json"));
  const custom = await store.saveModel({ entry: { slug: "gpt-official", display_name: "Override" } });
  await store.setAccountBindings("work/alice", [custom.id]);

  await assert.rejects(
    synchronizeAccountModelCatalog({
      envName: "work",
      accountName: "alice",
      homePath: join(root, "home"),
      store,
      loadBundledCatalog: async () => ({ models: [{ slug: "gpt-official", display_name: "Official" }] }),
    }),
    /conflicts with a bundled model/,
  );
});

test("bundled catalog command wraps Windows command shims", () => {
  assert.deepEqual(buildBundledCatalogCommand("C:\\Tools\\codex.cmd", "win32"), {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", '"C:\\Tools\\codex.cmd" debug models --bundled'],
  });
});

test("DeepSeek official model preset replaces models.json with only the DeepSeek entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "account-model-catalog-deepseek-"));
  const homePath = join(root, "home");
  await mkdir(homePath, { recursive: true });
  await writeFile(
    join(homePath, "models.json"),
    JSON.stringify({ models: [{ slug: "user-model", display_name: "User Model" }] }, null, 2),
  );
  await writeFile(join(homePath, "config.toml"), 'model = "deepseek-v4-flash"\n');
  const store = createModelCatalogStore(join(root, "custom-models.json"));

  const result = await synchronizeAccountModelCatalog({
    envName: "work",
    accountName: "alice",
    homePath,
    providerId: "deepseek",
    baseUrl: "http://127.0.0.1:17832/routes/aa341ac093cfd6b261c7",
    store,
    loadBundledCatalog: async () => ({ models: [] }),
  });

  assert.equal(result.enabled, true);
  assert.equal(result.preset, "deepseek");
  const catalog = JSON.parse(await readFile(join(homePath, "models.json"), "utf8")) as {
    models: Array<Record<string, unknown>>;
  };
  assert.deepEqual(catalog.models.map((model) => model.slug), ["deepseek-v4-flash", "deepseek-v4-pro"]);
  assert.equal(catalog.models[1]?.description, "Most capable frontier agentic coding model.");
  assert.match(await readFile(join(homePath, "config.toml"), "utf8"), /model_catalog_json = .*models\.json/);
});

test("DeepSeek preset overwrites existing model entries with the official catalog", async () => {
  const root = await mkdtemp(join(tmpdir(), "account-model-catalog-deepseek-existing-"));
  const homePath = join(root, "home");
  await mkdir(homePath, { recursive: true });
  await writeFile(
    join(homePath, "models.json"),
    JSON.stringify({ models: [{ slug: "deepseek-v4-flash", display_name: "User Override" }] }, null, 2),
  );
  const store = createModelCatalogStore(join(root, "custom-models.json"));

  await synchronizeAccountModelCatalog({
    envName: "work",
    accountName: "alice",
    homePath,
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    store,
    loadBundledCatalog: async () => ({ models: [] }),
  });

  const catalog = JSON.parse(await readFile(join(homePath, "models.json"), "utf8")) as {
    models: Array<Record<string, unknown>>;
  };
  assert.equal(catalog.models.length, 2);
  assert.equal(catalog.models[0]?.slug, "deepseek-v4-flash");
  assert.equal(catalog.models[0]?.display_name, "DeepSeek-V4-Flash");
  assert.equal(catalog.models[1]?.slug, "deepseek-v4-pro");
});

test("MiMo official model preset replaces models.json with the two MiMo models", async () => {
  const root = await mkdtemp(join(tmpdir(), "account-model-catalog-mimo-"));
  const homePath = join(root, "home");
  await mkdir(homePath, { recursive: true });
  await writeFile(
    join(homePath, "models.json"),
    JSON.stringify({ models: [{ slug: "user-model", display_name: "User Model" }] }, null, 2),
  );
  const store = createModelCatalogStore(join(root, "custom-models.json"));

  const result = await synchronizeAccountModelCatalog({
    envName: "work",
    accountName: "alice",
    homePath,
    store,
    providerId: "mimo",
    baseUrl: "https://api.xiaomimimo.com/v1",
    loadBundledCatalog: async () => ({ models: [] }),
  });

  assert.equal(result.enabled, true);
  assert.equal(result.preset, "mimo");
  const catalog = JSON.parse(await readFile(join(homePath, "models.json"), "utf8")) as {
    models: Array<Record<string, unknown>>;
  };
  assert.deepEqual(catalog.models.map((model) => model.slug), ["mimo-v2.5-pro", "mimo-v2.5"]);
  assert.equal(catalog.models[0]?.priority, 0);
  assert.equal(
    catalog.models[0]?.base_instructions,
    "You are MiMo, an AI assistant developed by Xiaomi. Today's date: {date} {week}. Your knowledge cutoff date is December 2024.",
  );
  assert.match(await readFile(join(homePath, "config.toml"), "utf8"), /model_catalog_json = .*models\.json/);
});

test("a discovered account catalog follows explicit model exposure instead of the legacy provider preset", async () => {
  const root = await mkdtemp(join(tmpdir(), "account-model-catalog-explicit-exposure-"));
  const homePath = join(root, "home");
  await mkdir(homePath, { recursive: true });
  await writeFile(join(homePath, "config.toml"), 'model = "deepseek-v4-flash"\n');
  const store = createModelCatalogStore(join(root, "custom-models.json"));
  await store.saveAccountModelDiscovery({
    accountKey: "work/alice",
    providerId: "deepseek",
    state: "ready",
    models: [{
      providerModelKey: "deepseek:deepseek-v4-flash",
      providerId: "deepseek",
      upstreamModelId: "deepseek-v4-flash",
      displayName: "DeepSeek V4 Flash",
      protocols: ["chat_completions"],
      capabilities: { reasoning: false, tools: true, vision: false, streaming: true },
      source: "discovery",
    }, {
      providerModelKey: "deepseek:deepseek-v4-pro",
      providerId: "deepseek",
      upstreamModelId: "deepseek-v4-pro",
      displayName: "DeepSeek V4 Pro",
      protocols: ["chat_completions"],
      capabilities: { reasoning: true, tools: true, vision: false, streaming: true },
      source: "discovery",
    }],
  });
  const snapshot = await store.load();
  const flash = snapshot.models.find((model) => model.entry.provider_model_key === "deepseek:deepseek-v4-flash")!;
  await store.setAccountBindings("work/alice", [flash.id]);

  const result = await synchronizeAccountModelCatalog({
    envName: "work",
    accountName: "alice",
    homePath,
    providerId: "deepseek",
    baseUrl: "https://api.deepseek.com",
    store,
    loadBundledCatalog: async () => ({ models: [] }),
  });
  const generated = JSON.parse(await readFile(result.catalogPath!, "utf8")) as { models: Array<{ slug: string }> };
  assert.deepEqual(generated.models.map((model) => model.slug), ["deepseek:deepseek-v4-flash"]);
});
