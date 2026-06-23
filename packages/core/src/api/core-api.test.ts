import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SCHEMA_VERSION, type SwitcherState } from "../state/store.js";
import { createCoreApi } from "./core-api.js";

function createSampleState(): SwitcherState {
  return {
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    generatedAt: "2026-06-16T11:00:00.000Z",
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

test("core api returns structured overview for current state", () => {
  const api = createCoreApi({
    getState: () => createSampleState(),
  });

  const overview = api.getOverview();
  assert.equal(overview.current.cli.account, "work");
  assert.equal(overview.current.app.account, "personal");
  assert.equal(overview.envs.length, 1);
});

test("core api returns structured account view for an env", () => {
  const api = createCoreApi({
    getState: () => createSampleState(),
  });

  const accounts = api.getAccounts("default");
  assert.equal(accounts.length, 2);
  assert.equal(accounts.find((item) => item.name === "work")?.isCurrentCli, true);
});

test("core api lists env summaries", () => {
  const api = createCoreApi({
    getState: () => createSampleState(),
  });

  const envs = api.listEnvs();
  assert.equal(envs.length, 1);
  assert.equal(envs[0]?.name, "default");
});

test("core api aggregates accounts across envs for cli list compatibility", () => {
  const api = createCoreApi({
    getState: () => ({
      ...createSampleState(),
      envs: {
        default: createSampleState().envs.default,
        project: {
          name: "project",
          path: "/tmp/project-home",
          accounts: {
            dev: {
              name: "dev",
              authMode: "auth",
              runtime: {
                preferredAuthMethod: "chatgpt",
                openaiBaseUrlMode: "default",
              },
            },
          },
        },
      },
    }),
  });

  const accounts = api.listAccounts();
  assert.equal(accounts.length, 3);
  assert.deepEqual(
    accounts.map((item) => `${item.envName}/${item.name}`),
    ["default/personal", "default/work", "project/dev"],
  );
});

test("core api selects env and account for requested target", () => {
  const state: SwitcherState = {
    ...createSampleState(),
    envs: {
      ...createSampleState().envs,
      project: {
        name: "project",
        path: "/tmp/project-home",
        accounts: {
          dev: {
            name: "dev",
            authMode: "auth",
            runtime: {
              preferredAuthMethod: "chatgpt",
              openaiBaseUrlMode: "default",
            },
          },
        },
      },
    },
  };

  const api = createCoreApi({
    getState: () => state,
  });

  const nextEnv = api.selectEnv({
    target: "cli",
    envName: "project",
    now: "2026-06-16T11:30:00.000Z",
  });
  assert.equal(nextEnv.targets.cli.env, "project");

  const nextAccount = api.selectAccount({
    target: "cli",
    envName: "project",
    accountName: "dev",
    now: "2026-06-16T11:31:00.000Z",
  });
  assert.equal(nextAccount.targets.cli.account, "dev");
});

test("core api creates env and updates account runtime", () => {
  const state = createSampleState();
  const api = createCoreApi({
    getState: () => state,
  });

  const nextEnv = api.createEnv({
    envName: "workspace",
    homePath: "/tmp/workspace-home",
    now: "2026-06-16T11:40:00.000Z",
  });
  assert.equal(nextEnv.envs.workspace?.path, "/tmp/workspace-home");

  const nextRuntime = api.updateAccountRuntime({
    envName: "default",
    accountName: "personal",
    runtime: {
      preferredAuthMethod: "apikey",
      openaiBaseUrlMode: "custom",
      openaiBaseUrl: "https://new-runtime.example/v1",
    },
    now: "2026-06-16T11:41:00.000Z",
  });
  assert.equal(
    nextRuntime.envs.default.accounts.personal.runtime.openaiBaseUrl,
    "https://new-runtime.example/v1",
  );
});

test("core api updates environment configuration", () => {
  const state = createSampleState();
  const api = createCoreApi({
    getState: () => state,
  });

  const nextEnv = api.updateEnv({
    envName: "default",
    nextEnvName: "default",
    homePath: "/tmp/relocated-default-home",
    now: "2026-06-16T11:42:00.000Z",
  });

  assert.equal(nextEnv.envs.default?.path, "/tmp/relocated-default-home");
  assert.equal(nextEnv.targets.cli.env, "default");
});
