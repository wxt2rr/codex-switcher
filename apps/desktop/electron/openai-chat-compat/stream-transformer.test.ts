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
