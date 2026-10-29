import test from "node:test";
import assert from "node:assert/strict";

import { ConversationHistoryStore, resolveHistoryScope } from "./history-store.js";

const call = (id: string, name = "read") => ({ id, type: "function" as const, function: { name, arguments: "{}" } });

test("restores matching calls from previous response and unique fallback", async () => {
  const history = new ConversationHistoryStore();
  await history.recordResponse("route-a", { responseId: "resp-a", createdAt: Date.now(), calls: [call("call-1"), call("call-2")] });
  const restored = await history.enrichRequest("route-a", {
    previous_response_id: "resp-a", input: [{ type: "function_call_output", call_id: "call-1", output: "ok" }],
  });
  assert.equal(restored.restoredCount, 1);
  assert.equal((restored.request.input as Array<Record<string, unknown>>)[0]?.type, "function_call");
  assert.equal("previous_response_id" in restored.request, false);
  const fallback = await history.enrichRequest("route-a", {
    previous_response_id: "missing", input: [{ type: "function_call_output", call_id: "call-2", output: "ok" }],
  });
  assert.equal(fallback.restoredCount, 1);
});

test("history isolates routes, rejects ambiguous fallback, and prunes by LRU and TTL", async () => {
  let now = 1_000;
  const history = new ConversationHistoryStore({ maxResponses: 2, ttlMs: 100, now: () => now });
  await history.recordResponse("route-a", { responseId: "a", createdAt: now, calls: [call("same")] });
  await history.recordResponse("route-a", { responseId: "b", createdAt: now, calls: [call("same")] });
  await assert.rejects(() => history.enrichRequest("route-a", { input: [{ type: "function_call_output", call_id: "same", output: "x" }] }), /Ambiguous/);
  await history.recordResponse("route-a", { responseId: "c", createdAt: now, calls: [call("third")] });
  assert.deepEqual(history.snapshot("route-a").responses.map((item) => item.responseId), ["b", "c"]);
  assert.equal((await history.enrichRequest("route-b", { input: [{ type: "function_call_output", call_id: "third", output: "x" }] })).restoredCount, 0);
  now += 101;
  history.prune();
  assert.equal(history.snapshot("route-a").responses.length, 0);
});

test("restores calls immediately before a contiguous tool-output run", async () => {
  const history = new ConversationHistoryStore();
  await history.recordResponse("route-a", { responseId: "resp-a", createdAt: 1, calls: [call("call-a"), call("call-b")] });
  const result = await history.enrichRequest("route-a", {
    previous_response_id: "resp-a",
    input: [
      { type: "message", role: "user", content: "continue" },
      { type: "function_call_output", call_id: "call-b", output: "B" },
      { type: "function_call_output", call_id: "call-a", output: "A" },
    ],
  });
  const input = result.request.input as Array<Record<string, unknown>>;
  assert.deepEqual(input.map((item) => item.type), ["message", "function_call", "function_call", "function_call_output", "function_call_output"]);
  assert.deepEqual(input.slice(1, 3).map((item) => item.call_id), ["call-a", "call-b"]);
});

test("does not expire persisted history unless a TTL is explicitly configured", async () => {
  let now = 10_000;
  const history = new ConversationHistoryStore({ now: () => now });
  await history.recordResponse("route-a", { responseId: "old", createdAt: 1, calls: [call("old-call")] });
  now += 365 * 24 * 60 * 60 * 1000;
  const result = await history.enrichRequest("route-a", { input: [{ type: "function_call_output", call_id: "old-call", output: "ok" }] });
  assert.equal(result.restoredCount, 1);
});

test("scopes history by client conversation when available", () => {
  assert.equal(resolveHistoryScope("route", { conversation_id: "conv-1" }), "route::conversation:conv-1");
  assert.equal(resolveHistoryScope("route", { metadata: { threadId: "thread-1" } }), "route::conversation:thread-1");
  assert.equal(resolveHistoryScope("route", { input: "hello" }), "route");
});

test("serializes concurrent hydrate and persistence operations per route", async () => {
  let loads = 0;
  const saves: string[][] = [];
  const persistence = {
    async load() {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { routeId: "route", responses: [{ responseId: "loaded", createdAt: Date.now(), calls: [call("loaded")] }] };
    },
    async save(snapshot: { responses: Array<{ responseId: string }> }) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      saves.push(snapshot.responses.map((response) => response.responseId));
    },
    async delete() { /* no-op */ },
  };
  const history = new ConversationHistoryStore({ persistence });
  await Promise.all([
    history.enrichRequest("route", { input: [{ type: "function_call_output", call_id: "loaded", output: "ok" }] }),
    history.enrichRequest("route", { input: [{ type: "function_call_output", call_id: "loaded", output: "ok" }] }),
  ]);
  assert.equal(loads, 1);
  await Promise.all([
    history.recordResponse("route", { responseId: "a", createdAt: Date.now(), calls: [call("a")] }),
    history.recordResponse("route", { responseId: "b", createdAt: Date.now(), calls: [call("b")] }),
  ]);
  assert.deepEqual(saves.at(-1), ["loaded", "a", "b"]);
});

test("history drops polluted empty and malformed tool calls", async () => {
  const history = new ConversationHistoryStore();
  await history.recordResponse("route", {
    responseId: "resp",
    createdAt: Date.now(),
    calls: [
      { id: "empty", type: "function", function: { name: "empty", arguments: "" } },
      { id: "bad", type: "function", function: { name: "bad", arguments: "{oops" } },
      { id: "valid", type: "function", function: { name: "valid", arguments: "{}" } },
    ],
  });
  const snapshot = history.snapshot("route");
  assert.deepEqual(snapshot.responses[0]?.calls.map((item) => item.id), ["valid"]);
  const restored = await history.enrichRequest("route", {
    previous_response_id: "resp",
    input: [{ type: "function_call_output", call_id: "valid", output: "ok" }],
  });
  assert.equal(restored.restoredCount, 1);
});
