import assert from "node:assert/strict";
import test from "node:test";

import { buildStatusLines, renderStatusScreen } from "./status.js";

test("buildStatusLines renders cli/app summaries and grouped accounts", () => {
  const lines = buildStatusLines(
    {
      cli: {
        current: "default/work",
        auth: "chatgpt",
        authExpiry: "2030-01-01 00:00:00Z",
        loginState: "logged-in",
      },
      app: {
        current: "default/personal",
        auth: "apikey | base_url: https://proxy.example.test/v1",
        authExpiry: "-",
        loginState: "logged-in",
      },
      tokenRefresh: {
        guard: "unknown",
        needReloginLastRun: "2",
      },
      setup: {
        summary: "Mismatch: current launcher PowerShell is not ready; target cmd is ready",
        suggestion: "Suggestion: ready target available: cmd",
      },
    },
    [
      {
        envName: "default",
        name: "work",
        isCurrentCli: true,
        authMode: "auth",
        runtime: {
          preferredAuthMethod: "chatgpt",
        },
      },
      {
        envName: "default",
        name: "personal",
        isCurrentApp: true,
        authMode: "apikey",
        apiKeyPreview: "sk-***7890",
        runtime: {
          preferredAuthMethod: "apikey",
          openaiBaseUrl: "https://proxy.example.test/v1",
        },
      },
    ],
  );

  assert.match(lines.join("\n"), /CLI \[logged-in\]/);
  assert.match(lines.join("\n"), /APP \[logged-in\]/);
  assert.match(lines.join("\n"), /SETUP         Mismatch: current launcher PowerShell is not ready; target cmd is ready/);
  assert.match(lines.join("\n"), /ACTION        Suggestion: ready target available: cmd/);
  assert.match(lines.join("\n"), /personal \[app\]/);
  assert.match(lines.join("\n"), /api key: sk-\*\*\*7890/);
});

test("renderStatusScreen applies offset and viewLines", () => {
  const screen = renderStatusScreen({
    status: {
      cli: {
        current: "default/work",
        auth: "chatgpt",
        authExpiry: "2030-01-01 00:00:00Z",
        loginState: "logged-in",
      },
      app: {
        current: "default/personal",
        auth: "apikey",
        authExpiry: "-",
        loginState: "logged-in",
      },
      tokenRefresh: {
        guard: "unknown",
        needReloginLastRun: "0",
      },
      setup: {
        summary: "",
        suggestion: "",
      },
    },
    accounts: [],
    offset: 0,
    viewLines: 6,
  });

  assert.match(screen, /codex-sw-node - Status/);
  assert.match(screen, /CLI \[logged-in\]/);
  assert.doesNotMatch(screen, /ENV:/);
});
