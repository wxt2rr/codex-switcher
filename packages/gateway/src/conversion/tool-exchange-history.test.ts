import assert from "node:assert/strict";
import test from "node:test";
import { ToolExchangeHistory } from "./tool-exchange-history.js";

test("generic history restores calls before Responses tool outputs", () => {
  const history = new ToolExchangeHistory();
  history.record("session", "chat_completions", {
    id: "resp-1",
    choices: [{ message: { role: "assistant", tool_calls: [
      { id: "a", type: "function", function: { name: "alpha", arguments: "{}" } },
      { id: "b", type: "function", function: { name: "beta", arguments: "{}" } },
    ] } }],
  });
  const enriched = history.enrich("session", "responses", {
    model: "model",
    previous_response_id: "resp-1",
    input: [
      { type: "function_call_output", call_id: "b", output: "B" },
      { type: "function_call_output", call_id: "a", output: "A" },
    ],
  });
  assert.deepEqual((enriched.input as Array<Record<string, unknown>>).map((item) => item.type), ["function_call", "function_call", "function_call_output", "function_call_output"]);
  assert.deepEqual((enriched.input as Array<Record<string, unknown>>).slice(0, 2).map((item) => item.call_id), ["a", "b"]);
  assert.equal("previous_response_id" in enriched, false);
});

test("generic history snapshots and reloads without retaining unrelated data", () => {
  const first = new ToolExchangeHistory();
  first.record("session", "responses", { id: "resp", output: [{ type: "function_call", call_id: "call", name: "read", arguments: "{}" }] });
  const second = new ToolExchangeHistory();
  second.load(first.snapshot());
  const restored = second.enrich("session", "responses", { previous_response_id: "resp", input: [{ type: "function_call_output", call_id: "call", output: "ok" }] });
  assert.equal((restored.input as Array<Record<string, unknown>>)[0]?.type, "function_call");
});

test("generic history drops polluted empty and malformed tool calls", () => {
  const history = new ToolExchangeHistory();
  history.record("session", "chat_completions", {
    id: "resp-polluted",
    choices: [{ message: { role: "assistant", tool_calls: [
      { id: "empty", function: { name: "empty", arguments: "" } },
      { id: "bad", function: { name: "bad", arguments: "{oops" } },
      { id: "valid", function: { name: "valid", arguments: "{}" } },
    ] } }],
  });
  const restored = history.enrich("session", "responses", {
    previous_response_id: "resp-polluted",
    input: [{ type: "function_call_output", call_id: "valid", output: "ok" }],
  });
  assert.deepEqual((restored.input as Array<Record<string, unknown>>).map((item) => item.call_id), ["valid", "valid"]);
  assert.equal(JSON.stringify(restored).includes('arguments":""'), false);
});
