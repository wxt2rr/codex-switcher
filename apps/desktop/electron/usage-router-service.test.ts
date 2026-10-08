import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connect as connectSocket } from "node:net";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractSafeErrorMessage, sanitizeRouterErrorMessage, startUsageRouterService } from "./usage-router-service.js";
import type { RouteTarget } from "./usage-routing-model.js";

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
  await new Promise((resolve) => setTimeout(resolve, 120));
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

test("native Responses routes inject hydrated AUTH credentials and account identity", async () => {
  let upstreamAuthorization = "";
  let upstreamAccountId = "";
  const upstream = createServer(async (request, response) => {
    upstreamAuthorization = String(request.headers.authorization ?? "");
    upstreamAccountId = String(request.headers["chatgpt-account-id"] ?? "");
    for await (const _chunk of request) { /* drain */ }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ model: "gpt-auth", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address(); assert(address && typeof address !== "string");
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-auth-route-"));
  const service = await startUsageRouterService({ stateDir, adminToken: "secret" });
  const route = { routeId: "route-auth", envName: "work", accountName: "login",
    upstreamBaseUrl: `http://127.0.0.1:${address.port}/v1`, originalBaseUrl: "default",
    protocol: "responses" as const, reasoningProfile: "auto" as const,
    enabled: true, createdAt: Date.now(), updatedAt: Date.now() };
  const adminHeaders = { authorization: "Bearer secret", "content-type": "application/json" };
  assert.equal((await fetch(`${service.origin}/admin/routes/${route.routeId}`, {
    method: "PUT", headers: adminHeaders, body: JSON.stringify(route),
  })).status, 204);
  assert.equal((await fetch(`${service.origin}/admin/routes/${route.routeId}/secret`, {
    method: "PUT", headers: adminHeaders,
    body: JSON.stringify({ upstreamApiKey: "auth-token", localRouteToken: "local-route", authMode: "auth", accountId: "chat-account" }),
  })).status, 204);

  const routed = await fetch(`${service.origin}/routes/${route.routeId}/responses`, {
    method: "POST",
    headers: { authorization: "Bearer local-route", "chatgpt-account-id": "stale", "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-auth", input: "hello" }),
  });
  assert.equal(routed.status, 200);
  await routed.arrayBuffer();
  assert.equal(upstreamAuthorization, "Bearer auth-token");
  assert.equal(upstreamAccountId, "chat-account");

  await service.close();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

test("native routes forward configured non-secret headers while protecting router-controlled headers", async () => {
  let providerScope = "";
  let authorization = "";
  const upstream = createServer(async (request, response) => {
    providerScope = String(request.headers["x-provider-scope"] ?? "");
    authorization = String(request.headers.authorization ?? "");
    for await (const _chunk of request) { /* drain */ }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ id: "header-route", model: "header-model", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address(); assert(address && typeof address !== "string");
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-route-headers-"));
  const service = await startUsageRouterService({ stateDir, adminToken: "secret" });
  const route = {
    routeId: "route-headers", envName: "work", accountName: "key", upstreamBaseUrl: `http://127.0.0.1:${address.port}/v1`, originalBaseUrl: "default",
    protocol: "responses" as const, requestHeaders: { "x-provider-scope": "shared", authorization: "must-not-override" },
    reasoningProfile: "auto" as const, enabled: true, createdAt: 1, updatedAt: 1,
  };
  const adminHeaders = { authorization: "Bearer secret", "content-type": "application/json" };
  try {
    assert.equal((await fetch(`${service.origin}/admin/routes/${route.routeId}`, { method: "PUT", headers: adminHeaders, body: JSON.stringify({ ...route, proxyUrl: "http://user:pass@127.0.0.1:7890" }) })).status, 400);
    assert.equal((await fetch(`${service.origin}/admin/routes/${route.routeId}`, { method: "PUT", headers: adminHeaders, body: JSON.stringify(route) })).status, 204);
    assert.equal((await fetch(`${service.origin}/admin/routes/${route.routeId}/secret`, {
      method: "PUT", headers: adminHeaders, body: JSON.stringify({ upstreamApiKey: "route-secret", localRouteToken: "local-route" }),
    })).status, 204);
    const response = await fetch(`${service.origin}/routes/${route.routeId}/responses`, {
      method: "POST", headers: { authorization: "Bearer local-route", "content-type": "application/json" }, body: JSON.stringify({ model: "header-model", input: "hello" }),
    });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    assert.equal(providerScope, "shared");
    assert.equal(authorization, "Bearer route-secret");
    const [persisted] = await (await fetch(`${service.origin}/admin/routes`, { headers: adminHeaders })).json() as Array<{ requestHeaders?: Record<string, string> }>;
    assert.deepEqual(persisted?.requestHeaders, route.requestHeaders);
  } finally {
    await service.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

test("native routes use the explicit per-route HTTP proxy without proxying the local gateway", async () => {
  let upstreamCalls = 0;
  let proxyConnects = 0;
  const upstream = createServer(async (_request, response) => {
    upstreamCalls += 1;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ id: "proxied-route", model: "proxy-model", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamAddress = upstream.address(); assert(upstreamAddress && typeof upstreamAddress !== "string");
  const proxy = createServer();
  proxy.on("connect", (request, clientSocket, head) => {
    proxyConnects += 1;
    const target = String(request.url ?? "").split(":");
    const host = target.shift() ?? "";
    const port = Number(target.shift());
    const upstreamSocket = connectSocket(port, host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstreamSocket.write(head);
      clientSocket.pipe(upstreamSocket).pipe(clientSocket);
    });
    upstreamSocket.on("error", () => clientSocket.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const proxyAddress = proxy.address(); assert(proxyAddress && typeof proxyAddress !== "string");
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-route-proxy-"));
  const service = await startUsageRouterService({ stateDir, adminToken: "secret" });
  const route = {
    routeId: "route-proxy", envName: "work", accountName: "key",
    upstreamBaseUrl: `http://127.0.0.1:${upstreamAddress.port}/v1`, originalBaseUrl: "default",
    protocol: "responses" as const, proxyUrl: `http://127.0.0.1:${proxyAddress.port}`,
    reasoningProfile: "auto" as const, enabled: true, createdAt: 1, updatedAt: 1,
  };
  const adminHeaders = { authorization: "Bearer secret", "content-type": "application/json" };
  try {
    assert.equal((await fetch(`${service.origin}/admin/routes/${route.routeId}`, { method: "PUT", headers: adminHeaders, body: JSON.stringify(route) })).status, 204);
    assert.equal((await fetch(`${service.origin}/admin/routes/${route.routeId}/secret`, {
      method: "PUT", headers: adminHeaders, body: JSON.stringify({ upstreamApiKey: "route-secret", localRouteToken: "local-route" }),
    })).status, 204);
    const response = await fetch(`${service.origin}/routes/${route.routeId}/responses`, {
      method: "POST", headers: { authorization: "Bearer local-route", "content-type": "application/json" }, body: JSON.stringify({ model: "proxy-model", input: "hello" }),
    });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    assert.equal(upstreamCalls, 1);
    assert.equal(proxyConnects, 1);
    const [persisted] = await (await fetch(`${service.origin}/admin/routes`, { headers: { authorization: "Bearer secret" } })).json() as Array<{ proxyUrl?: string }>;
    assert.equal(persisted?.proxyUrl, route.proxyUrl);
  } finally {
    await service.close();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

test("native routes use the runtime global proxy when no explicit proxy is configured", async () => {
  let upstreamCalls = 0;
  let proxyConnects = 0;
  const upstream = createServer(async (request, response) => {
    upstreamCalls += 1;
    for await (const _chunk of request) { /* drain */ }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ id: "global-proxy-route", model: "proxy-model", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamAddress = upstream.address(); assert(upstreamAddress && typeof upstreamAddress !== "string");
  const proxy = createServer();
  proxy.on("connect", (request, clientSocket, head) => {
    proxyConnects += 1;
    const [host, portValue] = String(request.url ?? "").split(":");
    const targetHost = host === "proxy-target.test" ? "127.0.0.1" : host;
    const upstreamSocket = connectSocket(Number(portValue), targetHost, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstreamSocket.write(head);
      clientSocket.pipe(upstreamSocket).pipe(clientSocket);
    });
    upstreamSocket.on("error", () => clientSocket.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const proxyAddress = proxy.address(); assert(proxyAddress && typeof proxyAddress !== "string");
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-global-proxy-route-"));
  const service = await startUsageRouterService({ stateDir, adminToken: "secret" });
  const route = {
    routeId: "route-global-proxy", envName: "work", accountName: "key",
    upstreamBaseUrl: `http://proxy-target.test:${upstreamAddress.port}/v1`, originalBaseUrl: "default",
    protocol: "responses" as const, reasoningProfile: "auto" as const, enabled: true, createdAt: 1, updatedAt: 1,
  };
  const adminHeaders = { authorization: "Bearer secret", "content-type": "application/json" };
  try {
    assert.equal((await fetch(`${service.origin}/admin/routes/${route.routeId}`, { method: "PUT", headers: adminHeaders, body: JSON.stringify(route) })).status, 204);
    assert.equal((await fetch(`${service.origin}/admin/routes/${route.routeId}/secret`, {
      method: "PUT", headers: adminHeaders, body: JSON.stringify({ upstreamApiKey: "route-secret", localRouteToken: "local-route" }),
    })).status, 204);
    assert.equal((await fetch(`${service.origin}/admin/proxy`, {
      method: "PUT", headers: adminHeaders, body: JSON.stringify({ proxyUrl: `http://127.0.0.1:${proxyAddress.port}` }),
    })).status, 204);
    const response = await fetch(`${service.origin}/routes/${route.routeId}/responses`, {
      method: "POST", headers: { authorization: "Bearer local-route", "content-type": "application/json" }, body: JSON.stringify({ model: "proxy-model", input: "hello" }),
    });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    assert.equal(upstreamCalls, 1);
    assert.equal(proxyConnects, 1);
  } finally {
    await service.close();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

test("environment gateway persists, selects an account route, and survives router restart", async () => {
  let calls = 0;
  let upstreamModel = "";
  const upstream = createServer(async (request, response) => {
    calls += 1;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    try { upstreamModel = String((JSON.parse(Buffer.concat(chunks).toString("utf8")) as { model?: unknown }).model ?? ""); } catch { /* no body */ }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ id: `gateway-response-${calls}`, model: "gpt-gateway", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address(); assert(address && typeof address !== "string");
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-gateway-router-"));
  const route = { routeId: "route-gateway", envName: "work", accountName: "login",
    upstreamBaseUrl: `http://127.0.0.1:${address.port}/v1`, originalBaseUrl: "default",
    protocol: "responses" as const, exposedModelId: "gpt-gateway", upstreamModel: "gpt-upstream", reasoningProfile: "auto" as const,
    enabled: true, createdAt: Date.now(), updatedAt: Date.now() };
  const gateway = { gatewayId: "gateway-work", envName: "work", routeIds: [route.routeId],
    routeGroups: { "shared-gpt": { id: "shared-gpt", exposedModelId: "gpt-shared", routeIds: [route.routeId], strategy: "order", sessionPolicy: "auto", fallbackEnabled: true } },
    defaultRouteId: route.routeId, enabled: true, createdAt: Date.now(), updatedAt: Date.now() };
  const adminHeaders = { authorization: "Bearer secret", "content-type": "application/json" };
  const first = await startUsageRouterService({ stateDir, adminToken: "secret" });
  assert.equal((await fetch(`${first.origin}/admin/routes/${route.routeId}`, {
    method: "PUT", headers: adminHeaders, body: JSON.stringify(route),
  })).status, 204);
  assert.equal((await fetch(`${first.origin}/admin/routes/${route.routeId}/secret`, {
    method: "PUT", headers: adminHeaders,
    body: JSON.stringify({ upstreamApiKey: "gateway-token", localRouteToken: "local-route" }),
  })).status, 204);
  assert.equal((await fetch(`${first.origin}/admin/gateways`, {
    method: "PUT", headers: adminHeaders, body: JSON.stringify(gateway),
  })).status, 204);
  assert.deepEqual(await (await fetch(`${first.origin}/admin/gateways`, { headers: adminHeaders })).json(), [gateway]);

  const call = async (origin: string) => fetch(`${origin}/gateways/${gateway.gatewayId}/responses`, {
    method: "POST",
    headers: { authorization: "Bearer local-route", "x-codex-account": "login", "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-shared", input: "hello" }),
  });
  const routed = await call(first.origin);
  assert.equal(routed.status, 200);
  assert.equal((await routed.json()).id, "gateway-response-1");
  assert.equal(upstreamModel, "gpt-upstream");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const trace = await (await fetch(`${first.origin}/admin/trace?envName=work&gatewayId=${gateway.gatewayId}&limit=10`, { headers: adminHeaders })).json() as Array<{ event: string; routeId?: string; requestedModel?: string; reason?: string }>;
  assert.equal(trace[0]?.event, "gateway_route_selected");
  assert.equal(trace[0]?.routeId, route.routeId);
  assert.equal(trace[0]?.requestedModel, "gpt-shared");
  assert.equal(trace[0]?.reason, "route_group");
  await first.close();

  const second = await startUsageRouterService({ stateDir, adminToken: "secret" });
  assert.deepEqual(await (await fetch(`${second.origin}/admin/gateways`, { headers: adminHeaders })).json(), [gateway]);
  const restarted = await call(second.origin);
  assert.equal(restarted.status, 200);
  assert.equal((await restarted.json()).id, "gateway-response-2");
  assert.equal(upstreamModel, "gpt-upstream");
  await second.close();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

test("environment gateway fails over a route group before the response starts", async () => {
  let firstCalls = 0;
  let secondCalls = 0;
  const firstUpstream = createServer(async (request, response) => {
    firstCalls += 1;
    for await (const _chunk of request) { /* drain */ }
    response.statusCode = 429;
    response.setHeader("retry-after", "1");
    response.end(JSON.stringify({ error: { message: "rate limited" } }));
  });
  const secondUpstream = createServer(async (request, response) => {
    secondCalls += 1;
    for await (const _chunk of request) { /* drain */ }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ id: "group-fallback-success", model: "provider-model", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
  });
  await Promise.all([
    new Promise<void>((resolve) => firstUpstream.listen(0, "127.0.0.1", resolve)),
    new Promise<void>((resolve) => secondUpstream.listen(0, "127.0.0.1", resolve)),
  ]);
  const firstAddress = firstUpstream.address();
  const secondAddress = secondUpstream.address();
  assert(firstAddress && typeof firstAddress !== "string");
  assert(secondAddress && typeof secondAddress !== "string");
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-gateway-failover-"));
  const firstRoute = { routeId: "route-first", envName: "work", accountName: "first", providerId: "provider-a", exposedModelId: "provider-a:model", upstreamModel: "model-a", upstreamBaseUrl: `http://127.0.0.1:${firstAddress.port}/v1`, originalBaseUrl: "default", protocol: "responses" as const, routeGroupId: "shared-model", reasoningProfile: "auto" as const, enabled: true, createdAt: 1, updatedAt: 1 };
  const secondRoute = { ...firstRoute, routeId: "route-second", accountName: "second", providerId: "provider-b", exposedModelId: "provider-b:model", upstreamModel: "model-b", upstreamBaseUrl: `http://127.0.0.1:${secondAddress.port}/v1` };
  const gateway = {
    gatewayId: "gateway-failover", envName: "work", routeIds: [firstRoute.routeId, secondRoute.routeId],
    routeGroups: { "shared-model": { id: "shared-model", exposedModelId: "shared-model", routeIds: [firstRoute.routeId, secondRoute.routeId], strategy: "order", sessionPolicy: "off", fallbackEnabled: true } },
    quota: { windowMinutes: 60, maxRequests: 2 },
    defaultRouteId: firstRoute.routeId, enabled: true, createdAt: 1, updatedAt: 1,
  };
  const service = await startUsageRouterService({ stateDir, adminToken: "secret" });
  const adminHeaders = { authorization: "Bearer secret", "content-type": "application/json" };
  for (const route of [firstRoute, secondRoute]) {
    assert.equal((await fetch(`${service.origin}/admin/routes/${route.routeId}`, { method: "PUT", headers: adminHeaders, body: JSON.stringify(route) })).status, 204);
    assert.equal((await fetch(`${service.origin}/admin/routes/${route.routeId}/secret`, { method: "PUT", headers: adminHeaders, body: JSON.stringify({ upstreamApiKey: `${route.accountName}-token`, localRouteToken: "local-route" }) })).status, 204);
  }
  assert.equal((await fetch(`${service.origin}/admin/gateways`, { method: "PUT", headers: adminHeaders, body: JSON.stringify(gateway) })).status, 204);
  const routed = await fetch(`${service.origin}/gateways/${gateway.gatewayId}/responses`, {
    method: "POST", headers: { authorization: "Bearer local-route", "content-type": "application/json" },
    body: JSON.stringify({ model: "shared-model", input: "hello" }),
  });
  assert.equal(routed.status, 200);
  assert.equal((await routed.json()).id, "group-fallback-success");
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 1);
  const health = await (await fetch(`${service.origin}/admin/gateways/${gateway.gatewayId}/health`, { headers: adminHeaders })).json() as Array<{ routeId: string; state: string }>;
  assert.equal(health.find((item) => item.routeId === firstRoute.routeId)?.state, "cooldown");
  assert.equal(health.find((item) => item.routeId === secondRoute.routeId)?.state, "healthy");
  const repeated = await fetch(`${service.origin}/gateways/${gateway.gatewayId}/responses`, {
    method: "POST", headers: { authorization: "Bearer local-route", "content-type": "application/json" },
    body: JSON.stringify({ model: "shared-model", input: "hello-again" }),
  });
  assert.equal(repeated.status, 200);
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 2);
  const quotaRejected = await fetch(`${service.origin}/gateways/${gateway.gatewayId}/responses`, {
    method: "POST", headers: { authorization: "Bearer local-route", "content-type": "application/json" },
    body: JSON.stringify({ model: "shared-model", input: "over-quota" }),
  });
  assert.equal(quotaRejected.status, 429);
  assert.equal((await quotaRejected.json()).code, "GATEWAY_QUOTA_EXCEEDED");
  await service.close();
  await Promise.all([
    new Promise<void>((resolve) => firstUpstream.close(() => resolve())),
    new Promise<void>((resolve) => secondUpstream.close(() => resolve())),
  ]);
});

test("environment gateway dispatches through its credential pool while keeping model groups explicit", async () => {
  let calls = 0;
  let receivedModel = "";
  const upstream = createServer(async (request, response) => {
    calls += 1;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    try { receivedModel = String((JSON.parse(Buffer.concat(chunks).toString("utf8")) as { model?: unknown }).model ?? ""); } catch { /* no body */ }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ id: "pool-gateway-response", model: "model-a", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address(); assert(address && typeof address !== "string");
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-gateway-pool-service-"));
  const service = await startUsageRouterService({ stateDir, adminToken: "secret" });
  const route = (routeId: string, accountName: string, model: string) => ({
    routeId, envName: "work", accountName, providerId: `provider-${accountName}`, exposedModelId: `provider-${accountName}:${model}`,
    upstreamModel: model, upstreamBaseUrl: `http://127.0.0.1:${address.port}/v1`, originalBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    protocol: "responses" as const, routeGroupId: "shared-model", reasoningProfile: "auto" as const, enabled: true, createdAt: 1, updatedAt: 1,
  });
  const firstRoute = route("pool-route-first", "first", "model-a");
  const secondRoute = route("pool-route-second", "second", "model-b");
  const pool = {
    poolId: "pool-work", envName: "work", protocol: "responses" as const, enabled: true, strategy: "sticky_weighted_round_robin" as const,
    sessionTtlMinutes: 60, maxFailoverAttempts: 1, maxSameAccountFailures: 1, createdAt: 1, updatedAt: 1,
    members: [
      { accountName: "first", routeId: firstRoute.routeId, protocol: "responses" as const, upstreamBaseUrl: firstRoute.upstreamBaseUrl, originalBaseUrl: firstRoute.originalBaseUrl, upstreamModel: firstRoute.upstreamModel, enabled: true, weight: 1, priority: 0 },
      { accountName: "second", routeId: secondRoute.routeId, protocol: "responses" as const, upstreamBaseUrl: secondRoute.upstreamBaseUrl, originalBaseUrl: secondRoute.originalBaseUrl, upstreamModel: secondRoute.upstreamModel, enabled: true, weight: 1, priority: 1 },
    ],
  };
  const gateway = {
    gatewayId: "gateway-pool", envName: "work", routeIds: [firstRoute.routeId, secondRoute.routeId], poolId: pool.poolId,
    routeGroups: { "shared-model": { id: "shared-model", exposedModelId: "shared-model", routeIds: [firstRoute.routeId, secondRoute.routeId], strategy: "order" as const, sessionPolicy: "off" as const, fallbackEnabled: true } },
    defaultRouteId: firstRoute.routeId, enabled: true, createdAt: 1, updatedAt: 1,
  };
  const adminHeaders = { authorization: "Bearer secret", "content-type": "application/json" };
  try {
    for (const candidate of [firstRoute, secondRoute]) {
      assert.equal((await fetch(`${service.origin}/admin/routes/${candidate.routeId}`, { method: "PUT", headers: adminHeaders, body: JSON.stringify(candidate) })).status, 204);
      assert.equal((await fetch(`${service.origin}/admin/routes/${candidate.routeId}/secret`, { method: "PUT", headers: adminHeaders, body: JSON.stringify({ upstreamApiKey: `${candidate.accountName}-upstream`, localRouteToken: "unused" }) })).status, 204);
    }
    assert.equal((await fetch(`${service.origin}/admin/pools`, { method: "PUT", headers: adminHeaders, body: JSON.stringify(pool) })).status, 204);
    for (const member of pool.members) {
      assert.equal((await fetch(`${service.origin}/admin/pools/${pool.poolId}/members/${member.accountName}/secret`, { method: "PUT", headers: adminHeaders, body: JSON.stringify({ upstreamBearerToken: `${member.accountName}-upstream`, authMode: "apikey" }) })).status, 204);
    }
    assert.equal((await fetch(`${service.origin}/admin/pools/${pool.poolId}/token`, { method: "PUT", headers: adminHeaders, body: JSON.stringify({ localRouteToken: "pool-local" }) })).status, 204);
    assert.equal((await fetch(`${service.origin}/admin/gateways`, { method: "PUT", headers: adminHeaders, body: JSON.stringify(gateway) })).status, 204);
    const routed = await fetch(`${service.origin}/gateways/${gateway.gatewayId}/responses`, {
      method: "POST", headers: { authorization: "Bearer pool-local", "content-type": "application/json" },
      body: JSON.stringify({ model: "shared-model", input: "hello" }),
    });
    assert.equal(routed.status, 200);
    assert.equal((await routed.json()).id, "pool-gateway-response");
    assert.equal(calls, 1);
    assert.equal(receivedModel, "model-a");
  } finally {
    await service.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

test("environment Gateway keeps an explicit metadata rule scoped when a credential pool is enabled", async () => {
  let receivedAuthorization = "";
  let receivedModel = "";
  const upstream = createServer(async (request, response) => {
    receivedAuthorization = String(request.headers.authorization ?? "");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    try { receivedModel = String((JSON.parse(Buffer.concat(chunks).toString("utf8")) as { model?: unknown }).model ?? ""); } catch { /* no body */ }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ id: "pool-rule", model: receivedModel, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address(); assert(address && typeof address !== "string");
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-gateway-pool-rule-"));
  const service = await startUsageRouterService({ stateDir, adminToken: "secret" });
  const makeRoute = (routeId: string, accountName: string, model: string, capabilities?: RouteTarget["capabilities"]) => ({
    routeId, envName: "work", accountName, providerId: `provider-${accountName}`, exposedModelId: `${accountName}-model`,
    upstreamModel: model, upstreamBaseUrl: `http://127.0.0.1:${address.port}/v1`, originalBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    protocol: "responses" as const, routeGroupId: accountName === "vision" ? "vision" : "default", capabilities,
    reasoningProfile: "auto" as const, enabled: true, createdAt: 1, updatedAt: 1,
  });
  const defaultRoute = makeRoute("pool-rule-default", "default", "model-default");
  const visionRoute = makeRoute("pool-rule-vision", "vision", "model-vision", { vision: true });
  const pool = {
    poolId: "pool-rule", envName: "work", protocol: "responses" as const, enabled: true, strategy: "sticky_weighted_round_robin" as const,
    sessionTtlMinutes: 60, maxFailoverAttempts: 1, maxSameAccountFailures: 1, createdAt: 1, updatedAt: 1,
    members: [
      { accountName: "default", routeId: defaultRoute.routeId, protocol: "responses" as const, upstreamBaseUrl: defaultRoute.upstreamBaseUrl, originalBaseUrl: defaultRoute.originalBaseUrl, upstreamModel: defaultRoute.upstreamModel, enabled: true, weight: 1, priority: 0 },
      { accountName: "vision", routeId: visionRoute.routeId, protocol: "responses" as const, upstreamBaseUrl: visionRoute.upstreamBaseUrl, originalBaseUrl: visionRoute.originalBaseUrl, upstreamModel: visionRoute.upstreamModel, enabled: true, weight: 1, priority: 1 },
    ],
  };
  const gateway = {
    gatewayId: "gateway-pool-rule", envName: "work", routeIds: [defaultRoute.routeId, visionRoute.routeId], poolId: pool.poolId,
    routeGroups: {
      default: { id: "default", exposedModelId: "default-model", routeIds: [defaultRoute.routeId], strategy: "order" as const, sessionPolicy: "off" as const, fallbackEnabled: true },
      vision: { id: "vision", exposedModelId: "vision-model", routeIds: [visionRoute.routeId], strategy: "order" as const, sessionPolicy: "off" as const, fallbackEnabled: true, capabilities: { vision: true } },
    },
    routeRules: [{ id: "images-to-vision", targetModelId: "vision-model", priority: 0, enabled: true, match: { hasImages: true } }],
    defaultRouteId: defaultRoute.routeId, enabled: true, createdAt: 1, updatedAt: 1,
  };
  const adminHeaders = { authorization: "Bearer secret", "content-type": "application/json" };
  try {
    for (const candidate of [defaultRoute, visionRoute]) {
      assert.equal((await fetch(`${service.origin}/admin/routes/${candidate.routeId}`, { method: "PUT", headers: adminHeaders, body: JSON.stringify(candidate) })).status, 204);
      assert.equal((await fetch(`${service.origin}/admin/routes/${candidate.routeId}/secret`, { method: "PUT", headers: adminHeaders, body: JSON.stringify({ upstreamApiKey: `${candidate.accountName}-key`, localRouteToken: "unused" }) })).status, 204);
    }
    assert.equal((await fetch(`${service.origin}/admin/pools`, { method: "PUT", headers: adminHeaders, body: JSON.stringify(pool) })).status, 204);
    for (const member of pool.members) {
      assert.equal((await fetch(`${service.origin}/admin/pools/${pool.poolId}/members/${member.accountName}/secret`, { method: "PUT", headers: adminHeaders, body: JSON.stringify({ upstreamBearerToken: `${member.accountName}-upstream`, authMode: "apikey" }) })).status, 204);
    }
    assert.equal((await fetch(`${service.origin}/admin/pools/${pool.poolId}/token`, { method: "PUT", headers: adminHeaders, body: JSON.stringify({ localRouteToken: "pool-rule-local" }) })).status, 204);
    assert.equal((await fetch(`${service.origin}/admin/gateways`, { method: "PUT", headers: adminHeaders, body: JSON.stringify(gateway) })).status, 204);
    const response = await fetch(`${service.origin}/gateways/${gateway.gatewayId}/responses`, {
      method: "POST", headers: { authorization: "Bearer pool-rule-local", "content-type": "application/json" },
      body: JSON.stringify({ input: [{ role: "user", content: [{ type: "input_image", image_url: "https://example.invalid/image" }] }] }),
    });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    assert.equal(receivedAuthorization, "Bearer vision-upstream");
    assert.equal(receivedModel, "model-vision");
  } finally {
    await service.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

test("environment Gateway converts the ingress Responses protocol to an Anthropic upstream route", async () => {
  let upstreamPath = "";
  let upstreamApiKey = "";
  let upstreamBody: Record<string, unknown> | undefined;
  const upstream = createServer(async (request, response) => {
    upstreamPath = request.url ?? "";
    upstreamApiKey = String(request.headers["x-api-key"] ?? "");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    upstreamBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      id: "msg_converted",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "converted reply" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 2 },
    }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address(); assert(address && typeof address !== "string");
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-protocol-gateway-"));
  const service = await startUsageRouterService({ stateDir, adminToken: "secret" });
  const route = {
    routeId: "route-anthropic-conversion", envName: "work", accountName: "anthropic", providerId: "anthropic",
    exposedModelId: "shared-model", upstreamModel: "claude-sonnet", upstreamBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    originalBaseUrl: `http://127.0.0.1:${address.port}/v1`, protocol: "anthropic" as const,
    routeGroupId: "shared-model", reasoningProfile: "auto" as const, enabled: true, createdAt: 1, updatedAt: 1,
  };
  const gateway = {
    gatewayId: "gateway-conversion", envName: "work", routeIds: [route.routeId],
    routeGroups: {
      "shared-model": {
        id: "shared-model", exposedModelId: "shared-model", routeIds: [route.routeId],
        strategy: "order" as const, sessionPolicy: "off" as const, fallbackEnabled: true,
      },
    },
    defaultRouteId: route.routeId, enabled: true, createdAt: 1, updatedAt: 1,
  };
  const adminHeaders = { authorization: "Bearer secret", "content-type": "application/json" };
  try {
    assert.equal((await fetch(`${service.origin}/admin/routes/${route.routeId}`, { method: "PUT", headers: adminHeaders, body: JSON.stringify(route) })).status, 204);
    assert.equal((await fetch(`${service.origin}/admin/routes/${route.routeId}/secret`, {
      method: "PUT", headers: adminHeaders,
      body: JSON.stringify({ upstreamApiKey: "sk-anthropic", localRouteToken: "local-gateway" }),
    })).status, 204);
    assert.equal((await fetch(`${service.origin}/admin/gateways`, { method: "PUT", headers: adminHeaders, body: JSON.stringify(gateway) })).status, 204);

    const response = await fetch(`${service.origin}/gateways/${gateway.gatewayId}/responses`, {
      method: "POST", headers: { authorization: "Bearer local-gateway", "content-type": "application/json" },
      body: JSON.stringify({ model: "shared-model", input: "hello" }),
    });
    assert.equal(response.status, 200);
    assert.equal(upstreamPath, "/v1/messages");
    assert.equal(upstreamApiKey, "sk-anthropic");
    assert.equal(upstreamBody?.model, "claude-sonnet");
    assert.deepEqual(upstreamBody?.messages, [{ role: "user", content: "hello" }]);
    const converted = await response.json() as { id: string; object: string; output: Array<{ content: Array<{ text: string }> }>; usage: { total_tokens: number } };
    assert.equal(converted.id, "msg_converted");
    assert.equal(converted.object, "response");
    assert.equal(converted.output[0]?.content[0]?.text, "converted reply");
    assert.equal(converted.usage.total_tokens, 7);
  } finally {
    await service.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

test("environment Gateway usage strategy uses live per-route request metrics", async () => {
  const upstreamAccounts: string[] = [];
  const upstream = createServer(async (request, response) => {
    upstreamAccounts.push(String(request.headers.authorization ?? ""));
    for await (const _chunk of request) { /* drain */ }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ id: `usage-${upstreamAccounts.length}`, model: "usage-model", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address(); assert(address && typeof address !== "string");
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-usage-strategy-"));
  const service = await startUsageRouterService({ stateDir, adminToken: "secret" });
  const makeRoute = (routeId: string, accountName: string, key: string) => ({
    routeId, envName: "work", accountName, providerId: `provider-${accountName}`,
    exposedModelId: "usage-model", upstreamModel: "usage-model", upstreamBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    originalBaseUrl: `http://127.0.0.1:${address.port}/v1`, protocol: "responses" as const,
    routeGroupId: "usage-model", reasoningProfile: "auto" as const, enabled: true, createdAt: 1, updatedAt: 1,
    key,
  });
  const firstRoute = makeRoute("usage-route-a", "a", "sk-a");
  const secondRoute = makeRoute("usage-route-b", "b", "sk-b");
  const gateway = {
    gatewayId: "gateway-usage", envName: "work", routeIds: [firstRoute.routeId, secondRoute.routeId],
    routeGroups: {
      "usage-model": {
        id: "usage-model", exposedModelId: "usage-model", routeIds: [firstRoute.routeId, secondRoute.routeId],
        strategy: "usage" as const, sessionPolicy: "off" as const, fallbackEnabled: true,
      },
    },
    defaultRouteId: firstRoute.routeId, enabled: true, createdAt: 1, updatedAt: 1,
  };
  const adminHeaders = { authorization: "Bearer secret", "content-type": "application/json" };
  try {
    for (const candidate of [firstRoute, secondRoute]) {
      assert.equal((await fetch(`${service.origin}/admin/routes/${candidate.routeId}`, { method: "PUT", headers: adminHeaders, body: JSON.stringify(candidate) })).status, 204);
      assert.equal((await fetch(`${service.origin}/admin/routes/${candidate.routeId}/secret`, {
        method: "PUT", headers: adminHeaders,
        body: JSON.stringify({ upstreamApiKey: candidate.key, localRouteToken: "local-usage" }),
      })).status, 204);
    }
    assert.equal((await fetch(`${service.origin}/admin/gateways`, { method: "PUT", headers: adminHeaders, body: JSON.stringify(gateway) })).status, 204);
    for (let index = 0; index < 2; index += 1) {
      const response = await fetch(`${service.origin}/gateways/${gateway.gatewayId}/responses`, {
        method: "POST", headers: { authorization: "Bearer local-usage", "content-type": "application/json" },
        body: JSON.stringify({ model: "usage-model", input: `request-${index}` }),
      });
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }
    assert.deepEqual(upstreamAccounts, ["Bearer sk-a", "Bearer sk-b"]);
  } finally {
    await service.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

test("environment Gateway applies explicit metadata route rules without inspecting prompt text", async () => {
  let upstreamAuthorization = "";
  const upstream = createServer(async (request, response) => {
    upstreamAuthorization = String(request.headers.authorization ?? "");
    for await (const _chunk of request) { /* drain */ }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ id: "metadata-rule", model: "vision-model", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address(); assert(address && typeof address !== "string");
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-route-rule-"));
  const service = await startUsageRouterService({ stateDir, adminToken: "secret" });
  const makeRoute = (routeId: string, accountName: string, key: string, capabilities?: RouteTarget["capabilities"]) => ({
    routeId, envName: "work", accountName, providerId: accountName,
    exposedModelId: `${accountName}-model`, upstreamModel: `${accountName}-upstream`, upstreamBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    originalBaseUrl: `http://127.0.0.1:${address.port}/v1`, protocol: "responses" as const, capabilities,
    routeGroupId: accountName, reasoningProfile: "auto" as const, enabled: true, createdAt: 1, updatedAt: 1,
    key,
  });
  const defaultRoute = makeRoute("metadata-default", "default", "sk-default");
  const visionRoute = makeRoute("metadata-vision", "vision", "sk-vision", { vision: true });
  const gateway = {
    gatewayId: "gateway-route-rule", envName: "work", routeIds: [defaultRoute.routeId, visionRoute.routeId],
    routeGroups: {
      default: { id: "default", exposedModelId: "default-model", routeIds: [defaultRoute.routeId], strategy: "order" as const, sessionPolicy: "off" as const, fallbackEnabled: true },
      vision: { id: "vision", exposedModelId: "vision-model", routeIds: [visionRoute.routeId], strategy: "order" as const, sessionPolicy: "off" as const, fallbackEnabled: true, capabilities: { vision: true } },
    },
    routeRules: [{ id: "images-to-vision", targetModelId: "vision-model", priority: 0, enabled: true, match: { hasImages: true, agentIds: ["codex"] } }],
    defaultRouteId: defaultRoute.routeId, enabled: true, createdAt: 1, updatedAt: 1,
  };
  const adminHeaders = { authorization: "Bearer secret", "content-type": "application/json" };
  try {
    for (const candidate of [defaultRoute, visionRoute]) {
      assert.equal((await fetch(`${service.origin}/admin/routes/${candidate.routeId}`, { method: "PUT", headers: adminHeaders, body: JSON.stringify(candidate) })).status, 204);
      assert.equal((await fetch(`${service.origin}/admin/routes/${candidate.routeId}/secret`, {
        method: "PUT", headers: adminHeaders,
        body: JSON.stringify({ upstreamApiKey: candidate.key, localRouteToken: "local-rule" }),
      })).status, 204);
    }
    assert.equal((await fetch(`${service.origin}/admin/gateways`, { method: "PUT", headers: adminHeaders, body: JSON.stringify(gateway) })).status, 204);
    const response = await fetch(`${service.origin}/gateways/${gateway.gatewayId}/responses`, {
      method: "POST", headers: { authorization: "Bearer local-rule", "content-type": "application/json", "x-codex-agent": "codex" },
      body: JSON.stringify({ input: [{ role: "user", content: [{ type: "input_image", image_url: "https://example.invalid/image" }] }] }),
    });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    assert.equal(upstreamAuthorization, "Bearer sk-vision");
    const requests = await (await fetch(`${service.origin}/admin/requests?from=0&to=${Date.now() + 1000}&page=1&pageSize=10`, { headers: { authorization: "Bearer secret" } })).json() as {
      items: Array<{ logicalModel: string | null; servedModel: string | null; providerId: string | null; agentId: string | null; ingressProtocol: string | null; upstreamProtocol: string | null; routeGroupId: string | null; routeRuleId: string | null; }>
    };
    assert.equal(requests.items[0]?.logicalModel, null);
    assert.equal(requests.items[0]?.servedModel, "vision-model");
    assert.equal(requests.items[0]?.providerId, "vision");
    assert.equal(requests.items[0]?.agentId, "codex");
    assert.equal(requests.items[0]?.ingressProtocol, "responses");
    assert.equal(requests.items[0]?.upstreamProtocol, "responses");
    assert.equal(requests.items[0]?.routeGroupId, "vision");
    assert.equal(requests.items[0]?.routeRuleId, "images-to-vision");
  } finally {
    await service.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
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
  assert.deepEqual((await readdir(stateDir)).filter((name) => name.includes(".tmp")), []);
});
