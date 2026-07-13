import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startUsageRouterService } from "./usage-router-service.js";

test("native Responses routes preserve payload bytes, suffix and headers while recording usage", async () => {
  let receivedBody = "";
  let receivedHeader = "";
  const upstream = createServer((request, response) => {
    request.on("data", (chunk) => { receivedBody += Buffer.from(chunk).toString(); });
    receivedHeader = String(request.headers["x-unusual-header"] ?? "");
    request.on("end", () => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      model: "gpt-test",
      usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 },
      path: request.url,
    }));
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamAddress = upstream.address();
  assert(upstreamAddress && typeof upstreamAddress !== "string");

  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-router-"));
  const service = await startUsageRouterService({ stateDir, adminToken: "secret" });
  const route = {
    routeId: "route-a", envName: "work", accountName: "key-a",
    upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/v1`,
    originalBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/v1`,
    protocol: "responses" as const, reasoningProfile: "auto" as const,
    enabled: true, createdAt: Date.now(), updatedAt: Date.now(),
  };
  const adminHeaders = { authorization: "Bearer secret", "content-type": "application/json" };
  const upsert = await fetch(`${service.origin}/admin/routes/${route.routeId}`, {
    method: "PUT", headers: adminHeaders, body: JSON.stringify(route),
  });
  assert.equal(upsert.status, 204);

  const exactBody = "{ \"model\" : \"gpt\", \"input\" : \"hello\" }";
  const routed = await fetch(`${service.origin}/routes/route-a/responses`, {
    method: "POST", headers: { "content-type": "application/json", "x-unusual-header": "preserved" }, body: exactBody,
  });
  assert.equal(routed.status, 200);
  assert.equal((await routed.json()).path, "/v1/responses");
  assert.equal(receivedBody, exactBody);
  assert.equal(receivedHeader, "preserved");

  const stats = await fetch(`${service.origin}/admin/stats?from=0&to=${Date.now() + 1000}`, {
    headers: { authorization: "Bearer secret" },
  });
  const snapshot = await stats.json() as { summary: { requests: number; totalTokens: number } };
  assert.equal(snapshot.summary.requests, 1);
  assert.equal(snapshot.summary.totalTokens, 15);

  const requests = await fetch(`${service.origin}/admin/requests?from=0&to=${Date.now() + 1000}&baseUrl=${encodeURIComponent(route.upstreamBaseUrl)}&page=1&pageSize=20`, {
    headers: { authorization: "Bearer secret" },
  });
  const requestPage = await requests.json() as { total: number; items: Array<{ model: string; endpoint: string }> };
  assert.equal(requestPage.total, 1);
  assert.equal(requestPage.items[0]?.model, "gpt-test");
  assert.equal(requestPage.items[0]?.endpoint, "/responses");

  await service.close();
  await new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
});

test("Chat compatibility route returns Responses SSE and never forwards the local token", async () => {
  let upstreamAuthorization = "";
  let upstreamPath = "";
  const upstream = createServer(async (request, response) => {
    upstreamAuthorization = String(request.headers.authorization ?? "");
    upstreamPath = request.url ?? "";
    for await (const _chunk of request) { /* drain */ }
    response.setHeader("content-type", "text/event-stream");
    response.end([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "hello" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 } })}\n\n`,
      "data: [DONE]\n\n",
    ].join(""));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address(); assert(address && typeof address !== "string");
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-chat-router-"));
  const service = await startUsageRouterService({ stateDir, adminToken: "secret" });
  const route = { routeId: "route-chat", envName: "work", accountName: "chat",
    upstreamBaseUrl: `http://127.0.0.1:${address.port}/v1`, originalBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    protocol: "chat_completions" as const, reasoningProfile: "auto" as const,
    enabled: true, createdAt: Date.now(), updatedAt: Date.now() };
  const adminHeaders = { authorization: "Bearer secret", "content-type": "application/json" };
  assert.equal((await fetch(`${service.origin}/admin/routes/${route.routeId}`, {
    method: "PUT", headers: adminHeaders, body: JSON.stringify(route),
  })).status, 204);
  assert.equal((await fetch(`${service.origin}/admin/routes/${route.routeId}/secret`, {
    method: "PUT", headers: adminHeaders, body: JSON.stringify({ upstreamApiKey: "sk-upstream", localRouteToken: "local-token" }),
  })).status, 204);

  const routed = await fetch(`${service.origin}/routes/${route.routeId}/responses`, {
    method: "POST", headers: { authorization: "Bearer local-token", "content-type": "application/json" },
    body: JSON.stringify({ model: "codex", stream: true, input: "hello" }),
  });
  const streamText = await routed.text();
  assert.equal(routed.status, 200);
  assert.match(streamText, /event: response\.output_text\.delta/);
  assert.match(streamText, /event: response\.completed/);
  assert.equal(upstreamAuthorization, "Bearer sk-upstream");
  assert.equal(upstreamPath, "/v1/chat/completions");

  const stats = await fetch(`${service.origin}/admin/stats?from=0&to=${Date.now() + 1000}`, {
    headers: { authorization: "Bearer secret" },
  });
  const snapshot = await stats.json() as { summary: { totalTokens: number } };
  assert.equal(snapshot.summary.totalTokens, 9);
  await service.close();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

test("admin shutdown gracefully stops the router", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-router-shutdown-"));
  const service = await startUsageRouterService({ stateDir, adminToken: "secret" });
  const response = await fetch(`${service.origin}/admin/shutdown`, {
    method: "POST",
    headers: { authorization: "Bearer secret" },
  });
  assert.equal(response.status, 204);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await assert.rejects(() => fetch(`${service.origin}/health`));
  await service.close();
});

test("preferred router port increments on conflict and reuses the selected port", async () => {
  const blocker = createServer();
  await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const blockerAddress = blocker.address();
  assert(blockerAddress && typeof blockerAddress !== "string");
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-router-port-"));

  const first = await startUsageRouterService({ stateDir, preferredPort: blockerAddress.port });
  assert.ok(first.port > blockerAddress.port);
  const selectedPort = first.port;
  await first.close();
  await new Promise<void>((resolve, reject) => blocker.close((error) => error ? reject(error) : resolve()));

  const second = await startUsageRouterService({ stateDir, preferredPort: blockerAddress.port });
  assert.equal(second.port, selectedPort);
  await second.close();
});
