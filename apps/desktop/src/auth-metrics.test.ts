import test from "node:test";
import assert from "node:assert/strict";

import { mergeAccountUsageMetrics, mergeOverviewWithAuthMetrics } from "./auth-metrics.js";
import type { AuthMetricsPayload, OverviewPayload } from "./desktop-model.js";

const overview: OverviewPayload = {
  generatedAt: "2026-06-22T00:00:00.000Z",
  status: {
    cli: {
      current: "default/auth-user",
      auth: "chatgpt",
      authExpiry: "-",
      loginState: "logged-in",
    },
    app: {
      current: "default/key-user",
      auth: "apikey | base_url: default",
      authExpiry: "-",
      loginState: "logged-in",
      apiKeyPreview: "sk-***1234",
    },
    tokenRefresh: {
      guard: "unknown",
      needReloginLastRun: "0",
    },
  },
  envs: [],
  accounts: [
    {
      envName: "default",
      name: "auth-user",
      authMode: "auth",
      isCurrentCli: true,
      isCurrentApp: false,
      runtime: {
        preferredAuthMethod: "chatgpt",
        openaiBaseUrlMode: "default",
      },
    },
    {
      envName: "default",
      name: "key-user",
      authMode: "apikey",
      isCurrentCli: false,
      isCurrentApp: true,
      runtime: {
        preferredAuthMethod: "apikey",
        openaiBaseUrlMode: "default",
      },
    },
  ],
  recentTasks: [],
};

const authMetrics: AuthMetricsPayload = {
  accounts: {
    "default/auth-user": {
      plan: "free",
      usage5h: "10%",
      usageWeekly: "20%",
    },
  },
  status: {
    cli: {
      email: "auth@example.com",
      usage5h: "10%",
      usageWeekly: "20%",
    },
  },
};

test("mergeOverviewWithAuthMetrics only patches auth-backed records", () => {
  const merged = mergeOverviewWithAuthMetrics(overview, authMetrics);

  assert.deepEqual(merged.accounts[0]?.authProfile, {
    plan: "free",
    usage5h: "10%",
    usageWeekly: "20%",
  });
  assert.equal(merged.accounts[1]?.authProfile, undefined);
  assert.equal(merged.status.cli.email, "auth@example.com");
  assert.equal(merged.status.app.email, undefined);
});

test("mergeAccountUsageMetrics changes only AUTH account usage fields", () => {
  const merged = mergeAccountUsageMetrics(overview, authMetrics);

  assert.deepEqual(merged.accounts[0]?.authProfile, authMetrics.accounts["default/auth-user"]);
  assert.equal(merged.accounts[1], overview.accounts[1]);
  assert.equal(merged.status, overview.status);
  assert.equal(merged.envs, overview.envs);
  assert.equal(merged.recentTasks, overview.recentTasks);
});
