import test from "node:test";
import assert from "node:assert/strict";

import { handleChatCompatibilityRequest, resolveCompatibilityUpstreamModel } from "./compatibility-handler.js";
import { ConversationHistoryStore } from "./history-store.js";
import { ChatUpstreamClient } from "./upstream-client.js";

const route = {
  routeId: "route", envName: "work", accountName: "key", upstreamBaseUrl: "https://example.com/v1",
  originalBaseUrl: "https://example.com/v1", protocol: "chat_completions" as const,
  reasoningProfile: "auto" as const, enabled: true, createdAt: 1, updatedAt: 1,
};
const secret = { routeId: "route", upstreamApiKey: "sk-upstream", localRouteToken: "local", hydratedAt: 1 };

test("compatibility model mapping strips the provider prefix", () => {
  assert.equal(resolveCompatibilityUpstreamModel({ providerId: "qwen", upstreamModel: "legacy" }, "qwen:kimi-k3"), "kimi-k3");
  assert.equal(resolveCompatibilityUpstreamModel({ providerId: "qwen", upstreamModel: undefined }, "qwen:kimi-k3"), "kimi-k3");
  assert.equal(resolveCompatibilityUpstreamModel({ providerId: undefined, upstreamModel: undefined }, "custom:model:v2"), "model:v2");
  assert.equal(resolveCompatibilityUpstreamModel({ providerId: "qwen", upstreamModel: "kimi-k3" }, "kimi-k3"), "kimi-k3");
});

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

test("compatibility handler sends the upstream model id for provider-qualified requests", async () => {
  let upstreamBody: Record<string, unknown> | undefined;
  const client = new ChatUpstreamClient({ fetchImpl: async (_url, init) => {
    upstreamBody = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: "ok" } }] });
  } });
  const history = new ConversationHistoryStore();
  const response = await handleChatCompatibilityRequest({
    route: { ...route, providerId: "qwen", upstreamModel: "legacy" }, secret,
    authorization: "Bearer local", history, client,
    request: { model: "qwen:kimi-k3", input: "hello" },
  });
  assert.equal(response.status, 200);
  assert.equal(upstreamBody?.model, "kimi-k3");
});

test("compatibility handler uses the shared request/response converter for reasoning and history", async () => {
  let upstreamBody: Record<string, unknown> | undefined;
  const client = new ChatUpstreamClient({ fetchImpl: async (_url, init) => {
    upstreamBody = JSON.parse(String(init?.body));
    return Response.json({ id: "chat-shared", choices: [{ finish_reason: "stop", message: {
      role: "assistant", reasoning_content: "plan", content: "answer",
    } }], usage: { prompt_tokens: 2, completion_tokens: 3, completion_tokens_details: { reasoning_tokens: 1 } } });
  } });
  const history = new ConversationHistoryStore();
  const response = await handleChatCompatibilityRequest({ route, secret, authorization: "Bearer local", history, client,
    request: { model: "codex", reasoning: { effort: "high" }, input: "hello" } });
  assert.equal(response.status, 200);
  assert.equal(upstreamBody?.reasoning_effort, "high");
  assert.equal("reasoning" in upstreamBody!, false);
  const payload = await response.json() as Record<string, unknown>;
  assert.equal(payload.model, "codex");
  assert.equal(JSON.stringify(payload).includes("plan"), true);
  assert.equal(history.snapshot("route").responses[0]?.responseId, "chat-shared");
});

test("compatibility handler uses the shared streaming converter and persists partial history", async () => {
  const sse = [
    `data: ${JSON.stringify({ id: "chat-stream", choices: [{ delta: { reasoning_content: "plan" }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ id: "chat-stream", choices: [{ delta: { content: "answer" }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ id: "chat-stream", choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 2 } })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  const client = new ChatUpstreamClient({ fetchImpl: async () => new Response(sse, { headers: { "content-type": "text/event-stream" } }) });
  const history = new ConversationHistoryStore();
  const response = await handleChatCompatibilityRequest({ route, secret, authorization: "Bearer local", history, client,
    request: { model: "codex", stream: true, input: "hello" } });
  assert.equal(response.headers.get("content-type")?.includes("text/event-stream"), true);
  const body = await response.text();
  assert.equal(body.includes("response.reasoning_summary_text.delta"), true);
  assert.equal(body.includes("response.output_text.delta"), true);
  assert.equal(body.includes('"model":"codex"'), true);
  assert.equal(history.snapshot("route").responses.length, 1);
});

test("compatibility handler rejects the local route token before upstream execution", async () => {
  await assert.rejects(() => handleChatCompatibilityRequest({ route, secret, authorization: "Bearer wrong",
    history: new ConversationHistoryStore(), request: { model: "codex", input: "hello" } }), /Unauthorized/);
});
