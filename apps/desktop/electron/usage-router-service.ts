import { randomBytes, randomUUID } from "node:crypto";
import { appendFile, chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";

import {
  extractTokenUsage,
  type RouteRuntimeSecret,
  type RouteTarget,
  type UsageFilter,
  type UsageRequestAttempt,
  type UsageRequestQuery,
} from "./usage-routing-model.js";
import {
  classifyPoolFailure,
  derivePoolSessionKey,
  isPoolRetryableFailure,
  nextMemberHealth,
  selectPoolMember,
  type AccountPool,
  type PoolDispatchState,
  type PoolFailureReason,
  type PoolMemberHealthState,
} from "./account-pool-routing.js";
import { createUsageStore, type UsageStore } from "./usage-store.js";
import { RouteSecretStore } from "./openai-chat-compat/route-secret-store.js";
import { ConversationHistoryStore } from "./openai-chat-compat/history-store.js";
import { FileHistoryPersistence } from "./openai-chat-compat/history-persistence.js";
import { handleChatCompatibilityRequest } from "./openai-chat-compat/compatibility-handler.js";

export interface UsageRouterServiceOptions {
  stateDir: string;
  adminToken?: string;
  port?: number;
  preferredPort?: number;
}

export interface RunningUsageRouterService {
  port: number;
  origin: string;
  adminToken: string;
  close(): Promise<void>;
}

interface PoolRuntimeSecret {
  upstreamBearerToken: string;
  authMode: "auth" | "apikey";
  accountId?: string;
  hydratedAt: number;
}

interface RouterStateFile {
  pid: number;
  port: number;
  adminToken: string;
  startedAt: number;
}

interface RouterPortStateFile {
  preferredPort: number;
  selectedPort: number;
}

export const USAGE_ROUTER_API_VERSION = 9;

function isValidPort(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1024 && Number(value) <= 65535;
}

async function readRouterPortState(path: string): Promise<RouterPortStateFile | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<RouterPortStateFile>;
    if (!isValidPort(value.preferredPort) || !isValidPort(value.selectedPort)) return null;
    return { preferredPort: value.preferredPort, selectedPort: value.selectedPort };
  } catch {
    return null;
  }
}

