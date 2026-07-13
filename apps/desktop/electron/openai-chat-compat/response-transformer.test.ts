import test from "node:test";
import assert from "node:assert/strict";

import { transformChatResponse } from "./response-transformer.js";
import { buildToolRegistry } from "./tool-registry.js";

test("converts text, reasoning, parallel tools and usage", () => {
  const registry = buildToolRegistry({ tools: [{ type: "function", name: "read" }] });
  const result = transformChatResponse({ choices: [{ finish_reason: "stop", message: {
    content: "done", reasoning_content: "thought", tool_calls: [
      { id: "a", function: { name: "read", arguments: "{}" } },
      { id: "b", function: { name: "other", arguments: "{bad" } },
    ],
  } }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }, { model: "model", registry, responseId: "resp" });
  assert.equal(result.response.status, "completed");
  assert.deepEqual(result.response.output.map((item) => item.type), ["reasoning", "message", "function_call", "function_call"]);
  assert.equal(result.calls[1]?.function.arguments, "{bad");
  assert.equal(result.response.usage.total_tokens, 6);
});

test("maps truncated responses and rejects empty choices", () => {
  const registry = buildToolRegistry({});
  const result = transformChatResponse({ choices: [{ finish_reason: "length", message: { content: "partial" } }] }, { model: "model", registry });
  assert.equal(result.response.status, "incomplete");
  assert.deepEqual(result.response.incomplete_details, { reason: "max_output_tokens" });
  assert.throws(() => transformChatResponse({ choices: [] }, { model: "model", registry }), /no choices/);
});

test("prepends one visible warning after lossy compaction filtering", () => {
  const result = transformChatResponse({ choices: [{ finish_reason: "stop", message: { content: "answer" } }] }, {
    model: "model", registry: buildToolRegistry({}), warning: "context warning",
  });
  assert.deepEqual(result.response.output.map((item) => item.type), ["message", "message"]);
  const warning = result.response.output[0]?.content as Array<{ text?: string }>;
  assert.equal(warning[0]?.text, "context warning");
});
