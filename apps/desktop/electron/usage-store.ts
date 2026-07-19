import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

import type {
  AccountRequestHealth,
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
import type {
  AccountPool,
  PoolMemberHealthState,
  PoolSessionBinding,
} from "./account-pool-routing.js";

export interface UsageStore {
  upsertRoute(route: RouteTarget): Promise<void>;
  removeRoute(routeId: string): Promise<void>;
  listRoutes(): Promise<RouteTarget[]>;
  upsertPool(pool: AccountPool, cursor?: number): Promise<void>;
  updatePoolCursor(poolId: string, cursor: number): Promise<void>;
  removePool(poolId: string): Promise<void>;
  listPools(): Promise<Array<AccountPool & { cursor: number }>>;
  upsertPoolHealth(health: PoolMemberHealthState): Promise<void>;
  listPoolHealth(poolId: string): Promise<PoolMemberHealthState[]>;
  upsertPoolBinding(binding: PoolSessionBinding): Promise<void>;
  listPoolBindings(poolId: string, now?: number): Promise<PoolSessionBinding[]>;
  removePoolBindings(poolId: string, accountName?: string): Promise<void>;
  recordUsage(request: UsageRequest): Promise<void>;
  queryUsage(filter: UsageFilter): Promise<UsageSnapshot>;
  queryUsageRequests(query: UsageRequestQuery): Promise<UsageRequestPage>;
  queryRecentAccountHealth(limit?: number): Promise<AccountRequestHealth[]>;
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

function usageColumns(db: Database): Set<string> {
  return new Set(runRows(db, "PRAGMA table_info(usage_requests)", []).map((row) => String(row.name)));
}

function ensureUsageAuditColumns(db: Database): void {
  const columns = usageColumns(db);
  const migrations = [
    ["pool_id", "TEXT"],
    ["entry_account_name", "TEXT"],
    ["attempted_accounts_json", "TEXT"],
    ["attempt_count", "INTEGER NOT NULL DEFAULT 1"],
    ["failover_reason", "TEXT"],
    ["session_key_hash", "TEXT"],
    ["error_message", "TEXT"],
    ["attempts_json", "TEXT"],
  ] as const;
  for (const [name, definition] of migrations) {
    if (!columns.has(name)) db.run(`ALTER TABLE usage_requests ADD COLUMN ${name} ${definition}`);
  }
  db.run("CREATE INDEX IF NOT EXISTS usage_pool_idx ON usage_requests(pool_id, completed_at)");
}

function ensurePoolMemberColumns(db: Database): void {
  const columns = new Set(runRows(db, "PRAGMA table_info(account_pool_members)", []).map((row) => String(row.name)));
  if (!columns.has("original_base_url")) {
    db.run("ALTER TABLE account_pool_members ADD COLUMN original_base_url TEXT NOT NULL DEFAULT 'default'");
  }
}

function ensurePoolColumns(db: Database): void {
  const columns = new Set(runRows(db, "PRAGMA table_info(account_pools)", []).map((row) => String(row.name)));
  if (!columns.has("max_same_account_failures")) {
    db.run("ALTER TABLE account_pools ADD COLUMN max_same_account_failures INTEGER NOT NULL DEFAULT 1");
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
    CREATE TABLE IF NOT EXISTS account_pools (
      pool_id TEXT PRIMARY KEY,
      env_name TEXT NOT NULL UNIQUE,
      protocol TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      strategy TEXT NOT NULL,
      session_ttl_minutes INTEGER NOT NULL,
      max_failover_attempts INTEGER NOT NULL,
      max_same_account_failures INTEGER NOT NULL DEFAULT 1,
      cursor INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS account_pool_members (
      pool_id TEXT NOT NULL,
      account_name TEXT NOT NULL,
      route_id TEXT NOT NULL,
      protocol TEXT NOT NULL,
      upstream_base_url TEXT NOT NULL,
      original_base_url TEXT NOT NULL,
      upstream_model TEXT,
      enabled INTEGER NOT NULL,
      weight INTEGER NOT NULL,
      priority INTEGER NOT NULL,
      PRIMARY KEY(pool_id, account_name),
      FOREIGN KEY(pool_id) REFERENCES account_pools(pool_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS account_pool_health (
      pool_id TEXT NOT NULL,
      account_name TEXT NOT NULL,
      state TEXT NOT NULL,
      consecutive_failures INTEGER NOT NULL,
      cooldown_until INTEGER,
      last_success_at INTEGER,
      last_failure_at INTEGER,
      last_failure_reason TEXT,
      last_failure_status INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(pool_id, account_name),
      FOREIGN KEY(pool_id) REFERENCES account_pools(pool_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS pool_session_bindings (
      pool_id TEXT NOT NULL,
      session_key_hash TEXT NOT NULL,
      account_name TEXT NOT NULL,
      response_ids_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY(pool_id, session_key_hash),
      FOREIGN KEY(pool_id) REFERENCES account_pools(pool_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS pool_binding_expiry_idx ON pool_session_bindings(pool_id, expires_at);
  `);
  ensureRouteMetadataColumns(db);
  ensureUsageAuditColumns(db);
  ensurePoolMemberColumns(db);
  ensurePoolColumns(db);

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
    upsertPool(pool, cursor = 0) {
      return mutate(() => {
        db.run(
          `INSERT INTO account_pools (
             pool_id, env_name, protocol, enabled, strategy, session_ttl_minutes,
             max_failover_attempts, max_same_account_failures, cursor, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(pool_id) DO UPDATE SET
             env_name=excluded.env_name, protocol=excluded.protocol, enabled=excluded.enabled,
             strategy=excluded.strategy, session_ttl_minutes=excluded.session_ttl_minutes,
             max_failover_attempts=excluded.max_failover_attempts, max_same_account_failures=excluded.max_same_account_failures, cursor=excluded.cursor,
             updated_at=excluded.updated_at`,
          [pool.poolId, pool.envName, pool.protocol, pool.enabled ? 1 : 0, pool.strategy,
            pool.sessionTtlMinutes, pool.maxFailoverAttempts, pool.maxSameAccountFailures, cursor, pool.createdAt, pool.updatedAt],
        );
        db.run("DELETE FROM account_pool_members WHERE pool_id = ?", [pool.poolId]);
        for (const member of pool.members) {
          db.run(
            `INSERT INTO account_pool_members (
               pool_id, account_name, route_id, protocol, upstream_base_url, original_base_url,
               upstream_model, enabled, weight, priority
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [pool.poolId, member.accountName, member.routeId, member.protocol, member.upstreamBaseUrl, member.originalBaseUrl,
              member.upstreamModel ?? null, member.enabled ? 1 : 0, member.weight, member.priority],
          );
          const existing = runRows(db,
            "SELECT 1 AS present FROM account_pool_health WHERE pool_id = ? AND account_name = ?",
            [pool.poolId, member.accountName],
          )[0];
          if (!existing) db.run(
            `INSERT INTO account_pool_health VALUES (?, ?, 'healthy', 0, NULL, NULL, NULL, NULL, NULL, ?)`,
            [pool.poolId, member.accountName, pool.updatedAt],
          );
        }
        db.run(
          `DELETE FROM account_pool_health WHERE pool_id = ?
           AND account_name NOT IN (SELECT account_name FROM account_pool_members WHERE pool_id = ?)`,
          [pool.poolId, pool.poolId],
        );
        db.run(
          `DELETE FROM pool_session_bindings WHERE pool_id = ?
           AND account_name NOT IN (SELECT account_name FROM account_pool_members WHERE pool_id = ?)`,
          [pool.poolId, pool.poolId],
        );
      });
    },
    updatePoolCursor(poolId, cursor) {
      return mutate(() => db.run("UPDATE account_pools SET cursor = ?, updated_at = ? WHERE pool_id = ?", [cursor, Date.now(), poolId]));
    },
    removePool(poolId) {
      return mutate(() => db.run("DELETE FROM account_pools WHERE pool_id = ?", [poolId]));
    },
    async listPools() {
      await writeQueue;
      return runRows(db, "SELECT * FROM account_pools ORDER BY env_name", []).map((row) => {
        const poolId = String(row.pool_id);
        const members = runRows(db,
          "SELECT * FROM account_pool_members WHERE pool_id = ? ORDER BY priority, account_name", [poolId],
        ).map((member) => ({
          accountName: String(member.account_name), routeId: String(member.route_id),
          protocol: member.protocol === "chat_completions" ? "chat_completions" as const : "responses" as const,
          upstreamBaseUrl: String(member.upstream_base_url),
          originalBaseUrl: String(member.original_base_url),
          upstreamModel: member.upstream_model ? String(member.upstream_model) : undefined,
          enabled: Boolean(member.enabled), weight: asNumber(member.weight), priority: asNumber(member.priority),
        }));
        return {
          poolId, envName: String(row.env_name),
          protocol: row.protocol === "chat_completions" ? "chat_completions" as const : "responses" as const,
          enabled: Boolean(row.enabled), strategy: "sticky_weighted_round_robin" as const,
          sessionTtlMinutes: asNumber(row.session_ttl_minutes),
          maxFailoverAttempts: asNumber(row.max_failover_attempts),
          maxSameAccountFailures: Math.max(1, asNumber(row.max_same_account_failures) || 1),
          cursor: asNumber(row.cursor), createdAt: asNumber(row.created_at), updatedAt: asNumber(row.updated_at), members,
        };
      });
    },
    upsertPoolHealth(health) {
      return mutate(() => db.run(
        `INSERT INTO account_pool_health VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(pool_id, account_name) DO UPDATE SET
           state=excluded.state, consecutive_failures=excluded.consecutive_failures,
           cooldown_until=excluded.cooldown_until, last_success_at=excluded.last_success_at,
           last_failure_at=excluded.last_failure_at, last_failure_reason=excluded.last_failure_reason,
           last_failure_status=excluded.last_failure_status, updated_at=excluded.updated_at`,
        [health.poolId, health.accountName, health.state, health.consecutiveFailures, health.cooldownUntil,
          health.lastSuccessAt, health.lastFailureAt, health.lastFailureReason, health.lastFailureStatus, health.updatedAt],
      ));
    },
    async listPoolHealth(poolId) {
      await writeQueue;
      return runRows(db, "SELECT * FROM account_pool_health WHERE pool_id = ? ORDER BY account_name", [poolId]).map((row) => ({
        poolId: String(row.pool_id), accountName: String(row.account_name),
        state: String(row.state) as PoolMemberHealthState["state"], consecutiveFailures: asNumber(row.consecutive_failures),
        cooldownUntil: row.cooldown_until === null ? null : asNumber(row.cooldown_until),
        lastSuccessAt: row.last_success_at === null ? null : asNumber(row.last_success_at),
        lastFailureAt: row.last_failure_at === null ? null : asNumber(row.last_failure_at),
        lastFailureReason: row.last_failure_reason === null ? null : String(row.last_failure_reason) as PoolMemberHealthState["lastFailureReason"],
        lastFailureStatus: row.last_failure_status === null ? null : asNumber(row.last_failure_status), updatedAt: asNumber(row.updated_at),
      }));
    },
    upsertPoolBinding(binding) {
      return mutate(() => {
        db.run("DELETE FROM pool_session_bindings WHERE pool_id = ? AND expires_at <= ?", [binding.poolId, binding.lastUsedAt]);
        db.run(
        `INSERT INTO pool_session_bindings VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(pool_id, session_key_hash) DO UPDATE SET
           account_name=excluded.account_name, response_ids_json=excluded.response_ids_json,
           last_used_at=excluded.last_used_at, expires_at=excluded.expires_at`,
        [binding.poolId, binding.sessionKeyHash, binding.accountName, JSON.stringify(binding.responseIds.slice(-32)),
          binding.createdAt, binding.lastUsedAt, binding.expiresAt],
        );
      });
    },
    async listPoolBindings(poolId, now = Date.now()) {
      await writeQueue;
      return runRows(db,
        "SELECT * FROM pool_session_bindings WHERE pool_id = ? AND expires_at > ? ORDER BY last_used_at DESC",
        [poolId, now],
      ).map((row) => ({
        poolId: String(row.pool_id), sessionKeyHash: String(row.session_key_hash), accountName: String(row.account_name),
        responseIds: parseStringArray(row.response_ids_json), createdAt: asNumber(row.created_at),
        lastUsedAt: asNumber(row.last_used_at), expiresAt: asNumber(row.expires_at),
      }));
    },
    removePoolBindings(poolId, accountName) {
      return mutate(() => db.run(
        accountName
          ? "DELETE FROM pool_session_bindings WHERE pool_id = ? AND account_name = ?"
          : "DELETE FROM pool_session_bindings WHERE pool_id = ?",
        accountName ? [poolId, accountName] : [poolId],
      ));
    },
    recordUsage(request) {
      return mutate(() => {
        const costs = calculateRequestCosts(db, request);
        db.run(
        `INSERT OR REPLACE INTO usage_requests (
           request_id, route_id, started_at, completed_at, env_name, account_name,
           upstream_base_url, endpoint, model, input_tokens, output_tokens,
           cache_creation_tokens, cache_read_tokens, total_tokens, http_status,
           latency_ms, actual_cost, standard_cost, pool_id, entry_account_name,
           attempted_accounts_json, attempt_count, failover_reason, session_key_hash,
           error_message, attempts_json
         ) VALUES (${Array.from({ length: 26 }, () => "?").join(",")})`,
        [request.requestId, request.routeId, request.startedAt, request.completedAt, request.envName,
          request.accountName, request.upstreamBaseUrl, request.endpoint, request.model,
          request.inputTokens, request.outputTokens, request.cacheCreationTokens, request.cacheReadTokens,
          request.totalTokens, request.httpStatus, request.latencyMs,
          request.actualCost ?? costs.actual, request.standardCost ?? costs.standard,
          request.poolId ?? null, request.entryAccountName ?? null,
          JSON.stringify(request.attemptedAccounts ?? [request.accountName]), request.attemptCount ?? 1,
          request.failoverReason ?? null, request.sessionKeyHash ?? null, request.errorMessage ?? null,
          JSON.stringify(request.attempts ?? [])],
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
        ["pool_id", query.poolId], ["failover_reason", query.failoverReason],
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
          poolIds: facet("pool_id"),
          failoverReasons: facet("failover_reason"),
        },
      };
    },
    async queryRecentAccountHealth(limit = 60) {
      await writeQueue;
      const boundedLimit = Math.min(60, Math.max(1, Math.trunc(limit) || 60));
      const rows = runRows(db, `
        WITH account_events AS (
          SELECT request.env_name,
            json_extract(attempt.value, '$.accountName') AS account_name,
            request.completed_at,
            CASE WHEN json_extract(attempt.value, '$.outcome') = 'success' THEN 200
              ELSE COALESCE(json_extract(attempt.value, '$.httpStatus'), 0) END AS http_status,
            CASE WHEN json_extract(attempt.value, '$.outcome') = 'success'
              AND json_extract(attempt.value, '$.accountName') = request.account_name
              THEN request.cache_read_tokens ELSE NULL END AS cache_read_tokens
          FROM usage_requests AS request, json_each(request.attempts_json) AS attempt
          WHERE COALESCE(json_array_length(request.attempts_json), 0) > 0
          UNION ALL
          SELECT env_name, account_name, completed_at, http_status,
            CASE WHEN http_status >= 200 AND http_status < 400 THEN cache_read_tokens ELSE NULL END AS cache_read_tokens
          FROM usage_requests
          WHERE COALESCE(json_array_length(attempts_json), 0) = 0
        )
        SELECT env_name, account_name, completed_at, http_status, cache_read_tokens
        FROM (
          SELECT env_name, account_name, completed_at, http_status, cache_read_tokens,
            ROW_NUMBER() OVER (
              PARTITION BY env_name, account_name
              ORDER BY completed_at DESC
            ) AS request_rank
          FROM account_events
        )
        WHERE request_rank <= ?
        ORDER BY env_name, account_name, completed_at ASC
      `, [boundedLimit]);
      const grouped = new Map<string, AccountRequestHealth>();
      for (const row of rows) {
        const envName = String(row.env_name);
        const accountName = String(row.account_name);
        const key = `${envName}\u0000${accountName}`;
        const current = grouped.get(key) ?? {
          envName, accountName, sampleSize: 0, successRate: null, cacheHitRate: null, segments: [],
        };
        current.segments.push({
          completedAt: asNumber(row.completed_at),
          success: asNumber(row.http_status) >= 200 && asNumber(row.http_status) < 400,
          cacheHit: row.cache_read_tokens === null || row.cache_read_tokens === undefined
            ? null
            : asNumber(row.cache_read_tokens) > 0,
        });
        grouped.set(key, current);
      }
      return Array.from(grouped.values()).map((item) => {
        const cacheSamples = item.segments.filter((segment) => segment.cacheHit !== null);
        return {
          ...item,
          sampleSize: item.segments.length,
          successRate: item.segments.length
            ? item.segments.filter((segment) => segment.success).length / item.segments.length
            : null,
          cacheHitRate: cacheSamples.length
            ? cacheSamples.filter((segment) => segment.cacheHit).length / cacheSamples.length
            : null,
        };
      });
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
    poolId: row.pool_id === null || row.pool_id === undefined ? null : String(row.pool_id),
    entryAccountName: row.entry_account_name === null || row.entry_account_name === undefined ? null : String(row.entry_account_name),
    attemptedAccounts: parseStringArray(row.attempted_accounts_json),
    attemptCount: row.attempt_count === null || row.attempt_count === undefined ? 1 : asNumber(row.attempt_count),
    failoverReason: row.failover_reason === null || row.failover_reason === undefined ? null : String(row.failover_reason),
    sessionKeyHash: row.session_key_hash === null || row.session_key_hash === undefined ? null : String(row.session_key_hash),
    errorMessage: row.error_message === null || row.error_message === undefined ? null : String(row.error_message),
    attempts: parseAttempts(row.attempts_json),
  };
}

function parseAttempts(value: unknown): UsageRequest["attempts"] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is NonNullable<UsageRequest["attempts"]>[number] => {
      if (!item || typeof item !== "object") return false;
      const attempt = item as Record<string, unknown>;
      return typeof attempt.accountName === "string"
        && typeof attempt.startedAt === "number"
        && typeof attempt.completedAt === "number"
        && ["success", "retry", "returned", "failed"].includes(String(attempt.outcome));
    });
  } catch {
    return [];
  }
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
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
