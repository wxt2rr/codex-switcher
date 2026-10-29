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
  assert.deepEqual(result.response.output.map((item) => item.type), ["reasoning", "message", "function_call"]);
  assert.equal(result.calls[0]?.function.arguments, "{}");
  assert.equal(result.response.usage.total_tokens, 6);
});

test("omits empty and malformed Chat tool calls instead of emitting invalid Responses arguments", () => {
  const result = transformChatResponse({ choices: [{ finish_reason: "tool_calls", message: {
    tool_calls: [
      { id: "empty", function: { name: "empty", arguments: "" } },
      { id: "bad", function: { name: "bad", arguments: "not-json" } },
      { id: "valid", function: { name: "valid", arguments: "{}" } },
    ],
  } }] }, { model: "model", registry: buildToolRegistry({}) });
  assert.deepEqual(result.calls.map((call) => call.id), ["valid"]);
  assert.deepEqual(result.response.output.filter((item) => item.type === "function_call").map((item) => item.call_id), ["valid"]);
  assert.equal(JSON.stringify(result.response).includes('arguments":""'), false);
});

test("does not silently complete when Chat declares tool_calls without a valid call", () => {
  assert.throws(() => transformChatResponse({ choices: [{ finish_reason: "tool_calls", message: {
    content: "我来看一下这个项目的结构和说明文件。",
    tool_calls: [{ id: "broken", function: { name: "read", arguments: "" } }],
  } }] }, { model: "model", registry: buildToolRegistry({ tools: [{ type: "function", name: "read" }] }) }), /no valid tool call arguments/);
});

test("rejects malformed tool calls even when the provider incorrectly reports stop", () => {
  assert.throws(() => transformChatResponse({ choices: [{ finish_reason: "stop", message: {
    content: "先检查一下。",
    tool_calls: [{ id: "broken-stop", function: { name: "read", arguments: "{" } }],
  } }] }, { model: "model", registry: buildToolRegistry({ tools: [{ type: "function", name: "read" }] }) }), /no valid tool call arguments/);
});

test("accepts object arguments and plain text for custom tools", () => {
  const result = transformChatResponse({ choices: [{ finish_reason: "tool_calls", message: {
    tool_calls: [
      { id: "function-object", function: { name: "read", arguments: { path: "README.md" } } },
      { id: "custom-text", function: { name: "web_search", arguments: "search project docs" } },
    ],
  } }] }, { model: "model", registry: buildToolRegistry({ tools: [{ type: "function", name: "read" }, { type: "web_search" }] }) });
  assert.equal(result.calls[0]?.function.arguments, '{"path":"README.md"}');
  assert.equal(result.calls[1]?.function.arguments, '{"input":"search project docs"}');
});

test("accepts provider tool calls with top-level name and arguments", () => {
  const result = transformChatResponse({ choices: [{ finish_reason: "tool_calls", message: {
    tool_calls: [{ id: "top-level", name: "read", arguments: { path: "README.md" } }],
  } }] }, { model: "model", registry: buildToolRegistry({ tools: [{ type: "function", name: "read" }] }) });
  assert.equal(result.calls[0]?.function.name, "read");
  assert.equal(result.calls[0]?.function.arguments, '{"path":"README.md"}');
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
