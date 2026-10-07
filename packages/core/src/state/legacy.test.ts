import { chmod, mkdir, writeFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  clearLegacyGateway,
  readLegacyGatewayV2,
  readLegacyState,
  writeLegacyGateway,
  writeLegacyGatewayV2,
} from "./legacy.js";
import { GATEWAY_SCHEMA_VERSION } from "../gateway/model.js";
import { migrateGatewayEnvironmentStateToV2 } from "../gateway/v2.js";

test("legacy reader hydrates envs, accounts, runtime settings, and target pointers", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-legacy-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "work"), { recursive: true });
    await mkdir(join(stateDir, "env-accounts", "default", "personal"), { recursive: true });
    await mkdir(join(envsDir, "project-a", "home"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });

    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "work\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "personal\n", "utf8");

    await writeFile(
      join(stateDir, "env-accounts", "default", "work", "runtime.json"),
      JSON.stringify({
        preferred_auth_method: "chatgpt",
        openai_base_url_mode: "default",
        openai_base_url: "",
        provider_id: "deepseek",
        independent_model_enabled: true,
        independent_model_provider_id: "gateway",
        independent_model_api_key: "sk-model",
        independent_model_base_url: "https://model.example/v1",
      }),
      "utf8",
    );
    await writeFile(
      join(stateDir, "env-accounts", "default", "personal", "runtime.json"),
      JSON.stringify({
        preferred_auth_method: "apikey",
        openai_base_url_mode: "custom",
        openai_base_url: "https://proxy.example.test/v1",
      }),
      "utf8",
    );

    const state = await readLegacyState({
      stateDir,
      envsDir,
      defaultHome,
      now: "2026-06-16T01:02:03.000Z",
    });

    assert.equal(state.targets.cli.account, "personal");
    assert.equal(state.targets.app.account, "personal");
    assert.equal((await readFile(join(stateDir, "current_cli_account"), "utf8")).trim(), "personal");
    assert.equal(state.envs.default.path, defaultHome);
    assert.equal(
      state.envs.default.accounts.personal.runtime.openaiBaseUrl,
      "https://proxy.example.test/v1",
    );
    assert.equal(state.envs.default.accounts.work.runtime.independentModelEnabled, true);
    assert.equal(
      state.envs.default.accounts.work.runtime.independentModelProviderId,
      "gateway",
    );
    assert.equal(
      state.envs.default.accounts.work.runtime.independentModelApiKey,
      "sk-model",
    );
    assert.equal(
      state.envs.default.accounts.work.runtime.independentModelBaseUrl,
      "https://model.example/v1",
    );
    assert.equal(state.envs.default.accounts.work.runtime.providerId, "deepseek");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy reader hydrates auth metadata from account auth.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-legacy-auth-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "personal"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });

    await writeFile(
      join(stateDir, "env-accounts", "default", "personal", "auth.json"),
      JSON.stringify({
        auth_mode: "apikey",
        OPENAI_API_KEY: "sk-test-1234567890",
      }),
      "utf8",
    );

    const state = await readLegacyState({
      stateDir,
      envsDir,
      defaultHome,
      now: "2026-06-16T01:02:03.000Z",
    });

    assert.deepEqual(state.envs.default.accounts.personal.authData, {
      auth_mode: "apikey",
      OPENAI_API_KEY: "sk-test-1234567890",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy state persists environment gateway configuration independently of account files", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-legacy-gateway-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(defaultHome, { recursive: true });
    const gateway = {
      schemaVersion: GATEWAY_SCHEMA_VERSION,
      mode: "gateway" as const,
      gatewayId: "gateway-default",
      providers: {},
      credentials: {},
      models: {},
      routeGroups: {},
      catalogVersion: 1,
    };
    await writeLegacyGateway({ stateDir, envName: "default", gateway });
    const persistedV2 = await readLegacyGatewayV2({ stateDir, envName: "default" });
    assert.equal(persistedV2?.schemaVersion, 2);
    assert.equal(persistedV2?.environmentId, "default");
    const loaded = await readLegacyState({ stateDir, envsDir, defaultHome });
    assert.deepEqual(loaded.envs.default.gateway, gateway);

    await clearLegacyGateway({ stateDir, envName: "default" });
    assert.equal(await readLegacyGatewayV2({ stateDir, envName: "default" }), undefined);
    const cleared = await readLegacyState({ stateDir, envsDir, defaultHome });
    assert.equal(cleared.envs.default.gateway, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy reader downgrades a v2-only gateway document for old consumers", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-legacy-gateway-v2-only-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(defaultHome, { recursive: true });
    const legacy = {
      schemaVersion: GATEWAY_SCHEMA_VERSION,
      mode: "gateway" as const,
      gatewayId: "gateway-default",
      providers: {},
      credentials: {},
      models: {},
      routeGroups: {},
      catalogVersion: 1,
    };
    await writeLegacyGatewayV2({
      stateDir,
      envName: "default",
      gateway: migrateGatewayEnvironmentStateToV2(legacy, "default"),
    });

    const loaded = await readLegacyState({ stateDir, envsDir, defaultHome });
    assert.deepEqual(loaded.envs.default.gateway, legacy);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy gateway writes preserve v2 environment identity and agent bindings", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-legacy-gateway-preserve-"));
  const stateDir = join(root, ".codex-switcher");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(defaultHome, { recursive: true });
    await writeLegacyGatewayV2({
      stateDir,
      envName: "default",
      gateway: {
        schemaVersion: 2,
        environmentId: "environment-default",
        revision: 7,
        sourceSchemaVersion: 2,
        mode: "gateway",
        gatewayId: "gateway-default",
        providers: {},
        credentials: {},
        models: {},
        routeGroups: {},
        agentBindings: {
          codex: {
            agentId: "codex",
            displayName: "Codex",
            gatewayId: "gateway-default",
            defaultModelId: "gpt-shared",
            originalConfigRef: "codex/config.toml",
            enabled: true,
          },
        },
        listener: { basePath: "/gateways/gateway-default", protocols: ["responses", "chat_completions", "anthropic", "gemini"] },
        catalogVersion: 1,
      },
    });

    await writeLegacyGateway({
      stateDir,
      envName: "default",
      gateway: {
        schemaVersion: GATEWAY_SCHEMA_VERSION,
        mode: "direct",
        gatewayId: "gateway-default",
        providers: {},
        credentials: {},
        models: {},
        routeGroups: {},
        catalogVersion: 1,
      },
    });

    const persisted = await readLegacyGatewayV2({ stateDir, envName: "default" });
    assert.equal(persisted?.environmentId, "environment-default");
    assert.equal(persisted?.revision, 8);
    assert.deepEqual(persisted?.agentBindings?.codex, {
      agentId: "codex",
      displayName: "Codex",
      gatewayId: "gateway-default",
      defaultModelId: "gpt-shared",
      originalConfigRef: "codex/config.toml",
      enabled: true,
    });
    assert.deepEqual(persisted?.listener, { basePath: "/gateways/gateway-default", protocols: ["responses", "chat_completions", "anthropic", "gemini"] });
    assert.equal(persisted?.mode, "direct");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy gateway dual-write restores v1 when the v2 write fails", async () => {
  if (process.platform === "win32") return;
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-legacy-gateway-rollback-"));
  const stateDir = join(root, ".codex-switcher");
  const gateway = {
    schemaVersion: GATEWAY_SCHEMA_VERSION,
    mode: "direct" as const,
    gatewayId: "gateway-default",
    providers: {},
    credentials: {},
    models: {},
    routeGroups: {},
    catalogVersion: 1,
  };

  try {
    await writeLegacyGateway({ stateDir, envName: "default", gateway });
    const legacyPath = join(stateDir, "env-gateways", "default.json");
    const v2Directory = join(stateDir, "env-gateways-v2");
    const before = await readFile(legacyPath, "utf8");
    await chmod(v2Directory, 0o500);

    await assert.rejects(
      writeLegacyGateway({ stateDir, envName: "default", gateway: { ...gateway, mode: "gateway", catalogVersion: 2 } }),
    );
    assert.equal(await readFile(legacyPath, "utf8"), before);
  } finally {
    await chmod(join(stateDir, "env-gateways-v2"), 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("clearing a legacy gateway restores v1 when v2 deletion fails", async () => {
  if (process.platform === "win32") return;
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-legacy-gateway-clear-rollback-"));
  const stateDir = join(root, ".codex-switcher");
  const gateway = {
    schemaVersion: GATEWAY_SCHEMA_VERSION,
    mode: "gateway" as const,
    gatewayId: "gateway-default",
    providers: {},
    credentials: {},
    models: {},
    routeGroups: {},
    catalogVersion: 1,
  };

  try {
    await writeLegacyGateway({ stateDir, envName: "default", gateway });
    const legacyPath = join(stateDir, "env-gateways", "default.json");
    const v2Path = join(stateDir, "env-gateways-v2", "default.json");
    await chmod(join(stateDir, "env-gateways-v2"), 0o500);

    await assert.rejects(clearLegacyGateway({ stateDir, envName: "default" }));
    assert.equal((await readFile(legacyPath, "utf8")).length > 0, true);
    assert.equal((await readFile(v2Path, "utf8")).length > 0, true);
  } finally {
    await chmod(join(stateDir, "env-gateways-v2"), 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy reader preserves nested token objects from account auth.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-legacy-auth-object-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "personal"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });

    await writeFile(
      join(stateDir, "env-accounts", "default", "personal", "auth.json"),
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: "access-token",
          refresh_token: "refresh-token",
        },
      }),
      "utf8",
    );

    const state = await readLegacyState({
      stateDir,
      envsDir,
      defaultHome,
      now: "2026-06-16T01:02:03.000Z",
    });

    assert.deepEqual(state.envs.default.accounts.personal.authData, {
      auth_mode: "chatgpt",
      tokens: {
        access_token: "access-token",
        refresh_token: "refresh-token",
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy reader prefers persisted env metadata home path overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-legacy-env-meta-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(join(envsDir, "project-a", "home"), { recursive: true });
    await mkdir(join(stateDir, "env-meta"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });

    await writeFile(
      join(stateDir, "env-meta", "project-a.json"),
      JSON.stringify({ homePath: "/tmp/custom-project-home" }),
      "utf8",
    );

    const state = await readLegacyState({
      stateDir,
      envsDir,
      defaultHome,
      now: "2026-06-16T01:02:03.000Z",
    });

    assert.equal(state.envs["project-a"]?.path, "/tmp/custom-project-home");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
