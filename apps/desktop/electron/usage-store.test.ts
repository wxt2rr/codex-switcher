import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import initSqlJs from "sql.js";

import { createUsageStore, resolveUsageTrendBucketMs } from "./usage-store.js";

const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;
const moduleAnchor = typeof __filename === "string" ? __filename : join(process.cwd(), "package.json");

async function createLegacyRouteDatabase(databasePath: string): Promise<void> {
  const require = createRequire(moduleAnchor);
  const SQL = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE route_targets (
      route_id TEXT PRIMARY KEY,
      env_name TEXT NOT NULL,
      account_name TEXT NOT NULL,
      upstream_base_url TEXT NOT NULL,
      original_base_url TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO route_targets VALUES (
      'legacy-route', 'work', 'legacy-key', 'https://api.example.com/v1',
      'https://api.example.com/v1', 1, 1, 2
    );
  `);
  await writeFile(databasePath, Buffer.from(db.export()));
  db.close();
}

test("usage store migrates legacy routes with compatibility defaults and no secret columns", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-usage-migration-"));
  const databasePath = join(root, "usage.db");
  await createLegacyRouteDatabase(databasePath);

  const store = await createUsageStore(databasePath);
  const [route] = await store.listRoutes();
  assert.equal(route?.protocol, "responses");
  assert.equal(route?.reasoningProfile, "auto");
  assert.equal(route?.instructionRole, "auto");
  assert.equal(route?.upstreamModel, undefined);
  await store.close();

  const require = createRequire(moduleAnchor);
  const SQL = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
  const db = new SQL.Database(new Uint8Array(await readFile(databasePath)));
  const columns = db.exec("PRAGMA table_info(route_targets)")[0]?.values.map((row) => String(row[1])) ?? [];
  assert.equal(columns.includes("api_key"), false);
  assert.equal(columns.includes("route_token"), false);
  assert.equal(columns.includes("upstream_api_key"), false);
  assert.equal(columns.includes("local_route_token"), false);
  db.close();
});

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
    protocol: "chat_completions",
    upstreamModel: "provider-model",
    reasoningProfile: "reasoning_content",
    longConversationStrategy: "continuity",
    instructionRole: "developer",
    requestOverrides: { temperature: 0.2 },
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
  const [route] = await reopened.listRoutes();
  assert.equal(route?.protocol, "chat_completions");
  assert.equal(route?.upstreamModel, "provider-model");
  assert.equal(route?.reasoningProfile, "reasoning_content");
  assert.equal(route?.longConversationStrategy, "continuity");
  assert.equal(route?.instructionRole, "developer");
  assert.deepEqual(route?.requestOverrides, { temperature: 0.2 });
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

test("usage request details support filtering and server-side pagination", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-usage-requests-"));
  const store = await createUsageStore(join(root, "usage.db"));
  const record = (requestId: string, completedAt: number, overrides: Partial<Parameters<typeof store.recordUsage>[0]> = {}) =>
    store.recordUsage({
      requestId, routeId: "route-a", startedAt: completedAt - 250, completedAt,
      envName: "work", accountName: "key-a", upstreamBaseUrl: "https://api.example.com/v1",
      endpoint: "/responses", model: "gpt-5.4", inputTokens: 100, outputTokens: 20,
      cacheCreationTokens: 0, cacheReadTokens: 40, totalTokens: 120,
      httpStatus: 200, latencyMs: 250, actualCost: null, standardCost: null,
      ...overrides,
    });
  await record("request-1", 1000);
  await record("request-2", 2000, { model: "deepseek-chat", endpoint: "/chat/completions", httpStatus: 500 });
  await record("request-3", 3000);
  await record("request-other-url", 3500, { envName: "other", accountName: "key-b", upstreamBaseUrl: "https://other.example.com/v1" });

  const firstPage = await store.queryUsageRequests({
    from: 0, to: 4000, baseUrl: "https://api.example.com/v1", page: 1, pageSize: 2,
  });
  assert.equal(firstPage.total, 3);
  assert.equal(firstPage.totalPages, 2);
  assert.deepEqual(firstPage.items.map((item) => item.requestId), ["request-3", "request-2"]);
  assert.deepEqual(firstPage.facets.models, ["deepseek-chat", "gpt-5.4"]);
  assert.deepEqual(firstPage.facets.endpoints, ["/chat/completions", "/responses"]);
  assert.deepEqual(firstPage.facets.envNames, ["other", "work"]);
  assert.deepEqual(firstPage.facets.accountNames, ["key-a", "key-b"]);

  const errorPage = await store.queryUsageRequests({
    from: 0, to: 4000, baseUrl: "https://api.example.com/v1", page: 1, pageSize: 20,
    status: "error", search: "deepseek",
  });
  assert.equal(errorPage.total, 1);
  assert.equal(errorPage.items[0]?.httpStatus, 500);
  assert.equal(errorPage.items[0]?.model, "deepseek-chat");
  await store.close();
});
