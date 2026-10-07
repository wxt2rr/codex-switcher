import test from "node:test";
import assert from "node:assert/strict";

import { stripExcludedGatewayFields } from "./gateway-admin-configuration.js";

test("gateway admin configuration removes excluded intent-routing fields recursively", () => {
  const result = stripExcludedGatewayFields({
    gatewayId: "gateway-default",
    intentRouting: { prompt: "never persist" },
    rules: [{ intent: "never persist" }],
    routeRules: [{ id: "images", targetModelId: "vision-model", match: { hasImages: true } }],
    nested: [
      { intent_rules_json: "[]", classifier: "never run", keep: true },
      { Prompt_Routing: true, keep: "yes" },
      { prompt: "never inspect", keep: "yes" },
    ],
  });

  assert.deepEqual(result, {
    gatewayId: "gateway-default",
    routeRules: [{ id: "images", targetModelId: "vision-model", match: { hasImages: true } }],
    nested: [{ keep: true }, { keep: "yes" }, { keep: "yes" }],
  });
});

test("gateway admin configuration rejects non-object roots", () => {
  assert.throws(() => stripExcludedGatewayFields([]), /JSON object/);
  assert.throws(() => stripExcludedGatewayFields("gateway"), /JSON object/);
});
