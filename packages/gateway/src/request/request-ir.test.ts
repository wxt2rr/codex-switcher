import assert from "node:assert/strict";
import test from "node:test";
import { createGatewayRequestContext } from "./request-ir.js";

test("gateway request context normalizes identity, session and capabilities", () => {
  const context = createGatewayRequestContext({
    requestId: " req-1 ",
    environmentId: " env-1 ",
    agentId: " codex ",
    protocol: "responses",
    logicalModelId: " group/coder ",
    sessionId: " session-1 ",
    capabilities: ["tools", "streaming", "tools"],
    metadata: { source: "test" },
    receivedAt: 42,
  });
  assert.deepEqual(context, {
    requestId: "req-1",
    environmentId: "env-1",
    agentId: "codex",
    protocol: "responses",
    logicalModelId: "group/coder",
    sessionId: "session-1",
    capabilities: ["streaming", "tools"],
    receivedAt: 42,
    metadata: { source: "test" },
  });
});

test("gateway request context rejects incomplete or unsupported identity", () => {
  assert.throws(
    () => createGatewayRequestContext({
      requestId: "",
      environmentId: "env",
      agentId: "codex",
      protocol: "responses",
      logicalModelId: "model",
    }),
    /requires request, environment, agent and model identifiers/,
  );
  assert.throws(
    () => createGatewayRequestContext({
      requestId: "req",
      environmentId: "env",
      agentId: "codex",
      protocol: "unsupported" as never,
      logicalModelId: "model",
    }),
    /Unsupported gateway protocol/,
  );
});
