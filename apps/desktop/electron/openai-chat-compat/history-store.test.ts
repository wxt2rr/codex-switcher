import test from "node:test";
import assert from "node:assert/strict";

import { ConversationHistoryStore } from "./history-store.js";

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