function listenOnPort(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => { cleanup(); reject(error); };
    const onListening = () => { cleanup(); resolve(); };
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

async function listenOnPreferredPort(server: Server, preferredPort: number, selectedPort: number): Promise<number> {
  const candidates: number[] = [];
  for (let port = selectedPort; port <= 65535; port += 1) candidates.push(port);
  for (let port = preferredPort; port < selectedPort; port += 1) candidates.push(port);
  for (const port of candidates) {
    try {
      await listenOnPort(server, port);
      return port;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error(`No available local router port from ${preferredPort} to 65535`);
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

async function readJson(request: IncomingMessage, maxBytes = 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("JSON payload is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
}

async function relayResponse(source: Response, target: ServerResponse, tap?: { push(chunk: Uint8Array): void }): Promise<void> {
  target.statusCode = source.status;
  source.headers.forEach((value, name) => {
    if (!["content-length", "transfer-encoding", "connection"].includes(name.toLowerCase())) target.setHeader(name, value);
  });
  if (source.body) {
    const reader = source.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      tap?.push(value);
      if (!target.write(Buffer.from(value))) await new Promise<void>((resolve) => target.once("drain", resolve));
    }
  }
  target.end();
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  return request.headers.authorization === `Bearer ${token}`;
}

function filterFromUrl(url: URL): UsageFilter {
  const from = Number(url.searchParams.get("from"));
  const to = Number(url.searchParams.get("to"));
  return {
    from: Number.isFinite(from) ? from : Date.now() - 24 * 60 * 60 * 1000,
    to: Number.isFinite(to) ? to : Date.now(),
    envName: url.searchParams.get("envName") || undefined,
    accountName: url.searchParams.get("accountName") || undefined,
    baseUrl: url.searchParams.get("baseUrl") || undefined,
    model: url.searchParams.get("model") || undefined,
  };
}

function requestQueryFromUrl(url: URL): UsageRequestQuery {
  const filter = filterFromUrl(url);
  const page = Number(url.searchParams.get("page"));
  const pageSize = Number(url.searchParams.get("pageSize"));
  const status = url.searchParams.get("status");
  return {
    ...filter,
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 20,
    endpoint: url.searchParams.get("endpoint") || undefined,
    poolId: url.searchParams.get("poolId") || undefined,
    failoverReason: url.searchParams.get("failoverReason") || undefined,
    status: status === "success" || status === "error" ? status : undefined,
    search: url.searchParams.get("search") || undefined,
  };
}

function forwardedHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  const blocked = new Set(["host", "content-length", "connection", "transfer-encoding"]);
  for (const [name, value] of Object.entries(headers)) {
    if (blocked.has(name.toLowerCase()) || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((item) => result.append(name, item));
    else result.set(name, value);
  }
  return result;
}

class UsageTap {
  private readonly decoder = new TextDecoder();
  private text = "";
  private sseBuffer = "";
  private latest: ReturnType<typeof extractTokenUsage> = null;

  push(chunk: Uint8Array): void {
    const decoded = this.decoder.decode(chunk, { stream: true });
    if (this.text.length < 4 * 1024 * 1024) this.text += decoded;
    this.sseBuffer += decoded;
    const lines = this.sseBuffer.split(/\r?\n/);
    this.sseBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try { this.latest = extractTokenUsage(JSON.parse(data)) ?? this.latest; } catch { /* partial SSE line */ }
    }
  }

  finish(): ReturnType<typeof extractTokenUsage> {
    const finalText = this.decoder.decode();
    this.text += finalText;
    this.sseBuffer += finalText;
    if (this.sseBuffer.startsWith("data:")) {
      const data = this.sseBuffer.slice(5).trim();
      try { this.latest = extractTokenUsage(JSON.parse(data)) ?? this.latest; } catch { /* incomplete final event */ }
    }
    try { this.latest = extractTokenUsage(JSON.parse(this.text)) ?? this.latest; } catch { /* SSE or non-JSON */ }
    return this.latest;
  }

  responseId(): string | null {
    try {
      const parsed = JSON.parse(this.text) as { id?: unknown };
      return typeof parsed.id === "string" ? parsed.id : null;
    } catch {
      return null;
    }
  }

  errorSummary(status: number): string | null {
    return status >= 400 ? extractSafeErrorMessage(this.text, `Upstream returned HTTP ${status}`) : null;
  }
}

async function readRequestBodyBuffer(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 32 * 1024 * 1024) throw new Error("JSON payload is too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parseRequestBody(value: Buffer): Record<string, unknown> | undefined {
  if (!value.length) return undefined;
  try {
    const parsed = JSON.parse(value.toString("utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function initialPoolHealth(pool: AccountPool, saved: PoolMemberHealthState[]): PoolMemberHealthState[] {
  const byAccount = new Map(saved.map((item) => [item.accountName, item]));
  return pool.members.map((member) => byAccount.get(member.accountName) ?? {
    poolId: pool.poolId, accountName: member.accountName, state: "healthy", consecutiveFailures: 0,
    cooldownUntil: null, lastSuccessAt: null, lastFailureAt: null, lastFailureReason: null, lastFailureStatus: null, updatedAt: Date.now(),
  });
}

function sanitizePoolFailureReason(reason: PoolFailureReason): string { return reason; }

export function sanitizeRouterErrorMessage(value: unknown): string | null {
  const raw = value instanceof Error ? value.message : typeof value === "string" ? value : String(value ?? "");
  const normalized = raw
    .replace(/((?:api[_-]?key|authorization|cookie)\s*[=:]\s*)(?:Bearer\s+)?[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{3,}\b/g, "sk-[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, 600) : null;
}

export function extractSafeErrorMessage(value: string, fallback?: string): string | null {
  const trimmed = value.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        const error = record.error;
        const candidate = typeof error === "string"
          ? error
          : error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string"
            ? (error as Record<string, unknown>).message
            : typeof record.message === "string"
              ? record.message
              : typeof record.detail === "string" ? record.detail : null;
        if (candidate) return sanitizeRouterErrorMessage(candidate);
      }
    } catch {
      // Non-JSON error bodies are still useful after redaction and truncation.
    }
    return sanitizeRouterErrorMessage(trimmed);
  }
  return sanitizeRouterErrorMessage(fallback);
}

async function proxyAccountPoolRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pool: AccountPool & { cursor: number },
  routes: Map<string, RouteTarget>,
  secrets: Map<string, PoolRuntimeSecret>,
  localRouteToken: string,
  store: UsageStore,
  history: ConversationHistoryStore,
  routeSuffix: string,
  entryAccountNameOverride?: string,
  recordEvent?: (event: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  const startedAt = Date.now();
  const body = request.method === "GET" || request.method === "HEAD" ? Buffer.alloc(0) : await readRequestBodyBuffer(request);
  const parsedBody = parseRequestBody(body);
  const entryAccountName = request.headers["x-codex-account"]?.toString() || entryAccountNameOverride;
  const derived = derivePoolSessionKey({ headers: request.headers as Record<string, string | string[] | undefined>, body: parsedBody, endpoint: `/${routeSuffix}`, model: typeof parsedBody?.model === "string" ? parsedBody.model : undefined, entryAccountName });
  const bindings = await store.listPoolBindings(pool.poolId);
  const attempted: string[] = [];
  const memberAttempts = new Map<string, number>();
  let retryAccountName: string | undefined;
  const attempts: UsageRequestAttempt[] = [];
  let finalAccount = "";
  let finalBaseUrl = "";
  let finalStatus = 503;
  let finalUsage: ReturnType<typeof extractTokenUsage> = null;
  let finalReason: string | null = null;
  let finalErrorMessage: string | null = null;
  let finalResponseId: string | null = null;
  let bindingKeyHash = derived.keyHash;
  let didRelayBytes = false;
  const maxSameAccountFailures = Math.min(3, Math.max(1, pool.maxSameAccountFailures ?? 1));
  const maxAttempts = Math.min(6, Math.max(1, (pool.maxFailoverAttempts + 1) * maxSameAccountFailures));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const health = initialPoolHealth(pool, await store.listPoolHealth(pool.poolId));
    const candidateState: PoolDispatchState = {
      pool: { ...pool, members: pool.members.map((member) => (memberAttempts.get(member.accountName) ?? 0) >= maxSameAccountFailures ? { ...member, enabled: false } : member) },
      health, bindings, cursor: pool.cursor + attempt,
    };
    const selection = selectPoolMember(candidateState, { headers: request.headers as Record<string, string | string[] | undefined>, body: parsedBody, endpoint: `/${routeSuffix}`, model: typeof parsedBody?.model === "string" ? parsedBody.model : undefined, entryAccountName: retryAccountName ?? entryAccountName });
    if (!selection) {
      finalReason = "no_available_member";
      finalErrorMessage = "No account in the pool is currently available";
      break;
    }
    bindingKeyHash = selection.sessionKeyHash;
    if (selection.affinity === "weighted_round_robin") {
      pool.cursor += 1;
      await store.updatePoolCursor(pool.poolId, pool.cursor);
    }
    const member = selection.member;
    memberAttempts.set(member.accountName, (memberAttempts.get(member.accountName) ?? 0) + 1);
    const attemptStartedAt = Date.now();
    const route = routes.get(member.routeId) ?? {
      routeId: member.routeId, envName: pool.envName, accountName: member.accountName,
      upstreamBaseUrl: member.upstreamBaseUrl, originalBaseUrl: member.originalBaseUrl,
      protocol: member.protocol, upstreamModel: member.upstreamModel, reasoningProfile: "auto" as const,
      enabled: true, createdAt: pool.createdAt, updatedAt: pool.updatedAt,
    };
    const secret = secrets.get(member.accountName);
    if (!route || !secret) {
      memberAttempts.set(member.accountName, maxSameAccountFailures);
      retryAccountName = undefined;
      await store.upsertPoolHealth(nextMemberHealth(health.find((item) => item.accountName === member.accountName)!, { ok: false, status: 401, reason: "unauthorized" }, Date.now()));
      attempted.push(member.accountName);
      finalReason = "unauthorized";
      finalErrorMessage = "Runtime credential is unavailable for the selected account";
      attempts.push({ accountName: member.accountName, startedAt: attemptStartedAt, completedAt: Date.now(),
        httpStatus: 401, reason: finalReason, errorMessage: finalErrorMessage,
        outcome: attempt + 1 < maxAttempts ? "retry" : "failed" });
      continue;
    }
    attempted.push(member.accountName); finalAccount = member.accountName; finalBaseUrl = route.upstreamBaseUrl;
    const upstream = `${route.upstreamBaseUrl.replace(/\/+$/, "")}/${routeSuffix.replace(/^\/+/, "")}`;
    const headers = forwardedHeaders(request.headers);
    headers.set("authorization", `Bearer ${secret.upstreamBearerToken}`);
    headers.delete("chatgpt-account-id");
    if (secret.authMode === "auth" && secret.accountId) headers.set("chatgpt-account-id", secret.accountId);
    let upstreamResponse: Response;
    try {
      upstreamResponse = pool.protocol === "chat_completions"
        ? await handleChatCompatibilityRequest({
          route, secret: { routeId: route.routeId, upstreamApiKey: secret.upstreamBearerToken, localRouteToken, hydratedAt: secret.hydratedAt },
          authorization: `Bearer ${localRouteToken}`, request: parsedBody ?? {}, headers,
          history, signal: AbortSignal.timeout(120_000),
        })
        : await fetch(upstream, {
          method: request.method, headers, body: body.length ? body as unknown as BodyInit : undefined, redirect: "manual",
          ...(body.length ? { duplex: "half" } as RequestInit : {}), signal: AbortSignal.timeout(120_000),
        });
    } catch (error) {
      const reason = classifyPoolFailure(null, error);
      const sameAccountLimitReached = (memberAttempts.get(member.accountName) ?? 0) >= maxSameAccountFailures;
      if (sameAccountLimitReached) {
        await store.upsertPoolHealth(nextMemberHealth(health.find((item) => item.accountName === member.accountName)!, { ok: false, reason }, Date.now()));
        retryAccountName = undefined;
      } else {
        retryAccountName = member.accountName;
      }
      finalReason = sanitizePoolFailureReason(reason);
      finalErrorMessage = sanitizeRouterErrorMessage(error) ?? "Unable to connect to the selected upstream account";
      const willRetry = attempt + 1 < maxAttempts && isPoolRetryableFailure(reason, null);
      attempts.push({ accountName: member.accountName, startedAt: attemptStartedAt, completedAt: Date.now(),
        httpStatus: null, reason: finalReason, errorMessage: finalErrorMessage, outcome: willRetry ? "retry" : "failed" });
      if (willRetry) continue;
      sendJson(response, 502, { error: { message: "All selected accounts failed before receiving a response" }, code: "POOL_UPSTREAM_UNAVAILABLE" });
      finalStatus = 502; break;
    }
    const reason = classifyPoolFailure(upstreamResponse.status);
    const retryable = !upstreamResponse.ok && isPoolRetryableFailure(reason, upstreamResponse.status);
    if (retryable && attempt + 1 < maxAttempts) {
      const errorBody = await upstreamResponse.arrayBuffer().catch(() => null);
      const errorMessage = extractSafeErrorMessage(errorBody ? Buffer.from(errorBody).toString("utf8") : "",
        `Upstream returned HTTP ${upstreamResponse.status}`);
      const sameAccountLimitReached = (memberAttempts.get(member.accountName) ?? 0) >= maxSameAccountFailures;
      if (sameAccountLimitReached) {
        await store.upsertPoolHealth(nextMemberHealth(health.find((item) => item.accountName === member.accountName)!, { ok: false, status: upstreamResponse.status, reason, retryAfterMs: retryAfterMs(upstreamResponse) }, Date.now()));
        retryAccountName = undefined;
      } else {
        retryAccountName = member.accountName;
      }
      finalReason = sanitizePoolFailureReason(reason);
      finalErrorMessage = errorMessage;
      attempts.push({ accountName: member.accountName, startedAt: attemptStartedAt, completedAt: Date.now(),
        httpStatus: upstreamResponse.status, reason: finalReason, errorMessage, outcome: "retry" });
      continue;
    }
    const tap = new UsageTap();
    try {
      await relayResponse(upstreamResponse, response, { push(chunk) { didRelayBytes = true; tap.push(chunk); } });
      finalUsage = tap.finish(); finalResponseId = tap.responseId(); finalStatus = upstreamResponse.status;
      finalErrorMessage = tap.errorSummary(upstreamResponse.status);
      if (!upstreamResponse.ok) finalReason = sanitizePoolFailureReason(reason);
      attempts.push({ accountName: member.accountName, startedAt: attemptStartedAt, completedAt: Date.now(),
        httpStatus: upstreamResponse.status, reason: upstreamResponse.ok ? null : finalReason,
        errorMessage: finalErrorMessage, outcome: upstreamResponse.ok ? "success" : "returned" });
      if (upstreamResponse.ok || retryable || reason === "unauthorized" || reason === "quota") {
        await store.upsertPoolHealth(nextMemberHealth(health.find((item) => item.accountName === member.accountName)!, { ok: upstreamResponse.ok, status: upstreamResponse.status, reason, retryAfterMs: retryAfterMs(upstreamResponse) }, Date.now()));
      }
    } catch (error) {
      didRelayBytes = true;
      finalStatus = 502; finalReason = "stream_interrupted";
      finalErrorMessage = sanitizeRouterErrorMessage(error) ?? "The upstream response stream was interrupted";
      attempts.push({ accountName: member.accountName, startedAt: attemptStartedAt, completedAt: Date.now(),
        httpStatus: 502, reason: finalReason, errorMessage: finalErrorMessage, outcome: "failed" });
      await store.upsertPoolHealth(nextMemberHealth(health.find((item) => item.accountName === member.accountName)!, { ok: false, reason: "stream_interrupted" }, Date.now()));
      if (!response.headersSent) sendJson(response, 502, { error: { message: error instanceof Error ? error.message : String(error) } });
    }
    break;
  }

  const completedAt = Date.now();
  if (finalAccount && finalStatus >= 200 && finalStatus < 400) {
    const existing = bindings.find((binding) => binding.sessionKeyHash === bindingKeyHash);
    await store.upsertPoolBinding({ poolId: pool.poolId, sessionKeyHash: bindingKeyHash, accountName: finalAccount,
      responseIds: Array.from(new Set([...(existing?.responseIds ?? []), ...(finalResponseId ? [finalResponseId] : [])])).slice(-32),
      createdAt: existing?.createdAt ?? startedAt, lastUsedAt: completedAt,
      expiresAt: completedAt + pool.sessionTtlMinutes * 60_000 });
  }
  await store.recordUsage({ requestId: randomUUID(), routeId: pool.poolId, startedAt, completedAt,
    envName: pool.envName, accountName: finalAccount || "unknown", upstreamBaseUrl: finalBaseUrl,
    endpoint: `/${routeSuffix.replace(/^\/+/, "")}`, model: finalUsage?.model ?? null,
    inputTokens: finalUsage?.inputTokens ?? null, outputTokens: finalUsage?.outputTokens ?? null,
    cacheCreationTokens: finalUsage?.cacheCreationTokens ?? null, cacheReadTokens: finalUsage?.cacheReadTokens ?? null,
    totalTokens: finalUsage?.totalTokens ?? null, httpStatus: finalStatus, latencyMs: completedAt - startedAt,
    actualCost: null, standardCost: null, poolId: pool.poolId, entryAccountName: entryAccountName ?? null,
    attemptedAccounts: attempted, attemptCount: attempted.length, failoverReason: attempted.length > 1 ? finalReason : null,
    sessionKeyHash: bindingKeyHash, errorMessage: finalErrorMessage, attempts });
  await recordEvent?.({ event: "pool_request_completed", at: completedAt, poolId: pool.poolId,
    envName: pool.envName, entryAccountName: entryAccountName ?? null, finalAccountName: finalAccount || null,
    attemptedAccounts: attempted, attemptCount: attempted.length, status: finalStatus,
    failoverReason: attempted.length > 1 ? finalReason : null, latencyMs: completedAt - startedAt,
    sessionKeyHash: bindingKeyHash, errorMessage: finalErrorMessage, attempts });
  if (!didRelayBytes && !response.writableEnded) sendJson(response, finalStatus, { error: { message: "No account in the pool is currently available" }, code: "POOL_NO_AVAILABLE_MEMBER" });
}

async function proxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  route: RouteTarget,
  routeSuffix: string,
  store: UsageStore,
): Promise<void> {
  const startedAt = Date.now();
  const upstream = `${route.upstreamBaseUrl.replace(/\/+$/, "")}/${routeSuffix.replace(/^\/+/, "")}`;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstream, {
      method: request.method,
      headers: forwardedHeaders(request.headers),
      body: hasBody ? (Readable.toWeb(request) as ReadableStream<Uint8Array>) : undefined,
      redirect: "manual",
      ...(hasBody ? { duplex: "half" } as RequestInit : {}),
    });
  } catch (error) {
    const errorMessage = sanitizeRouterErrorMessage(error) ?? "Unable to connect to upstream";
    sendJson(response, 502, { error: errorMessage });
    const completedAt = Date.now();
    await store.recordUsage({
      requestId: randomUUID(), routeId: route.routeId, startedAt, completedAt,
      envName: route.envName, accountName: route.accountName, upstreamBaseUrl: route.upstreamBaseUrl,
      endpoint: `/${routeSuffix.replace(/^\/+/, "")}`, model: null, inputTokens: null, outputTokens: null,
      cacheCreationTokens: null, cacheReadTokens: null, totalTokens: null, httpStatus: 502,
      latencyMs: completedAt - startedAt, actualCost: null, standardCost: null, errorMessage,
    });
    return;
  }

  const tap = new UsageTap();
  await relayResponse(upstreamResponse, response, tap);
  const completedAt = Date.now();
  const usage = tap.finish();
  await store.recordUsage({
    requestId: randomUUID(), routeId: route.routeId, startedAt, completedAt,
    envName: route.envName, accountName: route.accountName, upstreamBaseUrl: route.upstreamBaseUrl,
    endpoint: `/${routeSuffix.replace(/^\/+/, "")}`, model: usage?.model ?? null,
    inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null,
    cacheCreationTokens: usage?.cacheCreationTokens ?? null, cacheReadTokens: usage?.cacheReadTokens ?? null,
    totalTokens: usage?.totalTokens ?? null, httpStatus: upstreamResponse.status,
    latencyMs: completedAt - startedAt, actualCost: null, standardCost: null,
    errorMessage: tap.errorSummary(upstreamResponse.status),
  });
}

async function proxyCompatibilityRequest(
  request: IncomingMessage,
  response: ServerResponse,
  route: RouteTarget,
  secret: RouteRuntimeSecret,
  store: UsageStore,
  history: ConversationHistoryStore,
): Promise<void> {
  const startedAt = Date.now();
  let status = 500;
  let errorMessage: string | null = null;
  const tap = new UsageTap();
  try {
    const requestBody = await readJson(request, 32 * 1024 * 1024) as Record<string, unknown>;
    const result = await handleChatCompatibilityRequest({
      route, secret, authorization: request.headers.authorization, request: requestBody,
      headers: forwardedHeaders(request.headers), history,
    });
    status = result.status;
    await relayResponse(result, response, tap);
  } catch (error) {
    status = typeof (error as { status?: unknown }).status === "number" ? Number((error as { status: number }).status) : 500;
    errorMessage = sanitizeRouterErrorMessage(error) ?? "Compatibility routing failed";
    sendJson(response, status, { error: { message: errorMessage } });
  }
  const completedAt = Date.now();
  const usage = tap.finish();
  await store.recordUsage({ requestId: randomUUID(), routeId: route.routeId, startedAt, completedAt,
    envName: route.envName, accountName: route.accountName, upstreamBaseUrl: route.upstreamBaseUrl,
    endpoint: "/responses", model: usage?.model ?? null, inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null, cacheCreationTokens: usage?.cacheCreationTokens ?? null,
    cacheReadTokens: usage?.cacheReadTokens ?? null, totalTokens: usage?.totalTokens ?? null,
    httpStatus: status, latencyMs: completedAt - startedAt, actualCost: null, standardCost: null,
    errorMessage: errorMessage ?? tap.errorSummary(status) });
}

export async function startUsageRouterService(options: UsageRouterServiceOptions): Promise<RunningUsageRouterService> {
  await mkdir(options.stateDir, { recursive: true });
  const store = await createUsageStore(join(options.stateDir, "usage.db"));
  const adminToken = options.adminToken ?? randomBytes(32).toString("hex");
  const routes = new Map((await store.listRoutes()).filter((route) => route.enabled).map((route) => [route.routeId, route]));
  const pools = new Map((await store.listPools()).filter((pool) => pool.enabled).map((pool) => [pool.poolId, pool]));
  const poolSecrets = new Map<string, Map<string, PoolRuntimeSecret>>();
  const poolTokens = new Map<string, string>();
  const routeSecrets = new RouteSecretStore();
  const history = new ConversationHistoryStore({
    persistence: new FileHistoryPersistence(join(options.stateDir, "chat-history")),
  });
  const statePath = join(options.stateDir, "router-state.json");
  const portStatePath = join(options.stateDir, "router-port.json");
  const eventLogPath = join(options.stateDir, "router-events.jsonl");
  let eventLogQueue = Promise.resolve();
  const recordPoolEvent = (event: Record<string, unknown>) => {
    eventLogQueue = eventLogQueue.then(async () => {
      const current = await stat(eventLogPath).catch(() => null);
      if (current && current.size >= 5 * 1024 * 1024) {
        await unlink(`${eventLogPath}.1`).catch(() => undefined);
        await rename(eventLogPath, `${eventLogPath}.1`).catch(() => undefined);
      }
      await appendFile(eventLogPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
    }).catch(() => undefined);
    return eventLogQueue;
  };
  let closePromise: Promise<void> | null = null;
  let closeService: () => Promise<void> = async () => undefined;

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/health") return sendJson(response, 200, { ok: true, pid: process.pid, apiVersion: USAGE_ROUTER_API_VERSION });
      if (url.pathname.startsWith("/admin/")) {
        if (!isAuthorized(request, adminToken)) return sendJson(response, 401, { error: "Unauthorized" });
        if (url.pathname === "/admin/routes" && request.method === "GET") {
          return sendJson(response, 200, await store.listRoutes());
        }
        if (url.pathname === "/admin/pools" && request.method === "GET") {
          return sendJson(response, 200, await store.listPools());
        }
        if (url.pathname === "/admin/pools" && request.method === "PUT") {
          const pool = await readJson(request) as AccountPool & { cursor?: number };
          const memberNames = new Set(pool?.members?.map((member) => member.accountName));
          const validMembers = Array.isArray(pool?.members) && pool.members.length > 0
            && memberNames.size === pool.members.length
            && pool.members.every((member) => member.protocol === pool.protocol
              && typeof member.accountName === "string" && member.accountName.trim()
              && /^https?:\/\//.test(member.upstreamBaseUrl)
              && typeof member.originalBaseUrl === "string" && member.originalBaseUrl.trim()
              && Number.isFinite(member.weight) && member.weight >= 1 && member.weight <= 100);
          if (!pool || typeof pool.poolId !== "string" || !pool.poolId.trim()
            || typeof pool.envName !== "string" || !pool.envName.trim()
            || !["responses", "chat_completions"].includes(pool.protocol)
            || pool.strategy !== "sticky_weighted_round_robin" || !validMembers) {
            return sendJson(response, 400, { error: "Invalid account pool" });
          }
          await store.upsertPool(pool, pool.cursor ?? 0);
          if (pool.enabled) pools.set(pool.poolId, { ...pool, cursor: pool.cursor ?? 0 });
          else { pools.delete(pool.poolId); poolSecrets.delete(pool.poolId); poolTokens.delete(pool.poolId); }
          response.statusCode = 204; return response.end();
        }
        const poolHealthMatch = url.pathname.match(/^\/admin\/pools\/([^/]+)\/health$/);
        if (poolHealthMatch && request.method === "GET") {
          const poolId = decodeURIComponent(poolHealthMatch[1]);
          if (!pools.has(poolId)) return sendJson(response, 404, { error: "Pool is disabled or missing" });
          return sendJson(response, 200, await store.listPoolHealth(poolId));
        }
        const poolSecretMatch = url.pathname.match(/^\/admin\/pools\/([^/]+)\/members\/([^/]+)\/secret$/);
        if (poolSecretMatch && request.method === "PUT") {
          const poolId = decodeURIComponent(poolSecretMatch[1]);
          const accountName = decodeURIComponent(poolSecretMatch[2]);
          const pool = pools.get(poolId);
          if (!pool || !pool.members.some((member) => member.accountName === accountName)) return sendJson(response, 404, { error: "Pool member is missing" });
          const payload = await readJson(request) as { upstreamBearerToken?: unknown; upstreamApiKey?: unknown; authMode?: unknown; accountId?: unknown };
          const upstreamBearerToken = typeof payload.upstreamBearerToken === "string"
            ? payload.upstreamBearerToken : typeof payload.upstreamApiKey === "string" ? payload.upstreamApiKey : "";
          if (!upstreamBearerToken.trim()) return sendJson(response, 400, { error: "Upstream bearer credential is required" });
          const secrets = poolSecrets.get(poolId) ?? new Map<string, PoolRuntimeSecret>();
          secrets.set(accountName, {
            upstreamBearerToken,
            authMode: payload.authMode === "auth" ? "auth" : "apikey",
            accountId: typeof payload.accountId === "string" && payload.accountId.trim() ? payload.accountId.trim() : undefined,
            hydratedAt: Date.now(),
          });
          poolSecrets.set(poolId, secrets);
          const currentHealth = (await store.listPoolHealth(poolId)).find((item) => item.accountName === accountName);
          if (currentHealth && ["unauthorized", "exhausted"].includes(currentHealth.state)) {
            await store.upsertPoolHealth({ ...currentHealth, state: "healthy", consecutiveFailures: 0, cooldownUntil: null, updatedAt: Date.now() });
          }
          response.statusCode = 204; return response.end();
        }
        const poolTokenMatch = url.pathname.match(/^\/admin\/pools\/([^/]+)\/token$/);
        if (poolTokenMatch && request.method === "PUT") {
          const poolId = decodeURIComponent(poolTokenMatch[1]);
          if (!pools.has(poolId)) return sendJson(response, 404, { error: "Pool is disabled or missing" });
          const payload = await readJson(request) as { localRouteToken?: unknown };
          if (typeof payload.localRouteToken !== "string" || !payload.localRouteToken.trim()) return sendJson(response, 400, { error: "Local route token is required" });
          poolTokens.set(poolId, payload.localRouteToken);
          response.statusCode = 204; return response.end();
        }
        const poolDeleteMatch = url.pathname.match(/^\/admin\/pools\/([^/]+)$/);
        if (poolDeleteMatch && request.method === "DELETE") {
          const poolId = decodeURIComponent(poolDeleteMatch[1]);
          pools.delete(poolId); poolSecrets.delete(poolId); poolTokens.delete(poolId);
          await store.removePool(poolId);
          response.statusCode = 204; return response.end();
        }
        if (url.pathname === "/admin/stats" && request.method === "GET") {
          return sendJson(response, 200, await store.queryUsage(filterFromUrl(url)));
        }
        if (url.pathname === "/admin/requests" && request.method === "GET") {
          return sendJson(response, 200, await store.queryUsageRequests(requestQueryFromUrl(url)));
        }
        if (url.pathname === "/admin/account-health" && request.method === "GET") {
          return sendJson(response, 200, await store.queryRecentAccountHealth(Number(url.searchParams.get("limit")) || 60));
        }
        if (url.pathname === "/admin/pricing" && request.method === "GET") {
          return sendJson(response, 200, await store.listPricing());
        }
        if (url.pathname === "/admin/pricing" && request.method === "PUT") {
          await store.upsertPricing(await readJson(request) as import("./usage-routing-model.js").PricingProfile);
          response.statusCode = 204; return response.end();
        }
        if (url.pathname === "/admin/shutdown" && request.method === "POST") {
          response.statusCode = 204;
          response.end();
          setImmediate(() => { void closeService(); });
          return;
        }
        const routeSecretMatch = url.pathname.match(/^\/admin\/routes\/([^/]+)\/secret$/);
        const routeStatusMatch = url.pathname.match(/^\/admin\/routes\/([^/]+)\/status$/);
        if (routeStatusMatch && request.method === "GET") {
          const routeId = decodeURIComponent(routeStatusMatch[1]);
          const route = routes.get(routeId);
          if (!route) return sendJson(response, 404, { error: "Route is disabled or missing" });
          return sendJson(response, 200, { routeId, hydrated: route.protocol !== "chat_completions" || Boolean(routeSecrets.get(routeId)) });
        }
        if (routeSecretMatch && request.method === "PUT") {
          const routeId = decodeURIComponent(routeSecretMatch[1]);
          if (!routes.has(routeId)) return sendJson(response, 404, { error: "Route is disabled or missing" });
          const payload = await readJson(request) as Partial<RouteRuntimeSecret>;
          try {
            routeSecrets.set({
              routeId,
              upstreamApiKey: typeof payload.upstreamApiKey === "string" ? payload.upstreamApiKey : "",
              localRouteToken: typeof payload.localRouteToken === "string" ? payload.localRouteToken : "",
              hydratedAt: Date.now(),
            });
          } catch (error) {
            return sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
          }
          response.statusCode = 204; return response.end();
        }
        const routeMatch = url.pathname.match(/^\/admin\/routes\/([^/]+)$/);
        if (routeMatch && request.method === "PUT") {
          const route = await readJson(request) as RouteTarget;
          if (!route || route.routeId !== decodeURIComponent(routeMatch[1])) return sendJson(response, 400, { error: "Invalid route" });
          await store.upsertRoute(route);
          if (route.enabled) routes.set(route.routeId, route); else routes.delete(route.routeId);
          response.statusCode = 204; return response.end();
        }
        if (routeMatch && request.method === "DELETE") {
          const routeId = decodeURIComponent(routeMatch[1]);
          routes.delete(routeId); routeSecrets.delete(routeId); history.invalidateRoute(routeId); await store.removeRoute(routeId);
          response.statusCode = 204; return response.end();
        }
        return sendJson(response, 404, { error: "Not found" });
      }
      const poolMatch = url.pathname.match(/^\/pools\/([^/]+)\/?(.*)$/);
      if (poolMatch) {
        const poolId = decodeURIComponent(poolMatch[1]);
        if (!pools.has(poolId)) return sendJson(response, 404, { error: "Pool is disabled or missing" });
        const token = poolTokens.get(poolId);
        const incomingToken = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
        const memberSecrets = poolSecrets.get(poolId) ?? new Map<string, PoolRuntimeSecret>();
        const matchedMember = Array.from(memberSecrets.entries())
          .find(([, secret]) => secret.upstreamBearerToken === incomingToken)?.[0];
        const authorized = Boolean(token && incomingToken === token) || Boolean(matchedMember);
        if (!authorized) return sendJson(response, 401, { error: "Unauthorized" });
        const pool = pools.get(poolId);
        const routeSuffix = poolMatch[2] || "responses";
        return await proxyAccountPoolRequest(request, response, pool!, routes, new Map(
          Array.from(memberSecrets.entries()).map(([accountName, value]) => [accountName, value]),
        ), token ?? "", store, history, routeSuffix, matchedMember, recordPoolEvent);
      }
      const match = url.pathname.match(/^\/routes\/([^/]+)\/?(.*)$/);
      if (!match) return sendJson(response, 404, { error: "Not found" });
      const route = routes.get(decodeURIComponent(match[1]));
      if (!route) return sendJson(response, 404, { error: "Route is disabled or missing" });
      if (route.protocol === "chat_completions") {
        const secret = routeSecrets.get(route.routeId);
        if (!secret) return sendJson(response, 503, { error: "Route credentials are not hydrated" });
        return await proxyCompatibilityRequest(request, response, route, secret, store, history);
      }
      await proxyRequest(request, response, route, `${match[2]}${url.search}`, store);
    } catch (error) {
      if (!response.headersSent) sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      else response.destroy(error instanceof Error ? error : undefined);
    }
  });
  if (options.port !== undefined) {
    await listenOnPort(server, options.port);
  } else if (isValidPort(options.preferredPort)) {
    const savedPort = await readRouterPortState(portStatePath);
    const selectedPort = savedPort?.preferredPort === options.preferredPort
      ? savedPort.selectedPort
      : options.preferredPort;
    const port = await listenOnPreferredPort(server, options.preferredPort, selectedPort);
    await writeFile(portStatePath, JSON.stringify({ preferredPort: options.preferredPort, selectedPort: port }), { mode: 0o600 });
    await chmod(portStatePath, 0o600);
  } else {
    await listenOnPort(server, 0);
  }
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to resolve router port");
  const state: RouterStateFile = { pid: process.pid, port: address.port, adminToken, startedAt: Date.now() };
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
  await chmod(statePath, 0o600);
  closeService = () => {
    if (!closePromise) {
      closePromise = (async () => {
        routeSecrets.clear();
        poolSecrets.clear(); poolTokens.clear();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        await store.close();
        await unlink(statePath).catch(() => undefined);
      })();
    }
    return closePromise;
  };
  return {
    port: address.port, origin: `http://127.0.0.1:${address.port}`, adminToken,
    close: closeService,
  };
}
