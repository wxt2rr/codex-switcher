import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

import type {
  PricingProfile,
  RouteTarget,
  UsageDimensionAggregate,
  UsageFilter,
  UsageRequest,
  UsageRequestPage,
  UsageRequestQuery,
  UsageSnapshot,
  UsageSummary,
  UsageTrendPoint,
} from "./usage-routing-model.js";

export interface UsageStore {
  upsertRoute(route: RouteTarget): Promise<void>;
  removeRoute(routeId: string): Promise<void>;
  listRoutes(): Promise<RouteTarget[]>;
  recordUsage(request: UsageRequest): Promise<void>;
  queryUsage(filter: UsageFilter): Promise<UsageSnapshot>;
  queryUsageRequests(query: UsageRequestQuery): Promise<UsageRequestPage>;
  upsertPricing(profile: PricingProfile): Promise<void>;
  listPricing(): Promise<PricingProfile[]>;
  close(): Promise<void>;
}

let sqlModule: Promise<SqlJsStatic> | undefined;

function loadSql(): Promise<SqlJsStatic> {
  const moduleAnchor = typeof __filename === "string" ? __filename : join(process.cwd(), "package.json");
  const resolveFromWorkspace = createRequire(moduleAnchor);
  sqlModule ??= initSqlJs({
    locateFile: () => resolveFromWorkspace.resolve("sql.js/dist/sql-wasm.wasm"),
  });
  return sqlModule;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0;
}

function nullableSum(value: unknown): number | null {
  return value === null || value === undefined ? null : asNumber(value);
}

