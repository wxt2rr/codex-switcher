import { mkdir, writeFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { readLegacyState } from "./legacy.js";

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
