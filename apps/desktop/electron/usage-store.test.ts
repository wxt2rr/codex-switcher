import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createUsageStore, resolveUsageTrendBucketMs } from "./usage-store.js";

const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;

test("usage trend selects an adaptive bucket size", () => {
  assert.equal(resolveUsageTrendBucketMs(hour), 5 * minute);
  assert.equal(resolveUsageTrendBucketMs(24 * hour), hour);
  assert.equal(resolveUsageTrendBucketMs(7 * day), 6 * hour);
  assert.equal(resolveUsageTrendBucketMs(30 * day), day);
});

test("usage store persists routes and aggregates usage by model and Base URL", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-usage-store-"));
  const databasePath = join(root, "usage.db");
  const first = await createUsageStore(databasePath);

  await first.upsertRoute({
    routeId: "route-a",
    envName: "work",
    accountName: "key-a",
    upstreamBaseUrl: "https://api.example.com/v1",
    originalBaseUrl: "https://api.example.com/v1",
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  });
  await first.upsertPricing({
    kind: "actual", baseUrl: "https://api.example.com/v1", modelPattern: "gpt-*",
    inputPerMillion: 1, outputPerMillion: 2, cacheCreationPerMillion: 1, cacheReadPerMillion: 0.1,
    updatedAt: 1,
  });
  await first.recordUsage({
    requestId: "request-a",
    routeId: "route-a",
    startedAt: 1000,
    completedAt: 1200,
    envName: "work",
    accountName: "key-a",
    upstreamBaseUrl: "https://api.example.com/v1",
    endpoint: "/responses",
    model: "gpt-5.4",
    inputTokens: 100,
    outputTokens: 20,
    cacheCreationTokens: 5,
    cacheReadTokens: 40,
    totalTokens: 120,
    httpStatus: 200,
    latencyMs: 200,
    actualCost: null,
    standardCost: null,
  });
  await first.close();

  const reopened = await createUsageStore(databasePath);
  assert.equal((await reopened.listRoutes()).length, 1);
  const snapshot = await reopened.queryUsage({ from: 0, to: 2000 });
  assert.equal(snapshot.summary.requests, 1);
  assert.equal(snapshot.summary.totalTokens, 120);
  assert.equal(snapshot.models[0]?.model, "gpt-5.4");
  assert.equal(snapshot.baseUrls[0]?.baseUrl, "https://api.example.com/v1");
  assert.equal(snapshot.baseUrls[0]?.cacheReadTokens, 40);
  assert.equal(snapshot.summary.actualCost, 0.000104);
  await reopened.close();
});

test("usage trend fills missing time buckets with zero usage", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-usage-trend-"));
  const store = await createUsageStore(join(root, "usage.db"));
  await store.recordUsage({
    requestId: "request-first-bucket",
    routeId: "route-a",
    startedAt: minute,
    completedAt: minute,
    envName: "work",
    accountName: "key-a",
    upstreamBaseUrl: "https://api.example.com/v1",
    endpoint: "/responses",
    model: "gpt-5.4",
    inputTokens: 100,
    outputTokens: 20,
    cacheCreationTokens: 5,
    cacheReadTokens: 40,
    totalTokens: 120,
    httpStatus: 200,
    latencyMs: 200,
    actualCost: null,
    standardCost: null,
  });

  const snapshot = await store.queryUsage({ from: 0, to: 20 * minute });
  assert.deepEqual(snapshot.trend.map((point) => point.bucket), [0, 5 * minute, 10 * minute, 15 * minute, 20 * minute]);
  assert.equal(snapshot.trend[0]?.inputTokens, 100);
  assert.deepEqual(snapshot.trend.slice(1).map((point) => point.requests), [0, 0, 0, 0]);
  assert.equal(snapshot.trend[1]?.cacheHitRate, null);
  assert.equal(snapshot.trend[1]?.actualCost, null);
  await store.close();
});
