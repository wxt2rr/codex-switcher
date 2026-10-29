import assert from "node:assert/strict";
import test from "node:test";
import type { JsonObject } from "../protocol.js";
import { convertStreamChunk, createResponseStreamState, finalizeResponseStream } from "./stream-state.js";

test("stream state preserves chunk order, tool argument deltas and final usage", async () => {
  const state = createResponseStreamState("chat_completions", "responses", { requestId: "stream-1", upstreamModelName: "gpt" }, { emitSequenceNumber: true });
  const first = await convertStreamChunk(state, { id: "chat-1", choices: [{ delta: { content: "hel", tool_calls: [{ id: "call-1", function: { name: "search", arguments: "{\"q\":" } }] }, finish_reason: null }] });
  const second = await convertStreamChunk(state, { id: "chat-1", choices: [{ delta: { content: "lo", tool_calls: [{ id: "call-1", function: { arguments: "\"hi\"}" } }] }, finish_reason: null }] });
  const final = await convertStreamChunk(state, { id: "chat-1", choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 2, completion_tokens: 4 } });
  assert.equal(first.value[0]?.type, "response.created");
  assert.equal(JSON.stringify([...first.value, ...second.value]).includes("hel"), true);
  assert.equal(JSON.stringify([...first.value, ...second.value]).includes("lo"), true);
  assert.equal(JSON.stringify([...first.value, ...second.value]).includes("function_call_arguments.delta"), false);
  assert.equal(JSON.stringify(final.value).includes("{\\\"q\\\":\\\"hi\\\"}"), true);
  assert.equal(final.value.some((event) => event.type === "response.completed"), true);
  assert.equal(first.value.some((event) => event.type === "response.output_item.added"), true);
  assert.equal(first.value.some((event) => event.type === "response.content_part.added"), true);
  assert.equal(final.value.some((event) => event.type === "response.output_text.done"), true);
  assert.equal(final.value.some((event) => event.type === "response.content_part.done"), true);
  assert.equal(final.value.some((event) => event.type === "response.output_item.done"), true);
  assert.equal(final.value.findIndex((event) => event.type === "response.usage") < final.value.findIndex((event) => event.type === "response.completed"), true);
  assert.equal(state.usage.inputTokens, 2);
  assert.equal(state.usage.outputTokens, 4);
  assert.equal(state.ended, true);
});

test("stream state joins indexed Chat fragments when only the first fragment has an id", async () => {
  const state = createResponseStreamState("chat_completions", "responses");
  await convertStreamChunk(state, {
    id: "chat-indexed-id",
    choices: [{ delta: { tool_calls: [{ index: 0, id: "call-weather", function: { name: "lookup", arguments: "{\"q\":" } }] }, finish_reason: null }],
  });
  const continuation = await convertStreamChunk(state, {
    id: "chat-indexed-id",
    choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"weather\"}" } }] }, finish_reason: null }],
  });
  const terminal = await finalizeResponseStream(state, "tool_calls");
  const completed = terminal.value.find((event) => event.type === "response.completed");
  assert.ok(completed);
  assert.equal((completed.response as Record<string, unknown>).output instanceof Array, true);
  assert.equal(JSON.stringify([...continuation.value, ...terminal.value]).includes("call-weather"), true);
});

test("stream state suppresses empty and malformed tool calls", async () => {
  const state = createResponseStreamState("chat_completions", "responses", { requestId: "invalid-stream" });
  const result = await convertStreamChunk(state, { id: "chat-invalid", choices: [{ delta: { tool_calls: [
    { index: 0, id: "empty", function: { name: "empty", arguments: "" } },
    { index: 1, id: "bad", function: { name: "bad", arguments: "{oops" } },
    { index: 2, id: "valid", function: { name: "valid", arguments: "{}" } },
  ] }, finish_reason: "tool_calls" }] });
  const serialized = JSON.stringify(result.value);
  assert.equal(serialized.includes('"call_id":"empty"'), false);
  assert.equal(serialized.includes('"call_id":"bad"'), false);
  assert.equal(serialized.includes('"call_id":"valid"'), true);
  assert.equal(serialized.includes('"arguments":""'), false);
});

