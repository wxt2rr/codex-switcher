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
  assert.equal(JSON.stringify([...first.value, ...second.value]).includes("{\\\"q\\\":"), true);
  assert.equal(final.value.some((event) => event.type === "response.completed"), true);
  assert.equal(state.usage.inputTokens, 2);
  assert.equal(state.usage.outputTokens, 4);
  assert.equal(state.ended, true);
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
