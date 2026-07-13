import test from "node:test";
import assert from "node:assert/strict";

import { handleChatCompatibilityRequest } from "./compatibility-handler.js";
import { ConversationHistoryStore } from "./history-store.js";
import { ChatUpstreamClient } from "./upstream-client.js";

const route = {
  routeId: "route", envName: "work", accountName: "key", upstreamBaseUrl: "https://example.com/v1",
  originalBaseUrl: "https://example.com/v1", protocol: "chat_completions" as const,
  reasoningProfile: "auto" as const, enabled: true, createdAt: 1, updatedAt: 1,
};
const secret = { routeId: "route", upstreamApiKey: "sk-upstream", localRouteToken: "local", hydratedAt: 1 };

test("compatibility handler authorizes, converts and records non-stream tool calls", async () => {
  let upstreamBody: Record<string, unknown> | undefined;
  const client = new ChatUpstreamClient({ fetchImpl: async (_url, init) => {
    upstreamBody = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: "ok", tool_calls: [
      { id: "call", function: { name: "read", arguments: "{}" } },
    ] } }] });
  } });
  const history = new ConversationHistoryStore();
  const response = await handleChatCompatibilityRequest({ route, secret, authorization: "Bearer local", history, client,
    request: { model: "codex", input: "hello", tools: [{ type: "function", name: "read" }] } });
  assert.equal(response.status, 200);
  assert.equal(upstreamBody?.model, "codex");
  const payload = await response.json() as { id: string; output: unknown[] };
  assert.equal(payload.output.length, 2);
  assert.equal(history.snapshot("route").responses[0]?.responseId, payload.id);
});

test("compatibility handler rejects the local route token before upstream execution", async () => {
  await assert.rejects(() => handleChatCompatibilityRequest({ route, secret, authorization: "Bearer wrong",
    history: new ConversationHistoryStore(), request: { model: "codex", input: "hello" } }), /Unauthorized/);
});