test("stream state fails when tool_calls contains no valid call", async () => {
  const state = createResponseStreamState("chat_completions", "responses", { requestId: "invalid-only-stream" });
  const result = await convertStreamChunk(state, { id: "chat-invalid-only", choices: [{ delta: {
    content: "我来看一下这个项目的结构和说明文件。",
    tool_calls: [{ index: 0, id: "broken", function: { name: "read", arguments: "" } }],
  }, finish_reason: "tool_calls" }] });
  const failed = result.value.find((event) => event.type === "response.failed");
  assert.deepEqual((failed?.response as Record<string, unknown>)?.error, {
    code: "upstream_invalid_tool_call",
    message: "Upstream finished with 'tool_calls' but returned no valid tool call arguments; the provider likely emitted an empty or malformed tool call: read(arguments=empty)",
  });
  assert.equal(result.value.some((event) => event.type === "response.completed"), false);
  assert.equal(state.ended, true);
});

test("stream state preserves object tool arguments", async () => {
  const state = createResponseStreamState("chat_completions", "responses", { requestId: "object-stream" });
  const result = await convertStreamChunk(state, { id: "chat-object", choices: [{ delta: {
    tool_calls: [{ index: 0, id: "object-call", function: { name: "read", arguments: { path: "README.md" } } }],
  }, finish_reason: "tool_calls" }] });
  assert.equal(JSON.stringify(result.value).includes('{\\"path\\":\\"README.md\\"}'), true);
});

test("Responses-to-Chat streaming emits only complete tool arguments", async () => {
  const state = createResponseStreamState("responses", "chat_completions", { requestId: "responses-to-chat" });
  const first = await convertStreamChunk(state, {
    type: "response.function_call_arguments.delta",
    call_id: "call-1",
    name: "lookup",
    delta: "{\"q\":"
  });
  assert.equal(first.value.some((event) => Array.isArray(event.choices)
    && (event.choices as Array<Record<string, unknown>>).some((choice) => {
      const delta = choice.delta as Record<string, unknown> | undefined;
      return Array.isArray(delta?.tool_calls);
    })), false);
  const final = await convertStreamChunk(state, {
    type: "response.completed",
    response: { id: "responses-to-chat", status: "completed" },
  });
  const toolChunk = final.value.find((event) => Array.isArray(event.choices)
    && (event.choices as Array<Record<string, unknown>>).some((choice) => Array.isArray((choice.delta as Record<string, unknown> | undefined)?.tool_calls)));
  const delta = ((toolChunk?.choices as Array<Record<string, unknown>> | undefined)?.[0])?.delta as Record<string, unknown> | undefined;
  const toolCall = (delta?.tool_calls as Array<Record<string, unknown>> | undefined)?.[0];
  assert.equal((toolCall?.function as Record<string, unknown> | undefined)?.arguments, undefined);

  // A split call is only emitted once the terminal frame supplies the rest.
  const complete = createResponseStreamState("responses", "chat_completions", { requestId: "responses-to-chat-complete" });
  await convertStreamChunk(complete, { type: "response.function_call_arguments.delta", call_id: "call-2", name: "lookup", delta: "{\"q\":" });
  const completeResult = await convertStreamChunk(complete, { type: "response.function_call_arguments.delta", call_id: "call-2", delta: "\"x\"}" });
  assert.equal(completeResult.value.length, 0);
  const completeFinal = await convertStreamChunk(complete, { type: "response.completed", response: { status: "completed" } });
  const completeTool = completeFinal.value.find((event) => Array.isArray(event.choices)
    && (event.choices as Array<Record<string, unknown>>).some((choice) => Array.isArray((choice.delta as Record<string, unknown> | undefined)?.tool_calls)));
  const completeDelta = ((completeTool?.choices as Array<Record<string, unknown>> | undefined)?.[0])?.delta as Record<string, unknown> | undefined;
  assert.equal(((completeDelta?.tool_calls as Array<Record<string, unknown>>)[0]?.function as Record<string, unknown>).arguments, "{\"q\":\"x\"}");
});

