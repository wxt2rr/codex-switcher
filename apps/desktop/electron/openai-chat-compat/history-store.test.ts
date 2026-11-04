import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConversationHistoryStore, resolveHistoryScope } from "./history-store.js";
import { FileHistoryPersistence } from "./history-persistence.js";

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

test("history reloads usage, status and incomplete details without changing item order", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-history-metadata-"));
  const persistence = new FileHistoryPersistence(root);
  const first = new ConversationHistoryStore({ persistence });
  await first.recordResponse("route-meta", {
    responseId: "resp-meta", createdAt: Date.now(), status: "incomplete",
    incompleteReason: "max_output_tokens", incompleteDetails: { reason: "max_output_tokens", limit: 32 },
    metadata: { trace: "trace-1" }, usage: { input_tokens: 4, output_tokens: 3 }, calls: [],
    items: [
      { type: "reasoning", summary: [{ type: "summary_text", text: "plan" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "partial" }] },
    ],
  });
  const second = new ConversationHistoryStore({ persistence });
  await second.hydrate("route-meta");
  const snapshot = second.snapshot("route-meta");
  assert.deepEqual(snapshot.responses[0], {
    responseId: "resp-meta", createdAt: snapshot.responses[0]?.createdAt, status: "incomplete",
    incompleteReason: "max_output_tokens", incompleteDetails: { reason: "max_output_tokens", limit: 32 },
    metadata: { trace: "trace-1" }, usage: { input_tokens: 4, output_tokens: 3 }, calls: [],
    items: [
      { type: "reasoning", summary: [{ type: "summary_text", text: "plan" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "partial" }] },
    ],
  });
});

test("history ignores a persistence snapshot for a different route", async () => {
  const persistence = {
    async load() { return { routeId: "other-route", responses: [{ responseId: "foreign", createdAt: Date.now(), calls: [call("foreign")] }] }; },
    async save() { /* no-op */ },
    async delete() { /* no-op */ },
  };
  const history = new ConversationHistoryStore({ persistence });
  const result = await history.enrichRequest("route-a", { input: [{ type: "function_call_output", call_id: "foreign", output: "x" }] });
  assert.equal(result.restoredCount, 0);
});

test("history bounds oversized and opaque replay items while keeping safe neighbors", async () => {
  const history = new ConversationHistoryStore();
  await history.recordResponse("route-bounded", {
    responseId: "bounded", createdAt: Date.now(), calls: [], items: [
      { type: "compaction", encrypted_content: "secret" },
      { type: "compaction_summary", summary: "readable" },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "x".repeat(600_000) }] },
    ],
  });
  const result = await history.enrichRequest("route-bounded", { previous_response_id: "bounded", input: [] });
  const text = JSON.stringify(result.request);
  assert.equal(text.includes("secret"), false);
  assert.equal(text.includes("readable"), true);
  assert.equal(text.includes('"text":"ok"'), true);
  assert.equal(text.includes("x".repeat(600_000)), false);
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

test("history restores custom and hosted Responses call kinds", async () => {
  const history = new ConversationHistoryStore();
  await history.recordResponse("route", {
    responseId: "special",
    createdAt: Date.now(),
    calls: [
      { id: "custom", type: "function", kind: "custom", function: { name: "emit", arguments: "plain text" } },
      { id: "hosted", type: "function", kind: "hosted", raw: { type: "web_search_call", id: "hosted", call_id: "hosted", status: "completed" }, function: { name: "web_search_call", arguments: "{}" } },
    ],
  });
  const restored = await history.enrichRequest("route", {
    previous_response_id: "special",
    input: [
      { type: "custom_tool_call_output", call_id: "custom", output: "ok" },
      { type: "web_search_call_output", call_id: "hosted", output: "ok" },
    ],
  });
  assert.deepEqual((restored.request.input as Array<Record<string, unknown>>).slice(0, 2).map((item) => item.type), ["custom_tool_call", "web_search_call"]);
});

test("history replays complete assistant output items before the next tool turn", async () => {
  const history = new ConversationHistoryStore();
  await history.recordResponse("route", {
    responseId: "resp-full",
    createdAt: Date.now(),
    calls: [call("call-full")],
    items: [
      { type: "reasoning", summary: [{ type: "summary_text", text: "thinking" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "I found it", annotations: [] }] },
      { type: "function_call", call_id: "call-full", name: "read", arguments: "{}" },
    ],
  });
  const restored = await history.enrichRequest("route", {
    previous_response_id: "resp-full",
    input: [{ type: "function_call_output", call_id: "call-full", output: "done" }],
  });
  assert.equal(restored.restoredCount, 1);
  assert.deepEqual((restored.request.input as Array<Record<string, unknown>>).map((item) => item.type), [
    "reasoning", "message", "function_call", "function_call_output",
  ]);
  assert.deepEqual((restored.request.input as Array<Record<string, unknown>>)[1]?.content, [
    { type: "output_text", text: "I found it", annotations: [] },
  ]);
});

test("history replays a complete previous response for ordinary follow-up turns", async () => {
  const history = new ConversationHistoryStore();
  await history.recordResponse("route", {
    responseId: "resp-text",
    createdAt: Date.now(),
    calls: [],
    items: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "previous answer" }] }],
  });
  const restored = await history.enrichRequest("route", {
    previous_response_id: "resp-text",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "follow up" }] }],
  });
  assert.equal("previous_response_id" in restored.request, false);
  assert.deepEqual((restored.request.input as Array<Record<string, unknown>>).map((item) => item.type), ["message", "message"]);
  assert.equal(JSON.stringify(restored.request).includes("previous answer"), true);
});

test("history does not replay opaque encrypted compaction payloads", async () => {
  const history = new ConversationHistoryStore();
  await history.recordResponse("route", {
    responseId: "resp-compaction",
    createdAt: Date.now(),
    calls: [],
    items: [
      { type: "compaction", encrypted_content: "secret", encrypted: true },
      { type: "compaction_summary", summary: "readable summary" },
    ],
  });
  const snapshot = history.snapshot("route");
  assert.deepEqual(snapshot.responses[0]?.items, [{ type: "compaction_summary", summary: "readable summary" }]);
});
