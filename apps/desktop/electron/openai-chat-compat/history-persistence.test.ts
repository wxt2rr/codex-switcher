import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileHistoryPersistence } from "./history-persistence.js";
import { ConversationHistoryStore } from "./history-store.js";

test("history persists atomically with private permissions and reloads live call metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-history-"));
  const persistence = new FileHistoryPersistence(root);
  const first = new ConversationHistoryStore({ persistence });
  await first.recordResponse("route-a", { responseId: "resp", createdAt: Date.now(), calls: [
    { id: "call", type: "function", function: { name: "read", arguments: "{}" } },
  ] });
  if (process.platform !== "win32") assert.equal((await stat(join(root, "route-a.json"))).mode & 0o777, 0o600);
  await assert.rejects(() => stat(join(root, "route-a.json.tmp")));

  const second = new ConversationHistoryStore({ persistence });
  const result = await second.enrichRequest("route-a", { previous_response_id: "resp", input: [
    { type: "function_call_output", call_id: "call", output: "ok" },
  ] });
  assert.equal(result.restoredCount, 1);
});

test("expired persisted responses are not restored", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-history-expired-"));
  const persistence = new FileHistoryPersistence(root);
  await persistence.save({ routeId: "route-a", responses: [{ responseId: "old", createdAt: 1, calls: [
    { id: "call", type: "function", function: { name: "read", arguments: "{}" } },
  ] }] });
  const history = new ConversationHistoryStore({ persistence, ttlMs: 10, now: () => 100 });
  assert.equal((await history.enrichRequest("route-a", { input: [{ type: "function_call_output", call_id: "call", output: "ok" }] })).restoredCount, 0);
});