function runRows(db: Database, sql: string, params: unknown[]): Record<string, unknown>[] {
  const statement = db.prepare(sql);
  try {
    statement.bind(params as never[]);
    const rows: Record<string, unknown>[] = [];
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally {
    statement.free();
  }
}

function routeColumns(db: Database): Set<string> {
  return new Set(runRows(db, "PRAGMA table_info(route_targets)", []).map((row) => String(row.name)));
}

function ensureRouteMetadataColumns(db: Database): void {
  const columns = routeColumns(db);
  const migrations = [
    ["protocol", "TEXT NOT NULL DEFAULT 'responses'"],
    ["upstream_model", "TEXT"],
    ["reasoning_profile", "TEXT NOT NULL DEFAULT 'auto'"],
    ["request_overrides_json", "TEXT"],
    ["long_conversation_strategy", "TEXT NOT NULL DEFAULT 'safe'"],
    ["instruction_role", "TEXT NOT NULL DEFAULT 'auto'"],
  ] as const;
  for (const [name, definition] of migrations) {
    if (!columns.has(name)) db.run(`ALTER TABLE route_targets ADD COLUMN ${name} ${definition}`);
  }
}

function parseOverrides(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function emptySummary(): UsageSummary {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    actualCost: null,
    standardCost: null,
    requestsWithoutUsage: 0,
    cacheHitRate: null,
  };
}

function summaryFromRow(row: Record<string, unknown> | undefined): UsageSummary {
  if (!row) return emptySummary();
  const inputTokens = asNumber(row.input_tokens);
  const cacheReadTokens = asNumber(row.cache_read_tokens);
  return {
    requests: asNumber(row.requests),
    inputTokens,
    outputTokens: asNumber(row.output_tokens),
    cacheCreationTokens: asNumber(row.cache_creation_tokens),
    cacheReadTokens,
    totalTokens: asNumber(row.total_tokens),
    actualCost: nullableSum(row.actual_cost),
    standardCost: nullableSum(row.standard_cost),
    requestsWithoutUsage: asNumber(row.requests_without_usage),
    cacheHitRate: inputTokens > 0 ? cacheReadTokens / inputTokens : null,
  };
}

function aggregateFromRow(row: Record<string, unknown>, dimension: "model" | "baseUrl"): UsageDimensionAggregate {
  const value = String(row.dimension ?? "unknown");
  return {
    key: value,
    ...(dimension === "model" ? { model: value } : { baseUrl: value }),
    requests: asNumber(row.requests),
    inputTokens: asNumber(row.input_tokens),
    outputTokens: asNumber(row.output_tokens),
    cacheCreationTokens: asNumber(row.cache_creation_tokens),
    cacheReadTokens: asNumber(row.cache_read_tokens),
    totalTokens: asNumber(row.total_tokens),
    actualCost: nullableSum(row.actual_cost),
    standardCost: nullableSum(row.standard_cost),
  };
}

const aggregateColumns = `
  COUNT(*) AS requests,
  COALESCE(SUM(input_tokens), 0) AS input_tokens,
  COALESCE(SUM(output_tokens), 0) AS output_tokens,
  COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
  COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
  COALESCE(SUM(total_tokens), 0) AS total_tokens,
  SUM(actual_cost) AS actual_cost,
  SUM(standard_cost) AS standard_cost,
  SUM(CASE WHEN total_tokens IS NULL THEN 1 ELSE 0 END) AS requests_without_usage`;

const minuteMs = 60 * 1000;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;

export function resolveUsageTrendBucketMs(rangeMs: number): number {
  if (rangeMs <= 6 * hourMs) return 5 * minuteMs;
  if (rangeMs <= 48 * hourMs) return hourMs;
  if (rangeMs <= 14 * dayMs) return 6 * hourMs;
  return dayMs;
}

function fillUsageTrend(
  rows: Record<string, unknown>[],
  from: number,
  to: number,
  bucketMs: number,
): UsageTrendPoint[] {
  const rowsByBucket = new Map(rows.map((row) => [asNumber(row.bucket), row]));
  const firstBucket = Math.floor(from / bucketMs) * bucketMs;
  const lastBucket = Math.floor(to / bucketMs) * bucketMs;
  const trend: UsageTrendPoint[] = [];
  for (let bucket = firstBucket; bucket <= lastBucket; bucket += bucketMs) {
    trend.push({ bucket, ...summaryFromRow(rowsByBucket.get(bucket)) });
  }
  return trend;
}

export async function createUsageStore(databasePath: string): Promise<UsageStore> {
  const SQL = await loadSql();
  await mkdir(dirname(databasePath), { recursive: true });
  let bytes: Uint8Array | undefined;
  try {
    bytes = new Uint8Array(await readFile(databasePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  db.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS route_targets (
      route_id TEXT PRIMARY KEY,
      env_name TEXT NOT NULL,
      account_name TEXT NOT NULL,
      upstream_base_url TEXT NOT NULL,
      original_base_url TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage_requests (
      request_id TEXT PRIMARY KEY,
      route_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER NOT NULL,
      env_name TEXT NOT NULL,
      account_name TEXT NOT NULL,
      upstream_base_url TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_creation_tokens INTEGER,
      cache_read_tokens INTEGER,
      total_tokens INTEGER,
      http_status INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL,
      actual_cost REAL,
      standard_cost REAL
    );
    CREATE INDEX IF NOT EXISTS usage_completed_idx ON usage_requests(completed_at);
    CREATE INDEX IF NOT EXISTS usage_env_idx ON usage_requests(env_name, completed_at);
    CREATE INDEX IF NOT EXISTS usage_account_idx ON usage_requests(account_name, completed_at);
    CREATE INDEX IF NOT EXISTS usage_base_url_idx ON usage_requests(upstream_base_url, completed_at);
    CREATE INDEX IF NOT EXISTS usage_model_idx ON usage_requests(model, completed_at);
    CREATE TABLE IF NOT EXISTS pricing_profiles (
      kind TEXT NOT NULL,
      base_url TEXT NOT NULL,
      model_pattern TEXT NOT NULL,
      input_per_million REAL NOT NULL,
      output_per_million REAL NOT NULL,
      cache_creation_per_million REAL,
      cache_read_per_million REAL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(kind, base_url, model_pattern)
    );
  `);
  ensureRouteMetadataColumns(db);

  let closed = false;
  let writeQueue = Promise.resolve();
  const persist = async () => {
    if (closed) return;
    const temporaryPath = `${databasePath}.tmp`;
    await writeFile(temporaryPath, Buffer.from(db.export()));
    await rename(temporaryPath, databasePath);
  };
  const mutate = (operation: () => void): Promise<void> => {
    writeQueue = writeQueue.then(async () => {
      operation();
      await persist();
    });
    return writeQueue;
  };

  await persist();

  return {
    upsertRoute(route) {
      return mutate(() => db.run(
        `INSERT INTO route_targets (
           route_id, env_name, account_name, upstream_base_url, original_base_url,
           enabled, created_at, updated_at, protocol, upstream_model, reasoning_profile, request_overrides_json,
           long_conversation_strategy, instruction_role
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(route_id) DO UPDATE SET
           env_name=excluded.env_name, account_name=excluded.account_name,
           upstream_base_url=excluded.upstream_base_url, original_base_url=excluded.original_base_url,
           enabled=excluded.enabled, protocol=excluded.protocol, upstream_model=excluded.upstream_model,
           reasoning_profile=excluded.reasoning_profile,
           request_overrides_json=excluded.request_overrides_json,
           long_conversation_strategy=excluded.long_conversation_strategy,
           instruction_role=excluded.instruction_role,
           updated_at=excluded.updated_at`,
        [route.routeId, route.envName, route.accountName, route.upstreamBaseUrl, route.originalBaseUrl,
          route.enabled ? 1 : 0, route.createdAt, route.updatedAt, route.protocol,
          route.upstreamModel ?? null, route.reasoningProfile,
          route.requestOverrides ? JSON.stringify(route.requestOverrides) : null,
          route.longConversationStrategy ?? "safe", route.instructionRole ?? "auto"],
      ));
    },
    removeRoute(routeId) {
      return mutate(() => db.run("DELETE FROM route_targets WHERE route_id = ?", [routeId]));
    },
    async listRoutes() {
      await writeQueue;
      return runRows(db, "SELECT * FROM route_targets ORDER BY env_name, account_name", []).map((row) => ({
        routeId: String(row.route_id), envName: String(row.env_name), accountName: String(row.account_name),
        upstreamBaseUrl: String(row.upstream_base_url), originalBaseUrl: String(row.original_base_url),
        protocol: row.protocol === "chat_completions" ? "chat_completions" : "responses",
        upstreamModel: row.upstream_model ? String(row.upstream_model) : undefined,
        reasoningProfile: ["standard", "reasoning_content", "think_tags"].includes(String(row.reasoning_profile))
          ? String(row.reasoning_profile) as RouteTarget["reasoningProfile"] : "auto",
        requestOverrides: parseOverrides(row.request_overrides_json),
        longConversationStrategy: row.long_conversation_strategy === "continuity" ? "continuity" : "safe",
        instructionRole: row.instruction_role === "system" || row.instruction_role === "developer"
          ? row.instruction_role : "auto",
        enabled: Boolean(row.enabled), createdAt: asNumber(row.created_at), updatedAt: asNumber(row.updated_at),
      }));
    },
    recordUsage(request) {
      return mutate(() => {
        const costs = calculateRequestCosts(db, request);
        db.run(
        `INSERT OR REPLACE INTO usage_requests VALUES (${Array.from({ length: 18 }, () => "?").join(",")})`,
        [request.requestId, request.routeId, request.startedAt, request.completedAt, request.envName,
          request.accountName, request.upstreamBaseUrl, request.endpoint, request.model,
          request.inputTokens, request.outputTokens, request.cacheCreationTokens, request.cacheReadTokens,
          request.totalTokens, request.httpStatus, request.latencyMs,
          request.actualCost ?? costs.actual, request.standardCost ?? costs.standard],
        );
      });
    },
    async queryUsage(filter) {
      await writeQueue;
      const clauses = ["completed_at >= ?", "completed_at <= ?"];
      const params: unknown[] = [filter.from, filter.to];
      for (const [column, value] of [
        ["env_name", filter.envName], ["account_name", filter.accountName],
        ["upstream_base_url", filter.baseUrl], ["model", filter.model],
      ] as const) {
        if (value) { clauses.push(`${column} = ?`); params.push(value); }
      }
      const where = `WHERE ${clauses.join(" AND ")}`;
      const summary = summaryFromRow(runRows(db, `SELECT ${aggregateColumns} FROM usage_requests ${where}`, params)[0]);
      const dimensions = (column: string, label: "model" | "baseUrl") => runRows(db,
        `SELECT COALESCE(${column}, 'unknown') AS dimension, ${aggregateColumns}
         FROM usage_requests ${where} GROUP BY COALESCE(${column}, 'unknown') ORDER BY total_tokens DESC`, params,
      ).map((row) => aggregateFromRow(row, label));
      const bucketMs = resolveUsageTrendBucketMs(Math.max(0, filter.to - filter.from));
      const trendRows = runRows(db,
        `SELECT CAST(completed_at / ? AS INTEGER) * ? AS bucket, ${aggregateColumns}
         FROM usage_requests ${where} GROUP BY bucket ORDER BY bucket`, [bucketMs, bucketMs, ...params],
      );
      const trend = fillUsageTrend(trendRows, filter.from, filter.to, bucketMs);
      return { generatedAt: Date.now(), summary, models: dimensions("model", "model"),
        baseUrls: dimensions("upstream_base_url", "baseUrl"), trend };
    },
    async queryUsageRequests(query) {
      await writeQueue;
      const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize) || 20));
      const requestedPage = Math.max(1, Math.trunc(query.page) || 1);
      const facetClauses = ["completed_at >= ?", "completed_at <= ?"];
      const facetParams: unknown[] = [query.from, query.to];
      const baseClauses = [...facetClauses];
      const baseParams = [...facetParams];
      if (query.baseUrl) { baseClauses.push("upstream_base_url = ?"); baseParams.push(query.baseUrl); }

      const clauses = [...baseClauses];
      const params = [...baseParams];
      for (const [column, value] of [
        ["env_name", query.envName], ["account_name", query.accountName],
        ["model", query.model], ["endpoint", query.endpoint],
      ] as const) {
        if (value) { clauses.push(`${column} = ?`); params.push(value); }
      }
      if (query.status === "success") clauses.push("http_status >= 200 AND http_status < 400");
      if (query.status === "error") clauses.push("(http_status < 200 OR http_status >= 400)");
      if (query.search?.trim()) {
        clauses.push("(request_id LIKE ? OR endpoint LIKE ? OR COALESCE(model, '') LIKE ?)");
        const pattern = `%${query.search.trim()}%`;
        params.push(pattern, pattern, pattern);
      }

      const where = `WHERE ${clauses.join(" AND ")}`;
      const total = asNumber(runRows(db, `SELECT COUNT(*) AS total FROM usage_requests ${where}`, params)[0]?.total);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(requestedPage, totalPages);
      const rows = runRows(db,
        `SELECT * FROM usage_requests ${where}
         ORDER BY completed_at DESC, request_id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize],
      );
      const items = rows.map(usageRequestFromRow);
      const facetsWhere = `WHERE ${facetClauses.join(" AND ")}`;
      const facet = (column: string) => runRows(db,
        `SELECT DISTINCT ${column} AS value FROM usage_requests ${facetsWhere}
         AND ${column} IS NOT NULL AND ${column} != '' ORDER BY ${column}`,
        facetParams,
      ).map((row) => String(row.value));

      return {
        generatedAt: Date.now(), items, total, page, pageSize, totalPages,
        facets: {
          envNames: facet("env_name"),
          accountNames: facet("account_name"),
          models: facet("model"),
          endpoints: facet("endpoint"),
        },
      };
    },
    upsertPricing(profile) {
      return mutate(() => {
        db.run(
        `INSERT INTO pricing_profiles VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(kind, base_url, model_pattern) DO UPDATE SET input_per_million=excluded.input_per_million,
         output_per_million=excluded.output_per_million, cache_creation_per_million=excluded.cache_creation_per_million,
         cache_read_per_million=excluded.cache_read_per_million, updated_at=excluded.updated_at`,
        [profile.kind, profile.baseUrl, profile.modelPattern, profile.inputPerMillion, profile.outputPerMillion,
          profile.cacheCreationPerMillion, profile.cacheReadPerMillion, profile.updatedAt],
        );
        repriceBaseUrl(db, profile.baseUrl);
      });
    },
    async listPricing() {
      await writeQueue;
      return runRows(db, "SELECT * FROM pricing_profiles ORDER BY kind, base_url, model_pattern", []).map((row) => ({
        kind: String(row.kind) as "actual" | "standard", baseUrl: String(row.base_url), modelPattern: String(row.model_pattern),
        inputPerMillion: asNumber(row.input_per_million), outputPerMillion: asNumber(row.output_per_million),
        cacheCreationPerMillion: nullableSum(row.cache_creation_per_million),
        cacheReadPerMillion: nullableSum(row.cache_read_per_million), updatedAt: asNumber(row.updated_at),
      }));
    },
    async close() {
      await writeQueue;
      await persist();
      closed = true;
      db.close();
    },
  };
}

function usageRequestFromRow(row: Record<string, unknown>): UsageRequest {
  const nullableNumber = (value: unknown) => value === null || value === undefined ? null : asNumber(value);
  return {
    requestId: String(row.request_id),
    routeId: String(row.route_id),
    startedAt: asNumber(row.started_at),
    completedAt: asNumber(row.completed_at),
    envName: String(row.env_name),
    accountName: String(row.account_name),
    upstreamBaseUrl: String(row.upstream_base_url),
    endpoint: String(row.endpoint),
    model: row.model === null ? null : String(row.model),
    inputTokens: nullableNumber(row.input_tokens),
    outputTokens: nullableNumber(row.output_tokens),
    cacheCreationTokens: nullableNumber(row.cache_creation_tokens),
    cacheReadTokens: nullableNumber(row.cache_read_tokens),
    totalTokens: nullableNumber(row.total_tokens),
    httpStatus: asNumber(row.http_status),
    latencyMs: asNumber(row.latency_ms),
    actualCost: nullableNumber(row.actual_cost),
    standardCost: nullableNumber(row.standard_cost),
  };
}

function globMatches(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

function calculateRequestCosts(db: Database, request: UsageRequest): { actual: number | null; standard: number | null } {
  if (!request.model || request.inputTokens === null || request.outputTokens === null) return { actual: null, standard: null };
  const profiles = runRows(db, "SELECT * FROM pricing_profiles WHERE base_url = ?", [request.upstreamBaseUrl]);
  const calculate = (kind: "actual" | "standard") => {
    const row = profiles
      .filter((item) => item.kind === kind && globMatches(request.model ?? "", String(item.model_pattern)))
      .sort((a, b) => String(b.model_pattern).length - String(a.model_pattern).length)[0];
    if (!row) return null;
    const cacheCreation = request.cacheCreationTokens ?? 0;
    const cacheRead = request.cacheReadTokens ?? 0;
    const uncachedInput = Math.max(0, request.inputTokens! - cacheRead - cacheCreation);
    return (uncachedInput * asNumber(row.input_per_million)
      + request.outputTokens! * asNumber(row.output_per_million)
      + cacheCreation * asNumber(row.cache_creation_per_million ?? row.input_per_million)
      + cacheRead * asNumber(row.cache_read_per_million ?? row.input_per_million)) / 1_000_000;
  };
  return { actual: calculate("actual"), standard: calculate("standard") };
}

function repriceBaseUrl(db: Database, baseUrl: string): void {
  const rows = runRows(db, "SELECT * FROM usage_requests WHERE upstream_base_url = ?", [baseUrl]);
  for (const row of rows) {
    const costs = calculateRequestCosts(db, {
      requestId: String(row.request_id), routeId: String(row.route_id), startedAt: asNumber(row.started_at),
      completedAt: asNumber(row.completed_at), envName: String(row.env_name), accountName: String(row.account_name),
      upstreamBaseUrl: String(row.upstream_base_url), endpoint: String(row.endpoint),
      model: row.model === null ? null : String(row.model), inputTokens: row.input_tokens === null ? null : asNumber(row.input_tokens),
      outputTokens: row.output_tokens === null ? null : asNumber(row.output_tokens),
      cacheCreationTokens: row.cache_creation_tokens === null ? null : asNumber(row.cache_creation_tokens),
      cacheReadTokens: row.cache_read_tokens === null ? null : asNumber(row.cache_read_tokens),
      totalTokens: row.total_tokens === null ? null : asNumber(row.total_tokens), httpStatus: asNumber(row.http_status),
      latencyMs: asNumber(row.latency_ms), actualCost: null, standardCost: null,
    });
    db.run("UPDATE usage_requests SET actual_cost = ?, standard_cost = ? WHERE request_id = ?", [
      costs.actual, costs.standard, String(row.request_id),
    ]);
  }
}
