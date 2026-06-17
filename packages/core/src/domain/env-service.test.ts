import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SCHEMA_VERSION, type SwitcherState } from "../state/store.js";
import {
  createEnvService,
  type EnvServiceError,
} from "./env-service.js";

function createSampleState(): SwitcherState {
  return {
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    generatedAt: "2026-06-16T08:00:00.000Z",
    targets: {
      cli: { env: "default", account: "work" },
      app: { env: "default", account: "personal" },
    },
    envs: {
      default: {
        name: "default",
        path: "/tmp/default-home",
        accounts: {
          work: {
            name: "work",
            authMode: "auth",
            runtime: {
              preferredAuthMethod: "chatgpt",
              openaiBaseUrlMode: "default",
            },
          },
          personal: {
            name: "personal",
            authMode: "apikey",
            runtime: {
              preferredAuthMethod: "apikey",
              openaiBaseUrlMode: "custom",
              openaiBaseUrl: "https://proxy.example.test/v1",
            },
          },
        },
      },
    },
    tasks: {
      recent: [],
    },
  };
}

test("env service lists envs with current target markers", () => {
  const service = createEnvService();
  const result = service.listEnvs(createSampleState());

  assert.deepEqual(result, [
    {
      name: "default",
      path: "/tmp/default-home",
      isCurrentCli: true,
      isCurrentApp: true,
      accountCount: 2,
    },
  ]);
});

test("env service creates a new env by cloning from an existing env path", () => {
  const service = createEnvService();
  const state = createSampleState();

  const next = service.createEnv(state, {
    envName: "project-a",
    homePath: "/tmp/project-a/home",
    cloneFromEnv: "default",
    now: "2026-06-16T08:05:00.000Z",
  });

  assert.equal(next.envs["project-a"]?.path, "/tmp/project-a/home");
  assert.deepEqual(next.envs["project-a"]?.accounts, {});
  assert.equal(next.generatedAt, "2026-06-16T08:05:00.000Z");
});

test("env service rejects removing the reserved default env", () => {
  const service = createEnvService();

  assert.throws(
    () => service.removeEnv(createSampleState(), { envName: "default" }),
    (error: unknown) => {
      assert.equal((error as EnvServiceError).code, "RESERVED_ENV");
      return true;
    },
  );
});

test("env service switches a target to the requested env when it exists", () => {
  const service = createEnvService();
  const state = createSampleState();
  state.envs["project-a"] = {
    name: "project-a",
    path: "/tmp/project-a/home",
    accounts: {},
  };

  const next = service.selectEnv(state, {
    target: "cli",
    envName: "project-a",
    now: "2026-06-16T08:10:00.000Z",
  });

  assert.equal(next.targets.cli.env, "project-a");
  assert.equal(next.targets.cli.account, "default");
});
