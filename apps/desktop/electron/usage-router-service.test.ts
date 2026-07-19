import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractSafeErrorMessage, sanitizeRouterErrorMessage, startUsageRouterService } from "./usage-router-service.js";

test("router diagnostics extract useful errors while redacting credentials", () => {
  assert.equal(extractSafeErrorMessage(JSON.stringify({ error: { message: "rate limited for sk-secretvalue" } })), "rate limited for sk-[REDACTED]");
  assert.equal(sanitizeRouterErrorMessage("Authorization=Bearer abc.def.ghi socket closed"), "Authorization=[REDACTED] socket closed");
});

test("account pool keeps session affinity and fails over once before relaying output", async () => {
  let requestsA = 0;
  let requestsB = 0;
  let authA = "";
  let authB = "";
  const upstreamA = createServer(async (request, response) => {
    requestsA += 1; authA = String(request.headers.authorization ?? "");
    for await (const _chunk of request) { /* drain */ }
    response.statusCode = 429; response.setHeader("retry-after", "1");
    response.end(JSON.stringify({ error: { message: "rate limited" } }));
  });
  const upstreamB = createServer(async (request, response) => {
    requestsB += 1; authB = String(request.headers.authorization ?? "");
    for await (const _chunk of request) { /* drain */ }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ id: `resp-${requestsB}`, model: "gpt-pool", usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } }));
  });
  await Promise.all([
    new Promise<void>((resolve) => upstreamA.listen(0, "127.0.0.1", resolve)),
    new Promise<void>((resolve) => upstreamB.listen(0, "127.0.0.1", resolve)),
  ]);
  const addressA = upstreamA.address(); const addressB = upstreamB.address();
  assert(addressA && typeof addressA !== "string"); assert(addressB && typeof addressB !== "string");
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-pool-router-"));
  const service = await startUsageRouterService({ stateDir, adminToken: "secret" });
  const now = Date.now();
  const pool = {
    poolId: "pool-work", envName: "work", protocol: "responses" as const, enabled: true,
    strategy: "sticky_weighted_round_robin" as const, sessionTtlMinutes: 60, maxFailoverAttempts: 1, maxSameAccountFailures: 1,
    createdAt: now, updatedAt: now, cursor: 0,
    members: [
      { accountName: "a", routeId: "route-a", protocol: "responses" as const, upstreamBaseUrl: `http://127.0.0.1:${addressA.port}/v1`, originalBaseUrl: `http://127.0.0.1:${addressA.port}/v1`, enabled: true, weight: 1, priority: 0 },
      { accountName: "b", routeId: "route-b", protocol: "responses" as const, upstreamBaseUrl: `http://127.0.0.1:${addressB.port}/v1`, originalBaseUrl: `http://127.0.0.1:${addressB.port}/v1`, enabled: true, weight: 1, priority: 1 },
    ],
  };
  const adminHeaders = { authorization: "Bearer secret", "content-type": "application/json" };
  assert.equal((await fetch(`${service.origin}/admin/pools`, { method: "PUT", headers: adminHeaders, body: JSON.stringify(pool) })).status, 204);
  for (const [account, key] of [["a", "sk-a"], ["b", "sk-b"]]) {
    assert.equal((await fetch(`${service.origin}/admin/pools/${pool.poolId}/members/${account}/secret`, { method: "PUT", headers: adminHeaders, body: JSON.stringify({ upstreamApiKey: key }) })).status, 204);
  }
  assert.equal((await fetch(`${service.origin}/admin/pools/${pool.poolId}/token`, { method: "PUT", headers: adminHeaders, body: JSON.stringify({ localRouteToken: "local-pool" }) })).status, 204);

  const call = () => fetch(`${service.origin}/pools/${pool.poolId}/responses`, {
    method: "POST", headers: { authorization: "Bearer local-pool", "content-type": "application/json", "x-codex-session-id": "session-one" },
    body: JSON.stringify({ model: "gpt-pool", input: "hello" }),
  });
  const first = await call();
  assert.equal(first.status, 200); assert.equal((await first.json()).id, "resp-1");
  assert.equal(requestsA, 1); assert.equal(requestsB, 1);
  assert.equal(authA, "Bearer sk-a"); assert.equal(authB, "Bearer sk-b");
  const second = await call();
  assert.equal(second.status, 200); await second.arrayBuffer();
  assert.equal(requestsA, 1); assert.equal(requestsB, 2);

  const entryRouted = await fetch(`${service.origin}/pools/${pool.poolId}/responses`, {
    method: "POST", headers: { authorization: "Bearer sk-b", "content-type": "application/json", "x-codex-session-id": "entry-b-session" },
    body: JSON.stringify({ model: "gpt-pool", input: "from b" }),
  });
  assert.equal(entryRouted.status, 200); await entryRouted.arrayBuffer();
  assert.equal(requestsA, 1); assert.equal(requestsB, 3);

  const page = await (await fetch(`${service.origin}/admin/requests?from=0&to=${Date.now() + 1000}&page=1&pageSize=20`, { headers: { authorization: "Bearer secret" } })).json() as { items: Array<{ poolId: string; accountName: string; attemptCount: number; attemptedAccounts: string[]; failoverReason: string | null; errorMessage: string | null; attempts: Array<{ accountName: string; httpStatus: number | null; errorMessage: string | null; outcome: string }> }> };
  const failedOver = page.items.find((item) => item.attemptCount === 2);
  assert.equal(failedOver?.poolId, pool.poolId);
  assert.equal(failedOver?.accountName, "b");
  assert.deepEqual(failedOver?.attemptedAccounts, ["a", "b"]);
  assert.equal(failedOver?.failoverReason, "rate_limit");
  assert.equal(failedOver?.errorMessage, null);
  assert.deepEqual(failedOver?.attempts.map((attempt) => [attempt.accountName, attempt.httpStatus, attempt.outcome]), [
    ["a", 429, "retry"], ["b", 200, "success"],
  ]);
  assert.equal(failedOver?.attempts[0]?.errorMessage, "rate limited");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const health = await (await fetch(`${service.origin}/admin/account-health?limit=60`, { headers: { authorization: "Bearer secret" } })).json() as Array<{ accountName: string; sampleSize: number; successRate: number; cacheHitRate: number | null }>;
  const healthA = health.find((item) => item.accountName === "a");
  const healthB = health.find((item) => item.accountName === "b");
  assert.equal(healthA?.sampleSize, 1);
  assert.equal(healthA?.successRate, 0);
  assert.equal(healthA?.cacheHitRate, null);
  assert.equal(healthB?.sampleSize, 3);
  assert.equal(healthB?.successRate, 1);
  assert.equal(healthB?.cacheHitRate, 0);

  await service.close();
  await Promise.all([
    new Promise<void>((resolve) => upstreamA.close(() => resolve())),
    new Promise<void>((resolve) => upstreamB.close(() => resolve())),
  ]);
});

