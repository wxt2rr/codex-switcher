import assert from "node:assert/strict";
import test from "node:test";
import type { JsonObject } from "../protocol.js";
import { convertGatewayResponse, decodeResponseEvents, encodeResponseEvents } from "./response-converter.js";
import { convertStreamChunk, createResponseStreamState } from "./stream-state.js";
import { decodeUsage, encodeUsage } from "./usage.js";

const responseBodies = {
  responses: { id: "resp-1", output: [{ type: "message", content: [{ type: "output_text", text: "hello" }] }, { type: "reasoning", content: [{ type: "reasoning_text", text: "think" }] }, { type: "function_call", call_id: "call-1", name: "search", arguments: "{\"q\":\"hello\"}" }], usage: { input_tokens: 4, output_tokens: 3, reasoning_tokens: 2, cached_tokens: 1 } },
  chat_completions: { id: "chat-1", choices: [{ message: { role: "assistant", content: "hello", reasoning_content: "think", tool_calls: [{ id: "call-1", type: "function", function: { name: "search", arguments: "{\"q\":\"hello\"}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 4, completion_tokens: 3, completion_tokens_details: { reasoning_tokens: 2 }, prompt_tokens_details: { cached_tokens: 1 } } },
  anthropic: { id: "anthropic-1", content: [{ type: "thinking", thinking: "think" }, { type: "text", text: "hello" }, { type: "tool_use", id: "call-1", name: "search", input: { q: "hello" } }], stop_reason: "tool_use", usage: { input_tokens: 4, output_tokens: 3, cache_read_input_tokens: 1 } },
  gemini: { responseId: "gemini-1", candidates: [{ content: { parts: [{ text: "think", thought: true }, { text: "hello" }, { functionCall: { name: "search", args: { q: "hello" } } }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3, thoughtsTokenCount: 2 } },
} as const;

test("response conversion normalizes all four source protocols", async () => {
  for (const source of Object.keys(responseBodies) as Array<keyof typeof responseBodies>) {
    const events = decodeResponseEvents(source, responseBodies[source] as unknown as JsonObject);
    assert.equal(events.some((event) => event.type === "text_delta" && event.text === "hello"), true, source);
    assert.equal(events.some((event) => event.type === "reasoning_delta"), true, source);
    assert.equal(events.some((event) => event.type === "tool_call_delta"), true, source);
    for (const target of Object.keys(responseBodies) as Array<keyof typeof responseBodies>) {
      const result = await convertGatewayResponse(source, target, responseBodies[source] as unknown as JsonObject, { originModelName: "logical", upstreamModelName: "upstream" });
      assert.ok(JSON.stringify(result.value).includes("hello"), `${source}->${target}`);
      assert.ok(JSON.stringify(result.value).includes("search"), `${source}->${target}`);
    }
  }
});

test("usage conversion accepts and emits official nested token details", () => {
  const usage = decodeUsage("responses", {
    usage: {
      input_tokens: 10,
      output_tokens: 8,
      input_tokens_details: { cached_tokens: 4 },
      output_tokens_details: { reasoning_tokens: 3 },
      cache_creation_input_tokens: 2,
    },
  });
  assert.deepEqual(usage && {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  }, { inputTokens: 10, outputTokens: 8, reasoningTokens: 3, cacheReadTokens: 4, cacheWriteTokens: 2 });
  assert.deepEqual(encodeUsage("responses", usage!), {
    input_tokens: 10,
    output_tokens: 8,
    total_tokens: 18,
    output_tokens_details: { reasoning_tokens: 3 },
    input_tokens_details: { cached_tokens: 4 },
    reasoning_tokens: 3,
    cached_tokens: 4,
    cache_creation_input_tokens: 2,
  });
});

test("response conversion keeps ID-less Gemini and indexed Chat tool calls separate", async () => {
  const gemini = await convertGatewayResponse("gemini", "responses", {
    responseId: "gemini-tools",
    candidates: [{ content: { role: "model", parts: [
      { functionCall: { name: "alpha", args: { value: 1 } } },
      { functionCall: { name: "beta", args: { value: 2 } } },
    ] }, finishReason: "STOP" }],
  });
  assert.deepEqual((gemini.value.output as Array<Record<string, unknown>>).filter((item) => item.type === "function_call").map((item) => item.call_id), ["name:alpha", "name:beta"]);

  const chat = await convertGatewayResponse("chat_completions", "responses", {
    id: "chat-tools",
    choices: [{ delta: { tool_calls: [
      { index: 0, function: { name: "alpha", arguments: "{}" } },
      { index: 1, function: { name: "beta", arguments: "{}" } },
    ] }, finish_reason: "tool_calls" }],
  });
  assert.deepEqual((chat.value.output as Array<Record<string, unknown>>).filter((item) => item.type === "function_call").map((item) => item.call_id), ["index:0", "index:1"]);
});

test("response encoding accumulates tool argument deltas and usage", () => {
  const events = decodeResponseEvents("chat_completions", { id: "r", choices: [{ delta: { content: "hello", tool_calls: [{ id: "c", function: { name: "search", arguments: "{\"q\":\"hello\"}" } }] }, finish_reason: null }], usage: { prompt_tokens: 2, completion_tokens: 3 } });
  const value = encodeResponseEvents("responses", events, { upstreamModelName: "upstream" });
  assert.equal(value.object, "response");
  assert.equal(JSON.stringify(value).includes("hello"), true);
  assert.equal(JSON.stringify(value).includes("search"), true);
});

test("response conversion omits empty and malformed tool arguments", async () => {
  const result = await convertGatewayResponse("chat_completions", "responses", {
    id: "invalid-tools",
    choices: [{ message: { role: "assistant", tool_calls: [
      { id: "empty", function: { name: "empty", arguments: "" } },
      { id: "bad", function: { name: "bad", arguments: "{oops" } },
      { id: "valid", function: { name: "valid", arguments: "{}" } },
    ] }, finish_reason: "tool_calls" }],
  });
  const calls = (result.value.output as Array<Record<string, unknown>>).filter((item) => item.type === "function_call");
  assert.deepEqual(calls.map((call) => call.call_id), ["valid"]);
  assert.equal(JSON.stringify(result.value).includes('arguments":""'), false);
});

test("response conversion reports an invalid tool turn instead of silently completing", async () => {
  const result = await convertGatewayResponse("chat_completions", "responses", {
    id: "invalid-only-tools",
    choices: [{ message: { role: "assistant", content: "我来看一下这个项目的结构和说明文件。", tool_calls: [
      { id: "broken", function: { name: "read", arguments: "" } },
    ] }, finish_reason: "tool_calls" }],
  });
  assert.deepEqual(result.value.error, {
    code: "upstream_invalid_tool_call",
    message: "Upstream finished with 'tool_calls' but returned no valid tool call arguments (1 invalid call)",
    retryable: false,
    type: "gateway_error",
  });
});

test("response conversion rejects malformed tools even when the provider reports stop", async () => {
  const result = await convertGatewayResponse("chat_completions", "responses", {
    id: "invalid-stop-tools",
    choices: [{ message: { role: "assistant", content: "先检查一下。", tool_calls: [
      { id: "broken-stop", function: { name: "read", arguments: "{" } },
    ] }, finish_reason: "stop" }],
  });
  assert.equal((result.value.error as Record<string, unknown>)?.code, "upstream_invalid_tool_call");
});

test("response conversion accepts object tool arguments", async () => {
  const result = await convertGatewayResponse("chat_completions", "responses", {
    id: "object-tools",
    choices: [{ message: { role: "assistant", tool_calls: [
      { id: "object-call", function: { name: "read", arguments: { path: "README.md" } } },
    ] }, finish_reason: "tool_calls" }],
  });
  assert.deepEqual((result.value.output as Array<Record<string, unknown>>).find((item) => item.type === "function_call")?.arguments, '{"path":"README.md"}');
});

test("response conversion accepts top-level Chat tool-call fields", async () => {
  const result = await convertGatewayResponse("chat_completions", "responses", {
    id: "top-level-tools",
    choices: [{ message: { role: "assistant", tool_calls: [
      { id: "top-level-call", name: "read", arguments: { path: "README.md" } },
    ] }, finish_reason: "tool_calls" }],
  });
  const call = (result.value.output as Array<Record<string, unknown>>).find((item) => item.type === "function_call");
  assert.equal(call?.name, "read");
  assert.equal(call?.arguments, '{"path":"README.md"}');
});

test("Responses tool-call done events preserve names and replace buffered fragments", () => {
  const added = decodeResponseEvents("responses", {
    type: "response.output_item.added",
    item: { type: "function_call", id: "fc_1", call_id: "call-1", name: "crm__lookup", arguments: "" },
  }, { toolNameMap: { crm__lookup: "lookup" } });
  assert.deepEqual(added.find((event) => event.type === "tool_call_delta"), {
    type: "tool_call_delta", callId: "call-1", name: "lookup", argumentsDelta: "", kind: "function", itemId: "fc_1", raw: { type: "function_call", id: "fc_1", call_id: "call-1", name: "crm__lookup", arguments: "" },
  });
  const done = decodeResponseEvents("responses", {
    type: "response.function_call_arguments.done", item_id: "fc_1", call_id: "call-1", name: "crm__lookup", arguments: '{"q":"x"}',
  }, { toolNameMap: { crm__lookup: "lookup" } });
  assert.equal(done.find((event) => event.type === "tool_call_delta")?.argumentsFinal, true);
  const value = encodeResponseEvents("responses", [...added, ...done], { toolNameMap: { crm__lookup: "lookup" } });
  assert.deepEqual((value.output as Array<Record<string, unknown>>).find((item) => item.type === "function_call"), {
    type: "function_call", id: "fc_1", call_id: "call-1", name: "lookup", arguments: '{"q":"x"}',
  });
});

test("custom tool calls stay custom on Responses and hosted calls fail on incompatible targets", async () => {
  const custom = await convertGatewayResponse("responses", "responses", {
    id: "custom-response",
    output: [{ type: "custom_tool_call", call_id: "custom-1", name: "emit_text", input: "plain text" }],
  });
  assert.deepEqual((custom.value.output as Array<Record<string, unknown>>).find((item) => item.type === "custom_tool_call"), {
    type: "custom_tool_call", call_id: "custom-1", name: "emit_text", input: "plain text",
  });
  const customDowngrade = await convertGatewayResponse("responses", "chat_completions", {
    id: "custom-chat-response",
    output: [{ type: "custom_tool_call", call_id: "custom-2", name: "emit_text", input: "plain text" }],
  });
  assert.deepEqual((customDowngrade.value.choices as Array<Record<string, unknown>>)[0]?.message, {
    role: "assistant",
    content: null,
    tool_calls: [{ id: "custom-2", type: "function", function: { name: "emit_text", arguments: JSON.stringify({ input: "plain text" }) } }],
  });

  const hosted = await convertGatewayResponse("responses", "chat_completions", {
    id: "hosted-response",
    output: [{ type: "web_search_call", id: "search-1", status: "completed", action: { type: "search" } }],
  });
  assert.equal((hosted.value.error as Record<string, unknown>)?.code, "unsupported_hosted_tool_response");
});

test("Responses tool calls restore namespace and tool-search semantics", async () => {
  const result = await convertGatewayResponse("chat_completions", "responses", {
    id: "namespaced-response",
    choices: [{ message: { role: "assistant", tool_calls: [{ id: "call-1", type: "function", function: { name: "crm__lookup", arguments: "{\"q\":\"x\"}" } }] }, finish_reason: "tool_calls" }],
  }, {
    toolNameMap: { "crm__lookup": "lookup" },
    toolNamespaceMap: { "crm__lookup": "crm" },
  });
  assert.deepEqual((result.value.output as Array<Record<string, unknown>>).find((item) => item.type === "function_call"), {
    type: "function_call", call_id: "call-1", name: "lookup", namespace: "crm", arguments: "{\"q\":\"x\"}",
  });

  const toolSearch = await convertGatewayResponse("responses", "responses", {
    id: "tool-search-response",
    output: [{ type: "tool_search_call", call_id: "search-1", name: "tool_search", input: { query: "lookup" } }],
  });
  assert.equal((toolSearch.value.output as Array<Record<string, unknown>>)[0]?.type, "tool_search_call");
});

test("response conversion preserves annotations, refusal, media and reasoning signatures", async () => {
  const anthropic = await convertGatewayResponse("anthropic", "responses", {
    id: "rich-anthropic",
    content: [
      { type: "thinking", thinking: "think", signature: "sig-a" },
      { type: "text", text: "answer", citations: [{ type: "url_citation", url: "https://example.test" }] },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
    ],
  });
  const output = anthropic.value.output as Array<Record<string, unknown>>;
  assert.equal((output.find((item) => item.type === "reasoning")?.summary as Array<Record<string, unknown>>)?.[0]?.signature, "sig-a");
  assert.equal(output.some((item) => JSON.stringify(item).includes("output_image")), true);

  const responses = await convertGatewayResponse("responses", "chat_completions", {
    id: "rich-responses",
    output: [{ type: "message", role: "assistant", content: [
      { type: "refusal", refusal: "cannot" },
      { type: "output_text", text: "fallback", annotations: [{ type: "url_citation", url: "https://example.test" }] },
      { type: "output_image", image_url: "https://example.test/image.png" },
    ] }],
  });
  const message = ((responses.value.choices as Array<Record<string, unknown>>)[0]?.message) as Record<string, unknown>;
  assert.equal(Array.isArray(message.content), true);
  assert.equal(message.refusal, "cannot");
});

test("Anthropic citations are retained as canonical annotations", () => {
  const events = decodeResponseEvents("anthropic", {
    id: "citation-response",
    content: [{ type: "text", text: "source-backed", citations: [{ type: "url_citation", url: "https://example.test/a" }] }],
  });
  const text = events.find((event): event is Extract<typeof event, { type: "text_delta" }> => event.type === "text_delta");
  assert.deepEqual(text?.annotations, [{ type: "url_citation", url: "https://example.test/a" }]);
  const chat = encodeResponseEvents("chat_completions", events);
  const message = (chat.choices as JsonObject[])[0]?.message as JsonObject;
  assert.deepEqual(message.annotations, [{ type: "url_citation", url: "https://example.test/a" }]);
});

test("Anthropic redacted thinking remains an opaque reasoning payload", async () => {
  const result = await convertGatewayResponse("anthropic", "responses", {
    id: "redacted-thinking",
    content: [{ type: "redacted_thinking", data: "opaque-signature" }],
  });
  const reasoning = (result.value.output as JsonObject[]).find((item) => item.type === "reasoning");
  assert.equal(reasoning?.encrypted_content, "opaque-signature");
});

test("response conversion preserves tool-result errors and dynamic tool-search outputs", async () => {
  const result = await convertGatewayResponse("responses", "responses", {
    id: "tool-result-response",
    output: [
      { type: "tool_search_call_output", call_id: "search-1", output: [{ type: "function", name: "lookup" }], is_error: false },
      { type: "function_call_output", call_id: "call-1", output: "denied", is_error: true },
    ],
  });
  assert.deepEqual((result.value.output as Array<Record<string, unknown>>).map((item) => item.type), ["tool_search_call_output", "function_call_output"]);
  assert.equal((result.value.output as Array<Record<string, unknown>>)[1]?.is_error, true);
});

test("Responses tool-search output keeps its native item type and payload", async () => {
  const result = await convertGatewayResponse("responses", "responses", {
    id: "tool-search-native",
    output: [{ type: "tool_search_output", id: "search-output", call_id: "search-1", tools: [{ type: "function", name: "lookup" }], output: [{ type: "function", name: "lookup" }] }],
  });
  const item = (result.value.output as JsonObject[])[0];
  assert.equal(item.type, "tool_search_output");
  assert.deepEqual(item.tools, [{ type: "function", name: "lookup" }]);
});

test("tool-result errors survive non-stream and stream round-trips", async () => {
  const source: JsonObject = {
    id: "response-with-result",
    output: [{ type: "function_call_output", call_id: "call-1", output: "denied", is_error: true }],
    status: "completed",
  };
  const chat = await convertGatewayResponse("responses", "chat_completions", source);
  const chatMessage = (chat.value.choices as JsonObject[])[0] as JsonObject;
  assert.equal(JSON.stringify(chatMessage).includes('"is_error":true'), true);
  const back = decodeResponseEvents("chat_completions", chat.value);
  assert.equal(back.some((event) => event.type === "tool_result" && event.isError === true), true);

  const state = createResponseStreamState("responses", "chat_completions", { requestId: "stream-result" });
  const result = await convertStreamChunk(state, {
    type: "response.output_item.done",
    item: { type: "function_call_output", call_id: "call-1", output: "denied", is_error: true },
  });
  assert.equal(JSON.stringify(result.value).includes('"is_error":true'), true);
});

test("Anthropic thinking and tool block signatures/call ids survive stream decoding", async () => {
  const thinking = decodeResponseEvents("anthropic", {
    type: "content_block_start", index: 0,
    content_block: { type: "thinking", thinking: "plan", signature: "sig-start" },
  });
  assert.deepEqual(thinking.find((event) => event.type === "reasoning_delta"), { type: "reasoning_delta", text: "plan", signature: "sig-start" });
  const tool = decodeResponseEvents("anthropic", {
    type: "content_block_start", index: 1,
    content_block: { type: "tool_use", id: "tool-real", name: "lookup", input: {} },
  });
  const delta = decodeResponseEvents("anthropic", {
    type: "content_block_delta", index: 1,
    delta: { type: "input_json_delta", partial_json: "{\"q\":\"x\"}" },
  });
  assert.equal(tool.find((event) => event.type === "tool_call_delta")?.callId, "tool-real");
  assert.equal(delta.find((event) => event.type === "tool_call_delta")?.index, 1);
  const toolResult = decodeResponseEvents("anthropic", {
    type: "content_block_start", index: 2,
    content_block: { type: "tool_result", tool_use_id: "tool-real", content: "denied", is_error: true },
  });
  assert.deepEqual(toolResult.find((event) => event.type === "tool_result"), {
    type: "tool_result", callId: "tool-real", output: "denied", isError: true, kind: "function", raw: { type: "tool_result", tool_use_id: "tool-real", content: "denied", is_error: true },
  });
});

test("Gemini function-call thought signatures and duplicate names remain distinguishable", async () => {
  const events = decodeResponseEvents("gemini", {
    responseId: "gemini-signature",
    candidates: [{ content: { parts: [
      { functionCall: { name: "lookup", args: { q: "a" } }, thoughtSignature: "sig-a" },
      { functionCall: { name: "lookup", args: { q: "b" } }, thoughtSignature: "sig-b" },
    ] }, finishReason: "STOP" }],
  });
  const calls = events.filter((event) => event.type === "tool_call_delta");
  assert.deepEqual(calls.map((event) => event.callId), ["name:lookup", "name:lookup:1"]);
  assert.equal((calls[0] as { raw?: JsonObject }).raw?.thoughtSignature, "sig-a");
});

test("Gemini function responses pair with explicit function-call ids", async () => {
  const result = await convertGatewayResponse("gemini", "responses", {
    responseId: "gemini-paired-result",
    candidates: [{ content: { parts: [
      { functionCall: { id: "call-explicit", name: "lookup", args: { q: "x" } } },
      { functionResponse: { name: "lookup", response: { ok: true } } },
    ] }, finishReason: "STOP" }],
  });
  const output = result.value.output as Array<Record<string, unknown>>;
  assert.equal(output.find((item) => item.type === "function_call")?.call_id, "call-explicit");
  assert.equal(output.find((item) => item.type === "function_call_output")?.call_id, "call-explicit");
});

test("Gemini function responses preserve the provider function name on a round trip", async () => {
  const result = await convertGatewayResponse("gemini", "gemini", {
    responseId: "gemini-result-name",
    candidates: [{ content: { role: "user", parts: [{ functionResponse: { name: "lookup", response: { ok: true } } }] }, finishReason: "STOP" }],
  });
  const part = ((result.value.candidates as JsonObject[])[0]?.content as JsonObject)?.parts as JsonObject[];
  assert.deepEqual(part[0]?.functionResponse, { name: "lookup", response: { ok: true } });
});

test("upstream error envelopes keep request metadata and retry evidence", async () => {
  const result = await convertGatewayResponse("chat_completions", "responses", {
    id: "error-response",
    error: { code: "rate_limit_exceeded", message: "slow down", status: 429, request_id: "upstream-req" },
  });
  assert.equal((result.value.error as Record<string, unknown>)?.code, "rate_limit_exceeded");
  assert.equal((result.value.error as Record<string, unknown>)?.status, 429);
  assert.equal((result.value.error as Record<string, unknown>)?.request_id, "upstream-req");
});

test("Responses response envelopes decode nested output and incomplete status", async () => {
  const result = await convertGatewayResponse("responses", "chat_completions", {
    response: {
      id: "nested-response",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [{ type: "message", content: [{ type: "output_text", text: "partial" }] }],
    },
  });
  const choice = (result.value.choices as Array<Record<string, unknown>>)[0];
  assert.equal((choice.message as Record<string, unknown>).content, "partial");
  assert.equal(choice.finish_reason, "max_output_tokens");
});

test("Responses incomplete details and metadata survive non-stream conversion", async () => {
  const result = await convertGatewayResponse("responses", "responses", {
    id: "incomplete-details",
    status: "incomplete",
    metadata: { trace: "t1" },
    incomplete_details: { reason: "max_output_tokens", limit: 128 },
    output: [{ type: "message", content: [{ type: "output_text", text: "partial" }] }],
  });
  assert.deepEqual(result.value.metadata, { trace: "t1" });
  assert.deepEqual(result.value.incomplete_details, { reason: "max_output_tokens", limit: 128 });
});

test("mixed text and media preserve first-seen content order", async () => {
  const result = await convertGatewayResponse("chat_completions", "responses", {
    id: "mixed-media",
    choices: [{ message: { role: "assistant", content: [
      { type: "image_url", image_url: { url: "https://example.test/a.png" } },
      { type: "text", text: "after image" },
    ] }, finish_reason: "stop" }],
  });
  const message = (result.value.output as Array<Record<string, unknown>>)[0];
  assert.deepEqual((message.content as Array<Record<string, unknown>>).map((part) => part.type), ["output_image", "output_text"]);
});

test("Responses output preserves interleaved reasoning, tools and results", async () => {
  const result = await convertGatewayResponse("responses", "responses", {
    id: "interleaved",
    output: [
      { type: "reasoning", summary: [{ type: "summary_text", text: "plan" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "before" }] },
      { type: "function_call", call_id: "call-1", name: "lookup", arguments: "{\"q\":\"x\"}" },
      { type: "function_call_output", call_id: "call-1", output: "ok" },
    ],
  });
  // The source decoder sees reasoning, text and the call in that order. The
  // result must remain executable and no longer be regrouped by item kind.
  assert.deepEqual((result.value.output as Array<Record<string, unknown>>).map((item) => item.type), ["reasoning", "message", "function_call", "function_call_output"]);
});

test("Responses keeps distinct message output items instead of merging their text", async () => {
  const result = await convertGatewayResponse("responses", "responses", {
    id: "multiple-messages",
    output: [
      { id: "msg-a", type: "message", content: [{ type: "output_text", text: "first" }] },
      { id: "msg-b", type: "message", content: [{ type: "output_text", text: "second" }] },
    ],
  });
  const output = (result.value.output as JsonObject[]).filter((item) => item.type === "message");
  assert.deepEqual(output.map((item) => item.id), ["msg-a", "msg-b"]);
  assert.deepEqual(output.map((item) => ((item.content as JsonObject[])[0]?.text)), ["first", "second"]);
});

test("Responses refusal uses the refusal content contract", async () => {
  const result = await convertGatewayResponse("chat_completions", "responses", {
    id: "refusal",
    choices: [{ message: { role: "assistant", refusal: "cannot do that" }, finish_reason: "stop" }],
  });
  const message = (result.value.output as Array<Record<string, unknown>>)[0];
  assert.deepEqual((message.content as Array<Record<string, unknown>>)[0], { type: "refusal", refusal: "cannot do that" });
});

test("Chat refusal remains a sibling field instead of duplicate content", async () => {
  const result = await convertGatewayResponse("responses", "chat_completions", {
    id: "chat-refusal",
    output: [{ type: "message", content: [{ type: "refusal", refusal: "cannot do that" }] }],
  });
  const message = ((result.value.choices as Array<Record<string, unknown>>)[0]?.message) as Record<string, unknown>;
  assert.equal(message.content, null);
  assert.equal(message.refusal, "cannot do that");
});

test("Anthropic signature_delta is retained as a reasoning signature", () => {
  const events = decodeResponseEvents("anthropic", {
    type: "content_block_delta", index: 0,
    delta: { type: "signature_delta", signature: "sig-anthropic" },
  });
  assert.deepEqual(events.find((event) => event.type === "reasoning_delta"), {
    type: "reasoning_delta", text: "", signature: "sig-anthropic",
  });
});