test("stream finalization emits a terminal event and rejects reuse", async () => {
  const state = createResponseStreamState("responses", "chat_completions", { requestId: "stream-2" });
  const result = await finalizeResponseStream(state);
  assert.equal(result.value[0]?.object, "chat.completion.chunk");
  assert.equal(state.ended, true);
  await assert.rejects(convertStreamChunk(state, { id: "r", output: [] }), /already finalized/);
});

test("stream decoder understands native Responses and Anthropic event envelopes", async () => {
  const responses = createResponseStreamState("responses", "chat_completions", { requestId: "responses-stream" });
  const responseText = await convertStreamChunk(responses, { type: "response.output_text.delta", delta: "hello" });
  assert.equal(JSON.stringify(responseText.value).includes('"hello"'), true);
  const responseEnd = await convertStreamChunk(responses, { type: "response.completed", response: { id: "r", status: "completed", usage: { input_tokens: 3, output_tokens: 2 } } });
  assert.equal(JSON.stringify(responseEnd.value).includes('"finish_reason":"stop"'), true);

  const anthropic = createResponseStreamState("anthropic", "responses", { requestId: "anthropic-stream" });
  const thinking = await convertStreamChunk(anthropic, { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "think" } });
  assert.equal(thinking.value.some((event) => event.type === "response.reasoning_summary_text.delta"), true);
  const text = await convertStreamChunk(anthropic, { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "hello" } });
  assert.equal(text.value.some((event) => event.type === "response.output_text.delta"), true);
  const end = await convertStreamChunk(anthropic, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { input_tokens: 3, output_tokens: 2 } });
  assert.equal(end.value.some((event) => event.type === "response.completed"), true);

  const anthropicTarget = createResponseStreamState("chat_completions", "anthropic", { requestId: "anthropic-target" });
  const targetText = await convertStreamChunk(anthropicTarget, { choices: [{ delta: { content: "hello" }, finish_reason: null }] });
  assert.equal(targetText.value.some((event) => event.type === "content_block_start"), true);
  assert.equal(targetText.value.some((event) => event.type === "content_block_delta"), true);
  const targetEnd = await convertStreamChunk(anthropicTarget, { choices: [{ delta: {}, finish_reason: "stop" }] });
  assert.equal(targetEnd.value.some((event) => event.type === "message_delta"), true);
  assert.equal(targetEnd.value.some((event) => event.type === "message_stop"), true);
});

test("stream conversion covers every protocol direction with native terminal chunks", async () => {
  const chunks = {
    responses: [{ type: "response.output_text.delta", delta: "hello" }, { type: "response.completed", response: { status: "completed", usage: { input_tokens: 1, output_tokens: 1 } } }],
    chat_completions: [{ id: "chat", choices: [{ delta: { content: "hello" }, finish_reason: null }] }, { id: "chat", choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }],
    anthropic: [{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } }, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { input_tokens: 1, output_tokens: 1 } }],
    gemini: [{ responseId: "gemini", candidates: [{ content: { parts: [{ text: "hello" }] } }] }, { responseId: "gemini", candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }],
  } as const;
  const protocols = Object.keys(chunks) as Array<keyof typeof chunks>;
  for (const source of protocols) for (const target of protocols) {
    const state = createResponseStreamState(source, target, { requestId: `${source}-${target}` });
    const results = [];
    for (const chunk of chunks[source]) results.push(await convertStreamChunk(state, chunk as unknown as JsonObject));
    assert.equal(results.some((result) => result.value.length > 0), true, `${source}->${target}`);
  }
});
