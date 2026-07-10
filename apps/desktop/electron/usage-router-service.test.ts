import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startUsageRouterService } from "./usage-router-service.js";

test("router streams upstream responses and records usage by route", async () => {
  const upstream = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      model: "gpt-test",
      usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 },
      path: request.url,
    }));
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
    enabled: true, createdAt: Date.now(), updatedAt: Date.now(),
  };
  const adminHeaders = { authorization: "Bearer secret", "content-type": "application/json" };
  const upsert = await fetch(`${service.origin}/admin/routes/${route.routeId}`, {
    method: "PUT", headers: adminHeaders, body: JSON.stringify(route),
  });
  assert.equal(upsert.status, 204);

  const routed = await fetch(`${service.origin}/routes/route-a/responses`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  assert.equal(routed.status, 200);
  assert.equal((await routed.json()).path, "/v1/responses");

  const stats = await fetch(`${service.origin}/admin/stats?from=0&to=${Date.now() + 1000}`, {
    headers: { authorization: "Bearer secret" },
  });
  const snapshot = await stats.json() as { summary: { requests: number; totalTokens: number } };
  assert.equal(snapshot.summary.requests, 1);
  assert.equal(snapshot.summary.totalTokens, 15);

  await service.close();
  await new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
});
