import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SCHEMA_VERSION, type SwitcherState } from "../state/store.js";
import { applyTargetHomeState, clearTargetHomeState } from "./target-home.js";

test("target-home writer installs auth.json and managed config for apikey account", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-target-home-"));
  const homePath = join(root, "home");

  const state: SwitcherState = {
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    generatedAt: "2026-06-16T10:00:00.000Z",
    targets: {
      cli: { env: "default", account: "personal" },
      app: { env: "default", account: "default" },
    },
    envs: {
      default: {
        name: "default",
        path: homePath,
        accounts: {
          personal: {
            name: "personal",
            authMode: "apikey",
            runtime: {
              preferredAuthMethod: "apikey",
              openaiBaseUrlMode: "custom",
              openaiBaseUrl: "https://proxy.example.test/v1",
            },
            authData: {
              OPENAI_API_KEY: "sk-test-123",
            },
          },
        },
      },
    },
    tasks: { recent: [] },
  };

  try {
    await applyTargetHomeState({
      state,
      target: "cli",
    });

    const auth = JSON.parse(await readFile(join(homePath, "auth.json"), "utf8")) as Record<
      string,
      string
    >;
    assert.equal(auth.OPENAI_API_KEY, "sk-test-123");

    const config = await readFile(join(homePath, "config.toml"), "utf8");
    assert.match(config, /preferred_auth_method = "apikey"/);
    assert.match(config, /openai_base_url = "https:\/\/proxy\.example\.test\/v1"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("target-home writer appends managed custom model config for auth account when enabled", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-target-home-custom-model-"));
  const homePath = join(root, "home");

  const state: SwitcherState = {
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    generatedAt: "2026-06-23T10:00:00.000Z",
    targets: {
      cli: { env: "default", account: "default" },
      app: { env: "default", account: "default" },
    },
    envs: {
      default: {
        name: "default",
        path: homePath,
        accounts: {
          default: {
            name: "default",
            authMode: "auth",
            runtime: {
              preferredAuthMethod: "chatgpt",
              openaiBaseUrlMode: "default",
              independentModelEnabled: true,
              independentModelProviderId: "gateway",
              independentModelApiKey: "sk-apikey",
              independentModelBaseUrl: "https://proxy.example.test/v1",
            },
            authData: {
              tokens: "{\"access_token\":\"demo\"}",
            },
          },
        },
      },
    },
    tasks: { recent: [] },
  };

  try {
    await applyTargetHomeState({ state, target: "cli" });

    const config = await readFile(join(homePath, "config.toml"), "utf8");
    assert.match(config, /preferred_auth_method = "chatgpt"/);
    assert.match(config, /model_provider = "gateway"/);
    assert.match(config, /\[model_providers\.gateway\]/);
    assert.match(config, /name = "gateway"/);
    assert.match(config, /model = "gpt-5.4"/);
    assert.match(config, /base_url = "https:\/\/proxy\.example\.test\/v1"/);
    assert.match(config, /experimental_bearer_token = "sk-apikey"/);
    assert.match(config, /requires_openai_auth = true/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("target-home writer preserves object-shaped token payloads", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-target-home-token-object-"));
  const homePath = join(root, "home");

  const state: SwitcherState = {
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    generatedAt: "2026-07-09T10:00:00.000Z",
    targets: {
      cli: { env: "default", account: "default" },
      app: { env: "default", account: "default" },
    },
    envs: {
      default: {
        name: "default",
        path: homePath,
        accounts: {
          default: {
            name: "default",
            authMode: "auth",
            runtime: {
              preferredAuthMethod: "chatgpt",
              openaiBaseUrlMode: "default",
            },
            authData: {
              auth_mode: "chatgpt",
              tokens: {
                access_token: "access-token",
                refresh_token: "refresh-token",
              },
            },
          },
        },
      },
    },
    tasks: { recent: [] },
  };

  try {
    await applyTargetHomeState({ state, target: "cli" });

    const auth = JSON.parse(await readFile(join(homePath, "auth.json"), "utf8")) as {
      tokens?: { access_token?: string; refresh_token?: string };
    };
    assert.equal(typeof auth.tokens, "object");
    assert.equal(auth.tokens?.access_token, "access-token");
    assert.equal(auth.tokens?.refresh_token, "refresh-token");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("target-home writer upgrades stringified tokens into objects for Codex auth.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-target-home-token-string-"));
  const homePath = join(root, "home");

  const state: SwitcherState = {
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    generatedAt: "2026-07-09T10:00:00.000Z",
    targets: {
      cli: { env: "default", account: "default" },
      app: { env: "default", account: "default" },
    },
    envs: {
      default: {
        name: "default",
        path: homePath,
        accounts: {
          default: {
            name: "default",
            authMode: "auth",
            runtime: {
              preferredAuthMethod: "chatgpt",
              openaiBaseUrlMode: "default",
            },
            authData: {
              auth_mode: "chatgpt",
              tokens: "{\"access_token\":\"access-token\",\"refresh_token\":\"refresh-token\"}",
            },
          },
        },
      },
    },
    tasks: { recent: [] },
  };

  try {
    await applyTargetHomeState({ state, target: "cli" });

    const auth = JSON.parse(await readFile(join(homePath, "auth.json"), "utf8")) as {
      tokens?: { access_token?: string; refresh_token?: string };
    };
    assert.equal(typeof auth.tokens, "object");
    assert.equal(auth.tokens?.access_token, "access-token");
    assert.equal(auth.tokens?.refresh_token, "refresh-token");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("target-home writer preserves unmanaged config and removes managed fields on clear", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-target-home-clear-"));
  const homePath = join(root, "home");

  try {
    await applyFixture(homePath);
    await clearTargetHomeState(homePath);

    const config = await readFile(join(homePath, "config.toml"), "utf8");
    assert.doesNotMatch(config, /preferred_auth_method/);
    assert.doesNotMatch(config, /openai_base_url/);
    assert.doesNotMatch(config, /model_provider = "custom"/);
    assert.doesNotMatch(config, /model_provider = "gateway"/);
    assert.doesNotMatch(config, /\[model_providers\.custom\]/);
    assert.doesNotMatch(config, /\[model_providers\.gateway\]/);
    assert.match(config, /model = "gpt-5.5"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("target-home writer clears managed files when selected account is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-target-home-missing-"));
  const homePath = join(root, "home");

  const state: SwitcherState = {
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    generatedAt: "2026-06-16T10:00:00.000Z",
    targets: {
      cli: { env: "default", account: "default" },
      app: { env: "default", account: "default" },
    },
    envs: {
      default: {
        name: "default",
        path: homePath,
        accounts: {},
      },
    },
    tasks: { recent: [] },
  };

  try {
    await mkdir(homePath, { recursive: true });
    await writeFile(join(homePath, "auth.json"), '{"OPENAI_API_KEY":"stale"}\n', "utf8");
    await writeFile(
      join(homePath, "config.toml"),
      'preferred_auth_method = "apikey"\nopenai_base_url = "https://stale.example.test/v1"\nmodel = "gpt-5.5"\n',
      "utf8",
    );

    await applyTargetHomeState({
      state,
      target: "cli",
    });

    await assert.rejects(readFile(join(homePath, "auth.json"), "utf8"));
    const config = await readFile(join(homePath, "config.toml"), "utf8");
    assert.doesNotMatch(config, /preferred_auth_method/);
    assert.doesNotMatch(config, /openai_base_url/);
    assert.doesNotMatch(config, /model_provider = "custom"/);
    assert.doesNotMatch(config, /model_provider = "gateway"/);
    assert.doesNotMatch(config, /\[model_providers\.custom\]/);
    assert.doesNotMatch(config, /\[model_providers\.gateway\]/);
    assert.match(config, /model = "gpt-5.5"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function applyFixture(homePath: string) {
  await mkdir(homePath, { recursive: true });
  await writeFile(
    join(homePath, "config.toml"),
    'preferred_auth_method = "apikey"\nopenai_base_url = "https://proxy.example.test/v1"\nmodel = "gpt-5.5"\nmodel_provider = "custom"\n\n[model_providers.custom]\nname = "custom"\nmodel = "gpt-5.4"\nbase_url = "https://proxy.example.test/v1"\nexperimental_bearer_token = "sk-old"\nrequires_openai_auth = true\n',
    "utf8",
  );
}