test("account pool relays client validation errors without retrying another account", async () => {
  let firstCalls = 0; let secondCalls = 0;
  const first = createServer(async (request, response) => {
    firstCalls += 1; for await (const _chunk of request) { /* drain */ }
    response.statusCode = 400; response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: { message: "invalid request" } }));
  });
  const second = createServer(async (request, response) => {
    secondCalls += 1; for await (const _chunk of request) { /* drain */ }
    response.end(JSON.stringify({ id: "should-not-run" }));
  });
  await Promise.all([new Promise<void>((resolve) => first.listen(0, "127.0.0.1", resolve)), new Promise<void>((resolve) => second.listen(0, "127.0.0.1", resolve))]);
  const firstAddress = first.address(); const secondAddress = second.address();
  assert(firstAddress && typeof firstAddress !== "string"); assert(secondAddress && typeof secondAddress !== "string");
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-pool-validation-"));
  const service = await startUsageRouterService({ stateDir, adminToken: "secret" });
  const now = Date.now();
  const pool = { poolId: "pool-validation", envName: "work", protocol: "responses" as const, enabled: true,
    strategy: "sticky_weighted_round_robin" as const, sessionTtlMinutes: 60, maxFailoverAttempts: 1, maxSameAccountFailures: 1, createdAt: now, updatedAt: now, cursor: 0,
    members: [
      { accountName: "a", routeId: "route-validation-a", protocol: "responses" as const, upstreamBaseUrl: `http://127.0.0.1:${firstAddress.port}/v1`, originalBaseUrl: `http://127.0.0.1:${firstAddress.port}/v1`, enabled: true, weight: 1, priority: 0 },
      { accountName: "b", routeId: "route-validation-b", protocol: "responses" as const, upstreamBaseUrl: `http://127.0.0.1:${secondAddress.port}/v1`, originalBaseUrl: `http://127.0.0.1:${secondAddress.port}/v1`, enabled: true, weight: 1, priority: 1 },
    ] };
  const headers = { authorization: "Bearer secret", "content-type": "application/json" };
  assert.equal((await fetch(`${service.origin}/admin/pools`, { method: "PUT", headers, body: JSON.stringify(pool) })).status, 204);
  for (const [account, key] of [["a", "sk-a"], ["b", "sk-b"]]) {
    assert.equal((await fetch(`${service.origin}/admin/pools/${pool.poolId}/members/${account}/secret`, { method: "PUT", headers, body: JSON.stringify({ upstreamApiKey: key }) })).status, 204);
  }
  const response = await fetch(`${service.origin}/pools/${pool.poolId}/responses`, { method: "POST", headers: { authorization: "Bearer sk-a", "content-type": "application/json" }, body: JSON.stringify({ input: [] }) });
  assert.equal(response.status, 400); assert.match(await response.text(), /invalid request/);
  assert.equal(firstCalls, 1); assert.equal(secondCalls, 0);
  const page = await (await fetch(`${service.origin}/admin/requests?from=0&to=${Date.now() + 1000}&page=1&pageSize=20`, { headers: { authorization: "Bearer secret" } })).json() as { items: Array<{ errorMessage: string | null; attempts: Array<{ accountName: string; httpStatus: number | null; reason: string | null; errorMessage: string | null; outcome: string }> }> };
  assert.equal(page.items[0]?.errorMessage, "invalid request");
  assert.equal(page.items[0]?.attempts[0]?.accountName, "a");
  assert.equal(page.items[0]?.attempts[0]?.httpStatus, 400);
  assert.equal(page.items[0]?.attempts[0]?.reason, "validation");
  assert.equal(page.items[0]?.attempts[0]?.errorMessage, "invalid request");
  assert.equal(page.items[0]?.attempts[0]?.outcome, "returned");
  await service.close();
  await Promise.all([new Promise<void>((resolve) => first.close(() => resolve())), new Promise<void>((resolve) => second.close(() => resolve()))]);
});

