import test from "node:test";
import assert from "node:assert/strict";

import { buildToolRegistry } from "./tool-registry.js";
import { transformChatStream } from "./stream-transformer.js";

function upstream(events: unknown[], splitEvery = 7): ReadableStream<Uint8Array> {
  const text = events.map((event) => event === "[DONE]" ? "data: [DONE]\n\n" : `data: ${JSON.stringify(event)}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += splitEvery) controller.enqueue(bytes.slice(i, i + splitEvery)); controller.close(); } });
}

async function readEvents(stream: ReadableStream<Uint8Array>) {
  const text = await new Response(stream).text();
  return text.split("\n\n").filter(Boolean).map((block) => JSON.parse(block.split("\n").find((line) => line.startsWith("data: "))!.slice(6)));
}

test("translates text, reasoning, interleaved tools and usage into ordered Responses events", async () => {
  const registry = buildToolRegistry({ tools: [{ type: "function", name: "read" }, { type: "function", name: "write" }] });
  let completedCalls = 0;
  const events = await readEvents(transformChatStream({ model: "model", registry, responseId: "resp_test", onCompleted: (result) => { completedCalls = result.calls.length; }, body: upstream([
    { choices: [{ delta: { reasoning_content: "thinking" } }] },
    { choices: [{ delta: { content: "hello" } }] },
    { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: "{\"x\":" } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-a", function: { name: "read", arguments: "{}" } },
      { index: 1, id: "call-b", function: { name: "write", arguments: "1}" } }] } }] },
    { choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }, "[DONE]",
  ]) }));
  assert.equal(events[0]?.type, "response.created");
  assert(events.some((event) => event.type === "response.output_text.delta"));
  assert(events.some((event) => event.type === "response.reasoning_summary_text.delta"));
  assert.equal(events.filter((event) => event.type === "response.output_item.done" && event.item?.type === "function_call").length, 2);
  assert.equal(events.at(-1)?.type, "response.completed");
  assert.equal(events.at(-1)?.response.usage.total_tokens, 8);
  assert.equal(completedCalls, 2);
});

test("buffers Chat tool arguments and drops empty or malformed calls", async () => {
  let completedCalls = 0;
  const events = await readEvents(transformChatStream({
    model: "model", registry: buildToolRegistry({}),
    onCompleted: ({ calls }) => { completedCalls = calls.length; },
    body: upstream([
      { choices: [{ delta: { tool_calls: [
        { index: 0, id: "empty", function: { name: "empty", arguments: "" } },
        { index: 1, id: "bad", function: { name: "bad", arguments: "{oops" } },
        { index: 2, id: "valid", function: { name: "valid", arguments: "{" } },
      ] }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 2, function: { arguments: "}" } }] }, finish_reason: "tool_calls" }] },
      "[DONE]",
    ]),
  }));
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes('"call_id":"empty"'), false);
  assert.equal(serialized.includes('"call_id":"bad"'), false);
  assert.equal(serialized.includes('"call_id":"valid"'), true);
  assert.equal(serialized.includes('"arguments":""'), false);
  assert.equal(completedCalls, 1);
});

test("fails instead of silently completing when tool_calls has no valid call", async () => {
  const events = await readEvents(transformChatStream({
    model: "model", registry: buildToolRegistry({ tools: [{ type: "function", name: "read" }] }),
    body: upstream([
      { choices: [{ delta: { content: "我来看一下这个项目的结构和说明文件。", tool_calls: [{ index: 0, id: "broken", function: { name: "read", arguments: "" } }] }, finish_reason: "tool_calls" }] },
      "[DONE]",
    ]),
  }));
  assert.equal(events.at(-1)?.type, "response.failed");
  assert.equal(events.at(-1)?.response.error.code, "upstream_protocol");
  assert.match(events.at(-1)?.response.error.message, /no valid tool call arguments/);
});

test("accepts object arguments and plain text for custom tools in a stream", async () => {
  let completedCalls = 0;
  const events = await readEvents(transformChatStream({
    model: "model", registry: buildToolRegistry({ tools: [{ type: "web_search" }] }),
    onCompleted: ({ calls }) => { completedCalls = calls.length; },
    body: upstream([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "search", function: { name: "web_search", arguments: "search project docs" } }] }, finish_reason: "tool_calls" }] },
      "[DONE]",
    ]),
  }));
  assert.equal(events.at(-1)?.type, "response.completed");
  assert.equal(completedCalls, 1);
  assert.equal(events.at(-1)?.response.output.some((item: { type?: string; arguments?: string }) => item.type === "function_call" && item.arguments === '{"input":"search project docs"}'), true);
});

test("accepts provider tool-call deltas with top-level name and arguments", async () => {
  let completedCalls = 0;
  const events = await readEvents(transformChatStream({
    model: "model", registry: buildToolRegistry({ tools: [{ type: "function", name: "read" }] }),
    onCompleted: ({ calls }) => { completedCalls = calls.length; },
    body: upstream([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "top-level", name: "read", arguments: "{\"path\":\"README.md\"}" }] }, finish_reason: "tool_calls" }] },
      "[DONE]",
    ]),
  }));
  assert.equal(events.at(-1)?.type, "response.completed");
  assert.equal(completedCalls, 1);
  assert.equal(events.at(-1)?.response.output.some((item: { type?: string; arguments?: string }) => item.type === "function_call" && item.arguments === '{"path":"README.md"}'), true);
});

test("does not treat an empty tool_calls array as a tool-call attempt", async () => {
  const events = await readEvents(transformChatStream({
    model: "model", registry: buildToolRegistry({}),
    body: upstream([
      { choices: [{ delta: { content: "answer", tool_calls: [] }, finish_reason: "stop" }] },
      "[DONE]",
    ]),
  }));
  assert.equal(events.at(-1)?.type, "response.completed");
});

test("malformed upstream JSON produces a failed event", async () => {
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("data: {bad}\n\n")); controller.close(); } });
  const events = await readEvents(transformChatStream({ model: "model", registry: buildToolRegistry({}), body }));
  assert.equal(events.at(-1)?.type, "response.failed");
});

test("emits one visible warning before streamed model text", async () => {
  const events = await readEvents(transformChatStream({
    model: "model", registry: buildToolRegistry({}), warning: "context warning",
    body: upstream([{ choices: [{ delta: { content: "answer" } }] }, "[DONE]"]),
  }));
  const deltas = events.filter((event) => event.type === "response.output_text.delta").map((event) => event.delta);
  assert.deepEqual(deltas, ["context warning\n\n", "answer"]);
});
