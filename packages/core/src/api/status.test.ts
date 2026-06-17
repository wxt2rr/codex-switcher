import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SCHEMA_VERSION, type SwitcherState } from "../state/store.js";
import { createCoreApi } from "./core-api.js";

const state: SwitcherState = {
  schemaVersion: DEFAULT_SCHEMA_VERSION,
  generatedAt: "2026-06-16T13:00:00.000Z",
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
  tasks: { recent: [] },
};

test("core api returns structured status summary", () => {
  const api = createCoreApi({
    getState: () => state,
  });

  const status = api.getStatus();
  assert.equal(status.cli.current, "default/work");
  assert.equal(status.app.current, "default/personal");
  assert.equal(status.cli.auth, "chatgpt");
  assert.equal(status.app.auth, "apikey | base_url: https://proxy.example.test/v1");
});

test("core api returns detailed status fields for cli compatibility", () => {
  const api = createCoreApi({
    getState: () => ({
      ...state,
      envs: {
        default: {
          ...state.envs.default,
          accounts: {
            ...state.envs.default.accounts,
            work: {
              ...state.envs.default.accounts.work,
              authData: {
                tokens: JSON.stringify({
                  access_token: [
                    "header",
                    "eyJleHAiOjE5MDAwMDAwMDB9",
                    "sig",
                  ].join("."),
                }),
              },
            },
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
      tasks: {
        recent: [
          {
            id: "token-refresh-1",
            kind: "token-refresh",
            status: "failed",
            startedAt: "2026-06-16T13:00:00.000Z",
            finishedAt: "2026-06-16T13:01:00.000Z",
            summary: "need_relogin=2",
          },
        ],
      },
    }),
  });

  const status = api.getStatus();
  assert.equal(status.cli.authExpiry, "2030-03-17 17:46:40Z");
  assert.equal(status.app.authExpiry, "-");
  assert.equal(status.cli.loginState, "logged-in");
  assert.equal(status.app.loginState, "logged-in");
  assert.equal(status.tokenRefresh.needReloginLastRun, "2");
});
