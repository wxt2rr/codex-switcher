import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentGatewayBinding, restoreAgentConfigRef } from "./agent-gateway-config.js";

test("agent bindings select gateway models without making Agent a gateway core object", () => {
  const binding = buildAgentGatewayBinding({ agentId: "codex", displayName: "Codex", gatewayId: "gateway-work", defaultModelId: "provider:model", originalConfigRef: "config:codex" });
  assert.equal(binding.enabled, true);
  assert.equal(restoreAgentConfigRef(binding), "config:codex");
});
