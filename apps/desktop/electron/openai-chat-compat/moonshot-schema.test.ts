import test from "node:test";
import assert from "node:assert/strict";

import { normalizeMoonshotChatTools, upstreamRequiresMoonshotSchema } from "./moonshot-schema.js";

test("desktop Moonshot schema normalizer is host-gated", () => {
  assert.equal(upstreamRequiresMoonshotSchema("https://api.kimi.com/coding"), true);
  assert.equal(upstreamRequiresMoonshotSchema("https://api.openai.com/v1"), false);
});

test("desktop Moonshot schema normalizer rewrites nested ref siblings", () => {
  const body = { tools: [{ function: { parameters: { properties: { value: { $ref: "#/defs/value", type: "string" } } } } }] };
  assert.equal(normalizeMoonshotChatTools(body), 1);
  assert.deepEqual((body.tools[0]!.function.parameters.properties.value as Record<string, unknown>).allOf, [{ $ref: "#/defs/value" }]);
});
