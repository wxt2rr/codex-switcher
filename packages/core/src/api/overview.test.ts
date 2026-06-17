import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SCHEMA_VERSION, type SwitcherState } from "../state/store.js";
import { createCoreApi } from "./core-api.js";

const state: SwitcherState = {
  schemaVersion: DEFAULT_SCHEMA_VERSION,
  generatedAt: "2026-06-16T14:00:00.000Z",
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
    recent: [
      {
        id: "task-1",
        kind: "proxy-test",
        status: "succeeded",
        startedAt: "2026-06-16T13:59:00.000Z",
        finishedAt: "2026-06-16T13:59:05.000Z",
        summary: "proxy ok",
      },
    ],
  },
};

test("core api returns desktop-ready overview payload", () => {
  const api = createCoreApi({
    getState: () => ({
      ...state,
      envs: {
        default: {
          ...state.envs.default,
          accounts: {
            ...state.envs.default.accounts,
            personal: {
              ...state.envs.default.accounts.personal,
              authData: {
                auth_mode: "apikey",
                OPENAI_API_KEY: "sk-test-1234567890",
              },
            },
          },
        },
      },
    }),
  });

  const overview = api.getOverview();
  assert.equal(overview.status.cli.current, "default/work");
  assert.equal(overview.status.app.current, "default/personal");
  assert.equal(overview.envs[0]?.isCurrentCli, true);
  assert.equal(overview.accounts.length, 2);
  assert.equal(overview.accounts.find((account) => account.name === "personal")?.apiKeyPreview, "sk-***7890");
  assert.equal(overview.recentTasks[0]?.summary, "proxy ok");
});
