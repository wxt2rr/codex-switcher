import test from "node:test";
import assert from "node:assert/strict";

import { normalizeToolExchange } from "./tool-exchange-normalizer.js";
import type { ChatMessage } from "./types.js";

const call = (id: string, name = id) => ({ id, type: "function" as const, function: { name, arguments: "{}" } });

test("sorts parallel results, deduplicates repeats, and includes tool names", () => {
  const result = normalizeToolExchange([
    { role: "assistant", content: null, tool_calls: [call("a", "alpha"), call("b", "beta")] },
    { role: "tool", tool_call_id: "b", content: "B" },
    { role: "tool", tool_call_id: "a", content: "A" },
    { role: "tool", tool_call_id: "a", content: "duplicate" },
  ], { includeToolName: true });
  assert.deepEqual(result.messages.map((message) => message.tool_call_id), [undefined, "a", "b"]);
  assert.equal(result.messages[1]?.name, "alpha");
  assert.equal(result.diagnostics.duplicateToolResults, 1);
});

test("downgrades orphan tool results and completes interrupted calls", () => {
  const result = normalizeToolExchange([
    { role: "tool", tool_call_id: "missing", content: "stale" },
    { role: "assistant", content: null, tool_calls: [call("pending")] },
  ]);
  assert.equal(result.messages[0]?.role, "user");
  assert.equal(result.messages[1]?.role, "assistant");
  assert.equal(result.messages[2]?.role, "tool");
  assert.equal(result.messages[2]?.tool_call_id, "pending");
  assert.equal(result.diagnostics.orphanToolResults, 1);
  assert.equal(result.diagnostics.syntheticToolResults, 1);
});

test("merges split assistant tool-call messages", () => {
  const result = normalizeToolExchange([
    { role: "assistant", content: "Working", },
    { role: "assistant", content: null, tool_calls: [call("a")] },
    { role: "tool", tool_call_id: "a", content: "done" },
  ]);
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0]?.role, "assistant");
  assert.equal(result.messages[0]?.tool_calls?.[0]?.id, "a");
  assert.equal(result.diagnostics.mergedAssistantMessages, 1);
});

test("drops malformed historical tool arguments without sending a callable tool", () => {
  const result = normalizeToolExchange(([
    { role: "assistant", content: null, tool_calls: [call("bad")] },
  ].map((message) => message.tool_calls ? { ...message, tool_calls: [{ ...message.tool_calls[0]!, function: { ...message.tool_calls[0]!.function, arguments: "{" } }] } : message)) as ChatMessage[]);
  assert.equal(result.messages[0]?.tool_calls, undefined);
  assert.equal(result.diagnostics.invalidToolCalls, 1);
});

test("keeps media when an orphan tool result is downgraded to user context", () => {
  const result = normalizeToolExchange([
    { role: "tool", tool_call_id: "missing", content: [{ type: "image_url", image_url: { url: "https://example.test/result.png" } }] },
  ]);
  assert.equal(result.messages[0]?.role, "user");
  assert.deepEqual(result.messages[0]?.content, [
    { type: "text", text: "Tool result received without a resolvable preceding call:" },
    { type: "image_url", image_url: { url: "https://example.test/result.png" } },
  ]);
});