test("account pool retries the same member before consuming a failover", async () => {
  let callsA = 0;
  let callsB = 0;
  const upstreamA = createServer(async (request, response) => {
    callsA += 1;
    for await (const _chunk of request) { /* drain */ }
    response.statusCode = 503;
    response.end(JSON.stringify({ error: { message: "temporary upstream failure" } }));
  });
  const upstreamB = createServer(async (request, response) => {
    callsB += 1;
    for await (const _chunk of request) { /* drain */ }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ id: "fallback-response", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
  });
  await Promise.all([
    new Promise<void>((resolve) => upstreamA.listen(0, "127.0.0.1", resolve)),
    new Promise<void>((resolve) => upstreamB.listen(0, "127.0.0.1", resolve)),
  ]);
  const addressA = upstreamA.address(); const addressB = upstreamB.address();
  assert(addressA && typeof addressA !== "string"); assert(addressB && typeof addressB !== "string");
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-pool-same-account-retry-"));
  const service = await startUsageRouterService({ stateDir, adminToken: "secret" });
  const now = Date.now();
  const pool = {
    poolId: "pool-same-account-retry", envName: "work", protocol: "responses" as const, enabled: true,
    strategy: "sticky_weighted_round_robin" as const, sessionTtlMinutes: 60, maxFailoverAttempts: 1, maxSameAccountFailures: 2,
    createdAt: now, updatedAt: now, cursor: 0,
    members: [
      { accountName: "a", routeId: "same-retry-a", protocol: "responses" as const, upstreamBaseUrl: `http://127.0.0.1:${addressA.port}/v1`, originalBaseUrl: `http://127.0.0.1:${addressA.port}/v1`, enabled: true, weight: 1, priority: 0 },
      { accountName: "b", routeId: "same-retry-b", protocol: "responses" as const, upstreamBaseUrl: `http://127.0.0.1:${addressB.port}/v1`, originalBaseUrl: `http://127.0.0.1:${addressB.port}/v1`, enabled: true, weight: 1, priority: 1 },
    ],
  };
  const headers = { authorization: "Bearer secret", "content-type": "application/json" };
  assert.equal((await fetch(`${service.origin}/admin/pools`, { method: "PUT", headers, body: JSON.stringify(pool) })).status, 204);
  for (const [account, key] of [["a", "sk-a"], ["b", "sk-b"]]) {
    assert.equal((await fetch(`${service.origin}/admin/pools/${pool.poolId}/members/${account}/secret`, { method: "PUT", headers, body: JSON.stringify({ upstreamApiKey: key }) })).status, 204);
  }
  assert.equal((await fetch(`${service.origin}/admin/pools/${pool.poolId}/token`, { method: "PUT", headers, body: JSON.stringify({ localRouteToken: "local-same-retry" }) })).status, 204);
  const response = await fetch(`${service.origin}/pools/${pool.poolId}/responses`, {
    method: "POST",
    headers: { authorization: "Bearer local-same-retry", "content-type": "application/json", "x-codex-session-id": "same-retry-session" },
    body: JSON.stringify({ model: "gpt-pool", input: "hello" }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).id, "fallback-response");
  assert.equal(callsA, 2);
  assert.equal(callsB, 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const page = await (await fetch(`${service.origin}/admin/requests?from=0&to=${Date.now() + 1000}&page=1&pageSize=20`, { headers: { authorization: "Bearer secret" } })).json() as { items: Array<{ attemptedAccounts: string[]; attemptCount: number }> };
  const item = page.items.find((candidate) => candidate.attemptCount === 3);
  assert.deepEqual(item?.attemptedAccounts, ["a", "a", "b"]);
  await service.close();
  await Promise.all([
    new Promise<void>((resolve) => upstreamA.close(() => resolve())),
    new Promise<void>((resolve) => upstreamB.close(() => resolve())),
  ]);
});

test("mixed AUTH and API-key pool replaces bearer and ChatGPT account identity per selected member", async () => {
  const received: Array<{ authorization: string; accountId: string }> = [];
  const upstream = createServer(async (request, response) => {
    const authorization = String(request.headers.authorization ?? "");
    received.push({ authorization, accountId: String(request.headers["chatgpt-account-id"] ?? "") });
    for await (const _chunk of request) { /* drain */ }
    if (authorization === "Bearer auth-token") {
      response.statusCode = 429; response.setHeader("retry-after", "1");
      response.end(JSON.stringify({ error: { message: "auth member limited" } }));
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ id: `resp-${received.length}`, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address(); assert(address && typeof address !== "string");
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-mixed-auth-pool-router-"));
  const service = await startUsageRouterService({ stateDir, adminToken: "secret" });
  const now = Date.now();
  const pool = { poolId: "pool-mixed", envName: "work", protocol: "responses" as const, enabled: true,
    strategy: "sticky_weighted_round_robin" as const, sessionTtlMinutes: 60, maxFailoverAttempts: 1, maxSameAccountFailures: 1, createdAt: now, updatedAt: now, cursor: 0,
    members: [
      { accountName: "auth", routeId: "route-mixed-auth", protocol: "responses" as const, upstreamBaseUrl: `http://127.0.0.1:${address.port}/v1`, originalBaseUrl: "default", enabled: true, weight: 1, priority: 0 },
      { accountName: "key", routeId: "route-mixed-key", protocol: "responses" as const, upstreamBaseUrl: `http://127.0.0.1:${address.port}/v1`, originalBaseUrl: "default", enabled: true, weight: 1, priority: 1 },
    ] };
  const headers = { authorization: "Bearer secret", "content-type": "application/json" };
  assert.equal((await fetch(`${service.origin}/admin/pools`, { method: "PUT", headers, body: JSON.stringify(pool) })).status, 204);
  assert.equal((await fetch(`${service.origin}/admin/pools/${pool.poolId}/members/auth/secret`, { method: "PUT", headers,
    body: JSON.stringify({ upstreamBearerToken: "auth-token", authMode: "auth", accountId: "chat-account" }) })).status, 204);
  assert.equal((await fetch(`${service.origin}/admin/pools/${pool.poolId}/members/key/secret`, { method: "PUT", headers,
    body: JSON.stringify({ upstreamBearerToken: "sk-key", authMode: "apikey" }) })).status, 204);
  assert.equal((await fetch(`${service.origin}/admin/pools/${pool.poolId}/token`, { method: "PUT", headers,
    body: JSON.stringify({ localRouteToken: "local" }) })).status, 204);
  const response = await fetch(`${service.origin}/pools/${pool.poolId}/responses`, { method: "POST",
    headers: { authorization: "Bearer auth-token", "content-type": "application/json", "chatgpt-account-id": "stale", "x-codex-session-id": "mixed-session" },
    body: JSON.stringify({ input: "hello" }) });
  assert.equal(response.status, 200); await response.arrayBuffer();
  assert.deepEqual(received, [
    { authorization: "Bearer auth-token", accountId: "chat-account" },
    { authorization: "Bearer sk-key", accountId: "" },
  ]);
  await service.close();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

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

test("Chat compatibility account pool keeps member-specific history and never retries after streaming starts", async () => {
  let calls = 0;
  let upstreamAuthorization = "";
  const upstream = createServer(async (request, response) => {
    calls += 1;
    upstreamAuthorization = String(request.headers.authorization ?? "");
    for await (const _chunk of request) { /* drain */ }
    response.setHeader("content-type", "text/event-stream");
    response.end([
      `data: ${JSON.stringify({ choices: [{ delta: { content: `reply-${calls}` } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 } })}\n\n`,
      "data: [DONE]\n\n",
    ].join(""));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address(); assert(address && typeof address !== "string");
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-chat-pool-"));
  const service = await startUsageRouterService({ stateDir, adminToken: "secret" });
  const now = Date.now();
  const route = { routeId: "route-chat-pool", envName: "work", accountName: "chat-a",
    upstreamBaseUrl: `http://127.0.0.1:${address.port}/v1`, originalBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    protocol: "chat_completions" as const, reasoningProfile: "auto" as const,
    enabled: true, createdAt: now, updatedAt: now };
  const pool = { poolId: "pool-chat", envName: "work", protocol: "chat_completions" as const, enabled: true,
    strategy: "sticky_weighted_round_robin" as const, sessionTtlMinutes: 60, maxFailoverAttempts: 1, maxSameAccountFailures: 1,
    createdAt: now, updatedAt: now, cursor: 0,
    members: [{ accountName: "chat-a", routeId: route.routeId, protocol: "chat_completions" as const,
      upstreamBaseUrl: route.upstreamBaseUrl, originalBaseUrl: route.originalBaseUrl, enabled: true, weight: 1, priority: 0 }] };
  const headers = { authorization: "Bearer secret", "content-type": "application/json" };
  assert.equal((await fetch(`${service.origin}/admin/routes/${route.routeId}`, { method: "PUT", headers, body: JSON.stringify(route) })).status, 204);
  assert.equal((await fetch(`${service.origin}/admin/pools`, { method: "PUT", headers, body: JSON.stringify(pool) })).status, 204);
  assert.equal((await fetch(`${service.origin}/admin/pools/${pool.poolId}/members/chat-a/secret`, { method: "PUT", headers, body: JSON.stringify({ upstreamApiKey: "sk-chat-upstream" }) })).status, 204);
  assert.equal((await fetch(`${service.origin}/admin/pools/${pool.poolId}/token`, { method: "PUT", headers, body: JSON.stringify({ localRouteToken: "local-chat-pool" }) })).status, 204);

  for (const input of ["first", "second"]) {
    const response = await fetch(`${service.origin}/pools/${pool.poolId}/responses`, {
      method: "POST", headers: { authorization: "Bearer local-chat-pool", "content-type": "application/json", "x-codex-session-id": "chat-session" },
      body: JSON.stringify({ model: "codex", stream: true, input }),
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /response\.completed/);
  }
  assert.equal(calls, 2);
  assert.equal(upstreamAuthorization, "Bearer sk-chat-upstream");
  const page = await (await fetch(`${service.origin}/admin/requests?from=0&to=${Date.now() + 1000}&page=1&pageSize=20`, { headers: { authorization: "Bearer secret" } })).json() as { items: Array<{ poolId: string; accountName: string }> };
  assert.ok(page.items.every((item) => item.poolId === pool.poolId && item.accountName === "chat-a"));

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
