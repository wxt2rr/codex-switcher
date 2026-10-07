import assert from "node:assert/strict";
import test from "node:test";

import { GATEWAY_TUI_ACTIONS, renderGatewayScreen } from "./gateway.js";

test("renderGatewayScreen shows explicit routing state and operational actions", () => {
  const output = renderGatewayScreen({
    snapshot: {
      envName: "project",
      mode: "gateway",
      process: "running",
      gatewayId: "gateway-project",
      providers: [{ id: "openai", status: "enabled" }],
      credentials: [{ id: "work", providerId: "openai", status: "active" }],
      models: [{ id: "openai/gpt-5", providerId: "openai", upstreamModelId: "gpt-5", enabled: true }],
      routeGroups: [{ id: "coding", exposedModelId: "coding", strategy: "smart", sessionPolicy: "session", members: 1 }],
      agents: [{ id: "codex", status: "connected" }, { id: "claude", status: "disconnected" }],
      profiles: ["default"],
      usage: { window: "today", requests: 3, inputTokens: 100, outputTokens: 40, cost: 0.12 },
    },
    selected: 2,
    message: "Providers loaded",
  });

  assert.match(output, /codex-sw-node - Gateway/);
  assert.match(output, /Environment: project/);
  assert.match(output, /Mode: Gateway routing/);
  assert.match(output, /Process: running/);
  assert.match(output, /Providers: 1  Credentials: 1/);
  assert.match(output, /Models: 1  RouteGroups: 1  Agents: 1\/2/);
  assert.match(output, /coding: coding \/ smart \/ session \/ 1 members/);
  assert.match(output, /Providers loaded/);
  assert.match(output, /Usage \(today\): 3 requests  140 tokens  cost=0.12/);
  assert.match(output, /> Providers/);
  assert.match(output, /Usage/);
  assert.match(output, /Profiles/);
  assert.equal(GATEWAY_TUI_ACTIONS.length, 10);
});
