import test from "node:test";
import assert from "node:assert/strict";

import { transformResponsesRequest } from "./request-transformer.js";

test("transforms instructions, multimodal messages, parallel calls and outputs", () => {
  const result = transformResponsesRequest({ request: {
    model: "codex-model", stream: true, instructions: "Be concise", max_output_tokens: 123,
    reasoning: { effort: "high" },
    tools: [
      { type: "function", name: "read", parameters: { type: "object" } },
      { type: "custom", name: "shell" },
    ],
    input: [
      { type: "message", role: "user", content: [
        { type: "input_text", text: "inspect" },
        { type: "input_image", image_url: "https://example.com/a.png", detail: "high" },
      ] },
      { type: "function_call", name: "read", call_id: "call-1", arguments: "{\"path\":\"a\"}" },
      { type: "custom_tool_call", name: "shell", call_id: "call-2", input: "pwd" },
      { type: "function_call_output", call_id: "call-1", output: "content" },
      { type: "custom_tool_call_output", call_id: "call-2", output: "/tmp" },
    ],
  }, upstreamModel: "provider-model", reasoningProfile: "reasoning_content" });
  assert.equal(result.requestedModel, "codex-model");
  assert.equal(result.body.model, "provider-model");
  assert.equal(result.body.max_completion_tokens, 123);
  assert.equal(result.body.reasoning_effort, "high");
  assert.equal(result.body.reasoning_format, "reasoning_content");
  assert.deepEqual(result.body.stream_options, { include_usage: true });
  const messages = result.body.messages as Array<Record<string, unknown>>;
  assert.equal(messages[0]?.role, "system");
  assert.equal((messages[2]?.tool_calls as unknown[])?.length, 2);
  assert.equal(messages[3]?.tool_call_id, "call-1");
  assert.equal(messages[4]?.tool_call_id, "call-2");
});

test("converts tool choice and applies safe overrides", () => {
  const result = transformResponsesRequest({ request: {
    model: "gpt", input: "hello", tools: [{ type: "function", name: "read" }],
    tool_choice: { type: "function", name: "read" },
  }, requestOverrides: { top_p: 0.9 } });
  assert.deepEqual(result.body.tool_choice, { type: "function", function: { name: "read" } });
  assert.equal(result.body.top_p, 0.9);
});

test("replays historical calls whose dynamic tools are no longer advertised", () => {
  const result = transformResponsesRequest({ request: {
    model: "gpt",
    tools: [{ type: "function", name: "current_tool" }],
    input: [
      { type: "function_call", name: "list_apps", call_id: "call-old", arguments: "{}" },
      { type: "function_call_output", call_id: "call-old", output: "Codex" },
      { type: "message", role: "user", content: "continue" },
    ],
  } });
  const messages = result.body.messages as Array<Record<string, unknown>>;
  const historicalCalls = messages[0]?.tool_calls as Array<{ function: { name: string } }>;
  assert.equal(historicalCalls[0]?.function.name, "list_apps");
  assert.equal(messages[1]?.tool_call_id, "call-old");
  assert.equal((result.body.tools as Array<Record<string, unknown>>).length, 1);
});

test("accepts persisted chat-safe names for currently advertised namespace tools", () => {
  const result = transformResponsesRequest({ request: {
    model: "gpt",
    tools: [{ type: "namespace", name: "computer", tools: [{ type: "function", name: "list_apps" }] }],
    input: [
      { type: "function_call", name: "computer__list_apps", call_id: "call-old", arguments: "{}" },
      { type: "function_call_output", call_id: "call-old", output: "Codex" },
    ],
  } });
  const messages = result.body.messages as Array<Record<string, unknown>>;
  const historicalCalls = messages[0]?.tool_calls as Array<{ function: { name: string } }>;
  assert.equal(historicalCalls[0]?.function.name, "computer__list_apps");
});

test("uses system instructions by default and developer only when explicitly selected", () => {
  const automatic = transformResponsesRequest({ request: { model: "gpt", instructions: "rules", input: [
    { type: "message", role: "developer", content: "runtime rules" },
    { type: "message", role: "user", content: "hello" },
  ] } });
  const developer = transformResponsesRequest({
    request: { model: "gpt", instructions: "rules", input: [
      { type: "message", role: "developer", content: "runtime rules" },
      { type: "message", role: "user", content: "hello" },
    ] }, instructionRole: "developer",
  });
  assert.deepEqual((automatic.body.messages as Array<{ role: string }>).map((item) => item.role), ["system", "system", "user"]);
  assert.deepEqual((developer.body.messages as Array<{ role: string }>).map((item) => item.role), ["developer", "developer", "user"]);
});

test("replays reasoning history on the following assistant message", () => {
  const result = transformResponsesRequest({ request: { model: "gpt", input: [
    { type: "reasoning", summary: [{ type: "summary_text", text: "prior thought" }] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "prior answer" }] },
    { type: "message", role: "user", content: "continue" },
  ] } });
  const messages = result.body.messages as Array<Record<string, unknown>>;
  assert.equal(messages[0]?.role, "assistant");
  assert.equal(messages[0]?.reasoning_content, "prior thought");
  assert.equal(messages[1]?.role, "user");
});

test("ignores encrypted-only reasoning history without exposing it", () => {
  const result = transformResponsesRequest({ request: { model: "gpt", input: [
    { type: "reasoning", encrypted_content: "opaque-secret", summary: [] },
    { type: "message", role: "user", content: "continue" },
  ] } });
  assert.doesNotMatch(JSON.stringify(result.body), /opaque-secret/);
});

test("rejects protected overrides and unsupported input items", () => {
  assert.throws(() => transformResponsesRequest({
    request: { model: "gpt", input: "hello" }, requestOverrides: { model: "other" },
  }), /protected/);
  assert.throws(() => transformResponsesRequest({
    request: { model: "gpt", input: [{ type: "computer_call" }] },
  }), /Unsupported input item/);
});

test("blocks opaque compaction history in safe mode without exposing encrypted content", () => {
  assert.throws(() => transformResponsesRequest({
    request: { model: "gpt", input: [{ type: "compaction", encrypted_content: "secret" }] },
    longConversationStrategy: "safe",
  }), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "INCOMPATIBLE_COMPACTION");
    assert.equal((error as Error).message, "当前会话包含无法转换的压缩历史，请新建窗口继续。");
    assert.doesNotMatch((error as Error).message, /secret/);
    return true;
  });
});

test("filters opaque compaction history in continuity mode and returns a warning", () => {
  const result = transformResponsesRequest({
    request: { model: "gpt", input: [
      { type: "message", role: "user", content: "keep" },
      { type: "compaction", encrypted_content: "secret" },
      { type: "message", role: "user", content: "continue" },
    ] },
    longConversationStrategy: "continuity",
  });
  assert.equal(result.warning, "已使用可读取的历史继续，部分早期上下文可能丢失。");
  assert.equal((result.body.messages as unknown[]).length, 2);
  assert.doesNotMatch(JSON.stringify(result.body), /secret/);
});
