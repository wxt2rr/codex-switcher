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
      app: { env: "default", account: "work" },
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

test("env service reuses the account already active in a shared destination environment", () => {
  const service = createEnvService();
  const state = createSampleState();
  state.envs.project = {
    name: "project",
    path: "/tmp/project/home",
    accounts: {
      work: state.envs.default!.accounts.work!,
      personal: state.envs.default!.accounts.personal!,
    },
  };
  state.targets.cli = { env: "project", account: "work" };
  state.targets.app = { env: "default", account: "personal" };

  const next = service.selectEnv(state, {
    target: "app",
    envName: "project",
    now: "2026-06-16T08:10:00.000Z",
  });

  assert.deepEqual(next.targets.cli, { env: "project", account: "work" });
  assert.deepEqual(next.targets.app, { env: "project", account: "work" });
});

test("env service updates env name and path while preserving accounts and targets", () => {
  const service = createEnvService();
  const state = createSampleState();

  const next = service.updateEnv(state, {
    envName: "default",
    nextEnvName: "default",
    homePath: "/tmp/custom-default-home",
    now: "2026-06-16T08:20:00.000Z",
  });

  assert.equal(next.envs.default?.path, "/tmp/custom-default-home");
  assert.deepEqual(Object.keys(next.envs.default?.accounts ?? {}), ["work", "personal"]);
  assert.equal(next.targets.cli.env, "default");
  assert.equal(next.generatedAt, "2026-06-16T08:20:00.000Z");
});

test("env service rejects renaming the reserved default env", () => {
  const service = createEnvService();

  assert.throws(
    () =>
      service.updateEnv(createSampleState(), {
        envName: "default",
        nextEnvName: "workspace",
        homePath: "/tmp/workspace-home",
        now: "2026-06-16T08:25:00.000Z",
      }),
    (error: unknown) => {
      assert.equal((error as EnvServiceError).code, "RESERVED_ENV");
      return true;
    },
  );
});
