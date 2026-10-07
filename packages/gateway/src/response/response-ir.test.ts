import assert from "node:assert/strict";
import test from "node:test";
import { isTerminalGatewayResponseEvent } from "./response-ir.js";

test("gateway response IR identifies terminal events", () => {
  assert.equal(isTerminalGatewayResponseEvent({ type: "message_end", reason: "stop" }), true);
  assert.equal(isTerminalGatewayResponseEvent({ type: "error", code: "UPSTREAM", message: "failed", retryable: true }), true);
  assert.equal(isTerminalGatewayResponseEvent({ type: "text_delta", text: "ok" }), false);
});
