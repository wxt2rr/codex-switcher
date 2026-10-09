import { randomBytes, randomUUID } from "node:crypto";
import { appendFile, chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";

import {
  extractTokenUsage,
  type EnvironmentGateway,
  type GatewayRouteRuntimeMetrics,
  type GatewayRouteRuleContext,
  type RouteRuntimeSecret,
  type RouteProtocol,
  type RouteTarget,
  isSafeRouteProxyUrl,
  type UsageFilter,
  type UsageRequestAttempt,
  type UsageRequestQuery,
} from "./usage-routing-model.js";
import { initializeModelRouteEngine, resolveModelRoute } from "./model-router.js";
import { adaptProtocolRequest, adaptProtocolResponse, adaptProtocolSseChunk, applyProtocolCredentialHeaders, detectGatewayProtocol, extractProtocolModel } from "./protocol-adapters.js";
import {
  classifyPoolFailure,
  cooldownForFailure,
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
import { loadGatewayPluginRuntime } from "./core-runtime.js";
import { closeUpstreamProxyAgents, fetchWithOptionalProxy, normalizeUpstreamProxyUrl, resolveUpstreamProxy, type UpstreamProxySource } from "./upstream-proxy.js";

export interface UsageRouterServiceOptions {
  stateDir: string;
  adminToken?: string;
  port?: number;
  preferredPort?: number;
  defaultProxyUrl?: string;
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

interface RuntimeProviderAdapter {
  authorizationHeaders(account: { accountId: string; displayName: string; authMethod: "api_key" | "subscription"; secretRef: string; status: "active" }, secret: string, protocol: RouteProtocol): Headers;
}

interface RuntimePluginManager {
  registry: { has(id: string): boolean; get(id: string): RuntimeProviderAdapter };
  activateInstalled(): Promise<{ failed: Array<{ id: string; message: string }> }>;
  close(): Promise<void>;
}

interface RouteOutcomeTelemetry {
  latencyMs: number;
  estimatedTokens: number;
  attemptIndex: number;
  attemptCount: number;
  outcome: "success" | "retry" | "returned" | "failed";
  failureReason: PoolFailureReason | null;
  errorMessage: string | null;
  errorName?: string | null;
  errorCode?: string | null;
  errorCause?: string | null;
  retryAfterMs: number | null;
  proxySource: UpstreamProxySource;
  upstreamProtocol: RouteProtocol;
}

/** Explicit request metadata used for observability; never contains prompt text or intent. */
interface UsageTelemetryContext {
  logicalModel?: string | null;
  agentId?: string | null;
  ingressProtocol?: RouteProtocol | null;
  routeGroupId?: string | null;
  routeRuleId?: string | null;
}

interface GatewayRouteMetricState extends GatewayRouteRuntimeMetrics {
  windowStartedAt: number;
  requestsInWindow: number;
  tokensInWindow: number;
  latencyMs: number;
}

export const USAGE_ROUTER_API_VERSION = 10;

function isValidPort(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1024 && Number(value) <= 65535;
}

function isValidGatewayRouteRule(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rule = value as Partial<import("./usage-routing-model.js").GatewayRouteRule>;
  const match = rule.match;
  if (typeof rule.id !== "string" || !rule.id.trim() || typeof rule.targetModelId !== "string" || !rule.targetModelId.trim()
    || typeof rule.priority !== "number" || typeof rule.enabled !== "boolean" || !match || typeof match !== "object") return false;
  if (match.tokenCount && (match.tokenCount.min !== undefined && (!Number.isFinite(match.tokenCount.min) || match.tokenCount.min < 0)
    || match.tokenCount.max !== undefined && (!Number.isFinite(match.tokenCount.max) || match.tokenCount.max < 0))) return false;
  for (const values of [match.reasoningProfiles, match.agentIds, match.modelIds, match.providerIds]) {
    if (values !== undefined && (!Array.isArray(values) || values.some((item) => typeof item !== "string" || !item.trim()))) return false;
  }
  if (match.time && (typeof match.time.startHour !== "number" || typeof match.time.endHour !== "number"
    || match.time.startHour < 0 || match.time.startHour > 23 || match.time.endHour < 0 || match.time.endHour > 23
    || match.time.daysOfWeek?.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) return false;
  return true;
}

function isValidEnvironmentGateway(value: unknown): value is EnvironmentGateway {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const gateway = value as Partial<EnvironmentGateway>;
  return typeof gateway.gatewayId === "string" && gateway.gatewayId.trim().length > 0
    && typeof gateway.envName === "string" && gateway.envName.trim().length > 0
    && Array.isArray(gateway.routeIds) && gateway.routeIds.every((routeId) => typeof routeId === "string" && routeId.trim().length > 0)
    && (!gateway.routeGroups || typeof gateway.routeGroups === "object" && !Array.isArray(gateway.routeGroups)
      && Object.values(gateway.routeGroups).every((group) => Boolean(group)
        && typeof group.id === "string" && typeof group.exposedModelId === "string"
        && Array.isArray(group.routeIds) && group.routeIds.every((routeId) => typeof routeId === "string")
        && typeof group.strategy === "string" && typeof group.sessionPolicy === "string"
        && typeof group.fallbackEnabled === "boolean"))
    && (!gateway.quota || Number.isFinite(gateway.quota.windowMinutes) && gateway.quota.windowMinutes > 0
      && (gateway.quota.maxRequests === undefined || Number.isInteger(gateway.quota.maxRequests) && gateway.quota.maxRequests > 0)
      && (gateway.quota.maxTokens === undefined || Number.isInteger(gateway.quota.maxTokens) && gateway.quota.maxTokens > 0))
    && (!gateway.routeRules || Array.isArray(gateway.routeRules) && gateway.routeRules.every(isValidGatewayRouteRule))
    && typeof gateway.enabled === "boolean"
    && typeof gateway.createdAt === "number" && typeof gateway.updatedAt === "number";
}

function rewriteGatewayModel(body: Buffer | undefined, upstreamModel: string | undefined): Buffer | undefined {
  if (!body?.length || !upstreamModel?.trim()) return body;
  try {
    const parsed = JSON.parse(body.toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return body;
    const record = parsed as Record<string, unknown>;
    if (record.model === upstreamModel) return body;
    return Buffer.from(JSON.stringify({ ...record, model: upstreamModel }));
  } catch {
    return body;
  }
}

function normalizeAuthResponsesRequest(
  body: Buffer | undefined,
  route: RouteTarget,
  secret: RouteRuntimeSecret | undefined,
): Buffer | undefined {
  if (!body?.length || route.protocol !== "responses" || secret?.authMode !== "auth") return body;
  try {
    const parsed = JSON.parse(body.toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return body;
    const record = parsed as Record<string, unknown>;
    if (record.store === false) return body;
    return Buffer.from(JSON.stringify({ ...record, store: false }));
  } catch {
    return body;
  }
}

function inferGatewayCapabilities(body: Record<string, unknown> | undefined) {
  if (!body) return undefined;
  const input = body.input;
  const serializedInput = JSON.stringify(input ?? "");
  return {
    tools: Array.isArray(body.tools) && body.tools.length > 0,
    streaming: body.stream === true,
    vision: serializedInput.includes('"image_url"') || serializedInput.includes('"image"'),
    reasoning: typeof body.reasoning === "object" && body.reasoning !== null,
  };
}

function inferGatewayRuleContext(
  request: IncomingMessage,
  body: Record<string, unknown> | undefined,
  requestedModel: string | undefined,
): GatewayRouteRuleContext {
  const serializedBody = body ? JSON.stringify(body) : "";
  const reasoningValue = body?.reasoning;
  const reasoningProfile = typeof body?.reasoning_effort === "string"
    ? body.reasoning_effort
    : typeof body?.thinking === "string" ? body.thinking : undefined;
  const compactedHeader = request.headers["x-codex-context-compacted"]?.toString().trim().toLowerCase();
  return {
    tokenCount: serializedBody ? Math.max(1, Math.ceil(Buffer.byteLength(serializedBody, "utf8") / 4)) : undefined,
    hasImages: serializedBody.includes('"image_url"') || serializedBody.includes('"image"'),
    reasoning: (typeof reasoningValue === "object" && reasoningValue !== null) || typeof body?.thinking === "object",
    reasoningProfile,
    agentId: request.headers["x-codex-agent"]?.toString().trim() || undefined,
    contextCompacted: body?.context_compacted === true || compactedHeader === "1" || compactedHeader === "true",
    now: Date.now(),
    requestedModel,
    providerId: request.headers["x-codex-provider"]?.toString().trim() || undefined,
  };
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

async function writePrivateJsonAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
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

function hasUpgradeIntent(headers: IncomingHttpHeaders): boolean {
  const upgrade = String(headers.upgrade ?? "").trim().toLowerCase();
  if (upgrade === "websocket") return true;
  return String(headers.connection ?? "")
    .split(",")
    .some((value) => value.trim().toLowerCase() === "upgrade");
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
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase()) && name.toLowerCase() !== "content-length") target.setHeader(name, value);
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

// These headers describe the client-to-next-hop connection. Forwarding them
// to an upstream through undici/ProxyAgent can trigger protocol validation
// errors (notably `invalid upgrade header`) and they are not meaningful to the
// provider connection created by the router.
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "http2-settings",
]);

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
  const blocked = new Set(["host", "content-length", ...HOP_BY_HOP_HEADERS]);
  for (const [name, value] of Object.entries(headers)) {
    if (blocked.has(name.toLowerCase()) || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((item) => result.append(name, item));
    else result.set(name, value);
  }
  return result;
}

const BLOCKED_CONFIGURED_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "content-length",
  ...HOP_BY_HOP_HEADERS,
]);

function applyConfiguredRouteHeaders(headers: Headers, configured: Record<string, string> | undefined): void {
  if (!configured) return;
  for (const [name, value] of Object.entries(configured)) {
    const normalized = name.trim().toLowerCase();
    if (!normalized || BLOCKED_CONFIGURED_HEADERS.has(normalized) || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) continue;
    headers.set(name, value);
  }
}

class UsageTap {
  private readonly decoder = new TextDecoder();
  private text = "";
  private sseBuffer = "";
  private latest: ReturnType<typeof extractTokenUsage> = null;
  private firstChunkAt: number | null = null;

  push(chunk: Uint8Array): void {
    if (chunk.byteLength > 0 && this.firstChunkAt === null) this.firstChunkAt = Date.now();
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

  timeToFirstTokenMs(startedAt: number): number | null {
    return this.firstChunkAt === null ? null : Math.max(0, this.firstChunkAt - startedAt);
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

export interface RouterErrorDiagnostics {
  name: string | null;
  message: string | null;
  code: string | null;
  cause: string | null;
}

function errorRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function errorField(value: unknown, field: string): string | null {
  const record = errorRecord(value);
  const fieldValue = record?.[field];
  return typeof fieldValue === "string" && fieldValue.trim() ? fieldValue.trim() : null;
}

/**
 * Keep the complete transport chain useful without persisting request content
 * or credentials. This is intentionally shallow because causes can be cyclic
 * in third-party errors.
 */
export function extractRouterErrorDiagnostics(value: unknown): RouterErrorDiagnostics {
  let current: unknown = value;
  let name: string | null = null;
  let message: string | null = null;
  let code: string | null = null;
  const causes: string[] = [];
  const visited = new Set<unknown>();
  for (let depth = 0; current !== undefined && current !== null && depth < 4; depth += 1) {
    if (typeof current === "object" && visited.has(current)) break;
    if (typeof current === "object") visited.add(current);
    const currentName = errorField(current, "name");
    const currentMessage = current instanceof Error ? current.message : errorField(current, "message")
      ?? (typeof current === "string" ? current : null);
    const currentCode = errorField(current, "code") ?? errorField(current, "errno");
    if (depth === 0) {
      name = currentName;
      message = sanitizeRouterErrorMessage(currentMessage);
      code = sanitizeRouterErrorMessage(currentCode);
    } else {
      const summary = [currentName, currentCode, sanitizeRouterErrorMessage(currentMessage)].filter(Boolean).join(": ");
      if (summary) causes.push(summary);
    }
    const next = errorRecord(current)?.cause;
    if (next === undefined || next === null) break;
    current = next;
  }
  return { name, message, code, cause: causes.length ? sanitizeRouterErrorMessage(causes.join(" <- ")) : null };
}

function proxySourceLabel(source: UpstreamProxySource): string {
  if (source === "route") return "explicit proxy";
  if (source === "global") return "global proxy";
  return "direct connection";
}

function safeUpstreamFailureMessage(error: unknown, source: UpstreamProxySource, fallback: string): string {
  const diagnostics = extractRouterErrorDiagnostics(error);
  const detail = [diagnostics.message ?? fallback, diagnostics.code ? `code=${diagnostics.code}` : null,
    diagnostics.cause ? `cause=${diagnostics.cause}` : null].filter(Boolean).join("; ");
  return `${detail} (${proxySourceLabel(source)})`;
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

async function extractSafeUpstreamResponseError(response: Response, fallback: string): Promise<string | null> {
  if (response.ok) return null;
  try {
    return extractSafeErrorMessage((await response.clone().text()).slice(0, 64 * 1024), fallback);
  } catch {
    return extractSafeErrorMessage("", fallback);
  }
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
  allowedRouteIds?: readonly string[],
  modelOverrides?: ReadonlyMap<string, string>,
  protocolOverrides?: ReadonlyMap<string, RouteProtocol>,
  bodyOverride?: Buffer,
  usageContext?: UsageTelemetryContext,
  defaultProxyUrl?: string,
): Promise<void> {
  const startedAt = Date.now();
  const body = bodyOverride ?? (request.method === "GET" || request.method === "HEAD" ? Buffer.alloc(0) : await readRequestBodyBuffer(request));
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
  let finalRoute: RouteTarget | undefined;
  let finalStatus = 503;
  let finalUsage: ReturnType<typeof extractTokenUsage> = null;
  let finalTimeToFirstTokenMs: number | null = null;
  let finalRetryAfterMs: number | null = null;
  let finalReason: string | null = null;
  let finalErrorMessage: string | null = null;
  let finalResponseId: string | null = null;
  let bindingKeyHash = derived.keyHash;
  let didRelayBytes = false;
  const maxSameAccountFailures = Math.min(3, Math.max(1, pool.maxSameAccountFailures ?? 1));
  const maxAttempts = Math.min(6, Math.max(1, (pool.maxFailoverAttempts + 1) * maxSameAccountFailures));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const health = initialPoolHealth(pool, await store.listPoolHealth(pool.poolId));
    const allowed = allowedRouteIds?.length ? new Set(allowedRouteIds) : undefined;
    const candidateState: PoolDispatchState = {
      pool: { ...pool, members: pool.members.filter((member) => !allowed || allowed.has(member.routeId)).map((member) => (memberAttempts.get(member.accountName) ?? 0) >= maxSameAccountFailures ? { ...member, enabled: false } : member) },
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
      protocol: member.protocol, upstreamModel: member.upstreamModel, proxyUrl: member.proxyUrl, reasoningProfile: "auto" as const,
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
        retryAfterMs: null,
        outcome: attempt + 1 < maxAttempts ? "retry" : "failed" });
      continue;
    }
    attempted.push(member.accountName); finalAccount = member.accountName; finalBaseUrl = route.upstreamBaseUrl;
    const effectiveUpstreamModel = modelOverrides?.get(member.accountName) || route.upstreamModel;
    const effectiveProtocol = protocolOverrides?.get(member.accountName) ?? route.protocol;
    const effectiveRoute = effectiveUpstreamModel && effectiveUpstreamModel !== route.upstreamModel || effectiveProtocol !== route.protocol
      ? { ...route, upstreamModel: effectiveUpstreamModel, protocol: effectiveProtocol }
      : route;
    let candidateBody = rewriteGatewayModel(body, effectiveUpstreamModel) ?? body;
    const candidateParsedBody = candidateBody.length ? parseRequestBody(candidateBody) : parsedBody;
    if (candidateParsedBody && pool.protocol !== effectiveRoute.protocol) {
      candidateBody = Buffer.from(JSON.stringify(adaptProtocolRequest(pool.protocol, effectiveRoute.protocol, candidateParsedBody, effectiveUpstreamModel)));
    }
    const upstreamSuffix = pool.protocol !== effectiveRoute.protocol
      ? mapGatewaySuffix(routeSuffix, pool.protocol, effectiveRoute.protocol, effectiveUpstreamModel)
      : routeSuffix;
    const upstream = `${effectiveRoute.upstreamBaseUrl.replace(/\/+$/, "")}/${upstreamSuffix.replace(/^\/+/, "")}`;
    const headers = forwardedHeaders(request.headers);
    applyConfiguredRouteHeaders(headers, effectiveRoute.requestHeaders);
    applyProtocolCredentialHeaders(headers, effectiveRoute.protocol, {
      upstreamApiKey: secret.upstreamBearerToken,
      authMode: secret.authMode,
      accountId: secret.accountId,
    });
    const proxy = resolveUpstreamProxy(upstream, effectiveRoute.proxyUrl ?? member.proxyUrl, defaultProxyUrl);
    let upstreamResponse: Response;
    try {
      upstreamResponse = pool.protocol === "chat_completions"
        && (effectiveRoute.protocol === "responses" || effectiveRoute.protocol === "chat_completions")
        ? await handleChatCompatibilityRequest({
          route: { ...effectiveRoute, proxyUrl: proxy.url }, secret: { routeId: effectiveRoute.routeId, upstreamApiKey: secret.upstreamBearerToken, localRouteToken, hydratedAt: secret.hydratedAt },
          authorization: `Bearer ${localRouteToken}`, request: candidateParsedBody ?? {}, headers,
          history, signal: AbortSignal.timeout(120_000),
        })
        : await fetchWithOptionalProxy(upstream, {
          method: request.method, headers, body: candidateBody.length ? candidateBody as unknown as BodyInit : undefined, redirect: "manual",
          ...(candidateBody.length ? { duplex: "half" } as RequestInit : {}), signal: AbortSignal.timeout(120_000),
        }, proxy.url);
      if (pool.protocol !== effectiveRoute.protocol && upstreamResponse.body) {
        upstreamResponse = await convertUpstreamResponse(upstreamResponse, effectiveRoute.protocol, pool.protocol);
      }
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
      finalErrorMessage = safeUpstreamFailureMessage(error, proxy.source, "Unable to connect to the selected upstream account");
      const willRetry = attempt + 1 < maxAttempts && isPoolRetryableFailure(reason, null);
      attempts.push({ accountName: member.accountName, startedAt: attemptStartedAt, completedAt: Date.now(),
        httpStatus: null, reason: finalReason, errorMessage: finalErrorMessage, retryAfterMs: null,
        outcome: willRetry ? "retry" : "failed" });
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
        httpStatus: upstreamResponse.status, reason: finalReason, errorMessage,
        retryAfterMs: retryAfterMs(upstreamResponse), outcome: "retry" });
      continue;
    }
    const tap = new UsageTap();
    finalRoute = effectiveRoute;
    try {
      await relayResponse(upstreamResponse, response, { push(chunk) { didRelayBytes = true; tap.push(chunk); } });
      finalUsage = tap.finish(); finalResponseId = tap.responseId(); finalStatus = upstreamResponse.status;
      finalTimeToFirstTokenMs = tap.timeToFirstTokenMs(startedAt);
      finalRetryAfterMs = retryAfterMs(upstreamResponse) ?? null;
      finalErrorMessage = tap.errorSummary(upstreamResponse.status);
      if (!upstreamResponse.ok) finalReason = sanitizePoolFailureReason(reason);
      attempts.push({ accountName: member.accountName, startedAt: attemptStartedAt, completedAt: Date.now(),
        httpStatus: upstreamResponse.status, reason: upstreamResponse.ok ? null : finalReason,
        errorMessage: finalErrorMessage, retryAfterMs: finalRetryAfterMs,
        outcome: upstreamResponse.ok ? "success" : "returned" });
      if (upstreamResponse.ok || retryable || reason === "unauthorized" || reason === "quota") {
        await store.upsertPoolHealth(nextMemberHealth(health.find((item) => item.accountName === member.accountName)!, { ok: upstreamResponse.ok, status: upstreamResponse.status, reason, retryAfterMs: retryAfterMs(upstreamResponse) }, Date.now()));
      }
    } catch (error) {
      didRelayBytes = true;
      finalStatus = 502; finalReason = "stream_interrupted";
      finalErrorMessage = sanitizeRouterErrorMessage(error) ?? "The upstream response stream was interrupted";
      attempts.push({ accountName: member.accountName, startedAt: attemptStartedAt, completedAt: Date.now(),
        httpStatus: 502, reason: finalReason, errorMessage: finalErrorMessage, retryAfterMs: null, outcome: "failed" });
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
    reasoningTokens: finalUsage?.reasoningTokens ?? null,
    cacheCreationTokens: finalUsage?.cacheCreationTokens ?? null, cacheReadTokens: finalUsage?.cacheReadTokens ?? null,
    totalTokens: finalUsage?.totalTokens ?? null, httpStatus: finalStatus, latencyMs: completedAt - startedAt,
    actualCost: null, standardCost: null, poolId: pool.poolId, entryAccountName: entryAccountName ?? null,
    attemptedAccounts: attempted, attemptCount: attempted.length, failoverReason: attempted.length > 1 ? finalReason : null,
    sessionKeyHash: bindingKeyHash, errorMessage: finalErrorMessage, attempts,
    logicalModel: usageContext?.logicalModel ?? (typeof parsedBody?.model === "string" ? parsedBody.model : null),
    servedModel: finalUsage?.model ?? finalRoute?.upstreamModel ?? null,
    providerId: finalRoute?.providerId ?? null, credentialId: finalRoute?.routeId ?? null,
    agentId: usageContext?.agentId ?? (request.headers["x-codex-agent"]?.toString().trim() || null),
    ingressProtocol: usageContext?.ingressProtocol ?? pool.protocol,
    upstreamProtocol: finalRoute?.protocol ?? pool.protocol,
    routeGroupId: usageContext?.routeGroupId ?? finalRoute?.routeGroupId ?? null,
    routeRuleId: usageContext?.routeRuleId ?? null,
    timeToFirstTokenMs: finalTimeToFirstTokenMs, retryAfterMs: finalRetryAfterMs,
    finalCandidate: finalRoute?.routeId ?? null,
    failureType: finalStatus >= 400 ? sanitizePoolFailureReason(classifyPoolFailure(finalStatus)) : null,
  });
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
  secret?: RouteRuntimeSecret,
  bodyOverride?: Buffer,
  fallbackRoutes: RouteTarget[] = [],
  resolveSecret?: (route: RouteTarget) => RouteRuntimeSecret | undefined,
  onOutcome?: (route: RouteTarget, success: boolean, status: number | null, telemetry: RouteOutcomeTelemetry) => void,
  incomingProtocol?: RouteProtocol,
  incomingModel?: string,
  resolveProviderAdapter?: (providerId: string | undefined) => RuntimeProviderAdapter | undefined,
  usageContext?: UsageTelemetryContext,
  defaultProxyUrl?: string,
): Promise<void> {
  const startedAt = Date.now();
  const candidates = [route, ...fallbackRoutes.filter((candidate) => candidate.routeId !== route.routeId)];
  let selectedRoute = route;
  let upstreamResponse: Response | undefined;
  let lastRetryableResponse: { status: number; headers: Headers; body: Buffer; retryAfterMs: number | null } | undefined;
  let lastRetryableRoute: RouteTarget | undefined;
  let lastError: unknown;
  const attempts: UsageRequestAttempt[] = [];
  const requiresAuthResponsesBody = candidates.some((candidate) => {
    if (candidate.protocol !== "responses") return false;
    const candidateSecret = resolveSecret?.(candidate) ?? (candidate.routeId === route.routeId ? secret : undefined);
    return candidateSecret?.authMode === "auth";
  });
  const requestBody = bodyOverride ?? (requiresAuthResponsesBody && request.method !== "GET" && request.method !== "HEAD"
    ? await readRequestBodyBuffer(request)
    : undefined);
  for (const [index, candidate] of candidates.entries()) {
    selectedRoute = candidate;
    const candidateSecret = resolveSecret?.(candidate) ?? (candidate.routeId === route.routeId ? secret : undefined);
    let candidateBody = rewriteGatewayModel(requestBody, candidate.upstreamModel);
    candidateBody = normalizeAuthResponsesRequest(candidateBody, candidate, candidateSecret);
    if (candidateBody && incomingProtocol && candidate.protocol !== incomingProtocol) {
      const parsed = parseRequestBody(candidateBody);
      if (parsed) {
        candidateBody = Buffer.from(JSON.stringify(adaptProtocolRequest(incomingProtocol, candidate.protocol, parsed, candidate.upstreamModel ?? incomingModel)));
      }
    }
    const hasBody = candidateBody ? candidateBody.length > 0 : request.method !== "GET" && request.method !== "HEAD";
    const estimatedTokens = candidateBody?.length ? Math.max(1, Math.ceil(candidateBody.length / 4)) : 1;
    const attemptStartedAt = Date.now();
    const upstreamSuffix = incomingProtocol ? mapGatewaySuffix(routeSuffix, incomingProtocol, candidate.protocol, candidate.upstreamModel ?? incomingModel) : routeSuffix;
    const upstream = `${candidate.upstreamBaseUrl.replace(/\/+$/, "")}/${upstreamSuffix.replace(/^\/+/, "")}`;
    const proxy = resolveUpstreamProxy(upstream, candidate.proxyUrl, defaultProxyUrl);
    try {
      const headers = forwardedHeaders(request.headers);
      applyConfiguredRouteHeaders(headers, candidate.requestHeaders);
      const providerAdapter = resolveProviderAdapter?.(candidate.providerId);
      if (providerAdapter && candidateSecret) {
        const account = {
          accountId: candidateSecret.accountId ?? candidate.accountName,
          displayName: candidate.accountName,
          authMethod: candidateSecret.authMode === "auth" ? "subscription" as const : "api_key" as const,
          secretRef: `route/${candidate.routeId}`,
          status: "active" as const,
        };
        for (const [name, value] of providerAdapter.authorizationHeaders(account, candidateSecret.upstreamApiKey, candidate.protocol).entries()) headers.set(name, value);
      } else {
        applyProtocolCredentialHeaders(headers, candidate.protocol, candidateSecret);
      }
      const response = await fetchWithOptionalProxy(upstream, {
        method: request.method,
        headers,
        body: hasBody
          ? candidateBody ? candidateBody.toString("utf8") : (Readable.toWeb(request) as ReadableStream<Uint8Array>)
          : undefined,
        redirect: "manual",
        ...(hasBody ? { duplex: "half" } as RequestInit : {}),
      }, proxy.url);
      const convertedResponse = incomingProtocol && candidate.protocol !== incomingProtocol
        ? await convertUpstreamResponse(response, candidate.protocol, incomingProtocol)
        : response;
      const responseReason = classifyPoolFailure(convertedResponse.status);
      const responseRetryAfterMs = retryAfterMs(convertedResponse) ?? null;
      if (!convertedResponse.ok && index < candidates.length - 1
        && isPoolRetryableFailure(responseReason, convertedResponse.status)) {
        const body = Buffer.from(await convertedResponse.arrayBuffer());
        const errorMessage = extractSafeErrorMessage(body.toString("utf8"), `Upstream returned HTTP ${convertedResponse.status}`);
        onOutcome?.(candidate, false, convertedResponse.status, {
          latencyMs: Date.now() - attemptStartedAt, estimatedTokens,
          attemptIndex: index + 1, attemptCount: candidates.length, outcome: "retry",
          failureReason: responseReason, errorMessage, retryAfterMs: responseRetryAfterMs,
          proxySource: proxy.source, upstreamProtocol: candidate.protocol,
        });
        attempts.push({
          accountName: candidate.accountName, startedAt: attemptStartedAt, completedAt: Date.now(),
          httpStatus: convertedResponse.status, reason: responseReason, errorMessage,
          retryAfterMs: responseRetryAfterMs, outcome: "retry",
        });
        lastRetryableResponse = {
          status: convertedResponse.status,
          headers: new Headers(convertedResponse.headers),
          body,
          retryAfterMs: responseRetryAfterMs,
        };
        lastRetryableRoute = candidate;
        continue;
      }
      const errorMessage = await extractSafeUpstreamResponseError(convertedResponse, `Upstream returned HTTP ${convertedResponse.status}`);
      onOutcome?.(candidate, convertedResponse.ok, convertedResponse.status, {
        latencyMs: Date.now() - attemptStartedAt, estimatedTokens,
        attemptIndex: index + 1, attemptCount: candidates.length,
        outcome: convertedResponse.ok ? "success" : "returned",
        failureReason: convertedResponse.ok ? null : responseReason,
        errorMessage, retryAfterMs: responseRetryAfterMs,
        proxySource: proxy.source, upstreamProtocol: candidate.protocol,
      });
      upstreamResponse = convertedResponse;
      attempts.push({
        accountName: candidate.accountName, startedAt: attemptStartedAt, completedAt: Date.now(),
        httpStatus: convertedResponse.status, reason: convertedResponse.ok ? null : responseReason,
        errorMessage, retryAfterMs: responseRetryAfterMs,
        outcome: convertedResponse.ok ? "success" : "returned",
      });
      break;
    } catch (error) {
      const failureReason = classifyPoolFailure(null, error);
      const errorMessage = safeUpstreamFailureMessage(error, proxy.source, "Unable to connect to upstream");
      const diagnostics = extractRouterErrorDiagnostics(error);
      onOutcome?.(candidate, false, null, {
        latencyMs: Date.now() - attemptStartedAt, estimatedTokens,
        attemptIndex: index + 1, attemptCount: candidates.length,
        outcome: index < candidates.length - 1 ? "retry" : "failed",
        failureReason, errorMessage, retryAfterMs: null,
        errorName: diagnostics.name, errorCode: diagnostics.code, errorCause: diagnostics.cause,
        proxySource: proxy.source, upstreamProtocol: candidate.protocol,
      });
      lastError = error;
      attempts.push({
        accountName: candidate.accountName, startedAt: attemptStartedAt, completedAt: Date.now(),
        httpStatus: null, reason: failureReason,
        errorMessage, retryAfterMs: null,
        outcome: index < candidates.length - 1 ? "retry" : "failed",
      });
      if (index < candidates.length - 1) continue;
    }
  }
  if (!upstreamResponse && lastRetryableResponse) {
    if (lastRetryableRoute) selectedRoute = lastRetryableRoute;
    upstreamResponse = new Response(lastRetryableResponse.body.toString("utf8"), {
      status: lastRetryableResponse.status,
      headers: lastRetryableResponse.headers,
    });
    const finalAttempt = attempts.at(-1);
    if (finalAttempt && finalAttempt.httpStatus === lastRetryableResponse.status) finalAttempt.outcome = "returned";
  }
  if (!upstreamResponse) {
    const errorMessage = safeUpstreamFailureMessage(lastError, resolveUpstreamProxy(
      `${selectedRoute.upstreamBaseUrl.replace(/\/+$/, "")}/${routeSuffix.replace(/^\/+/, "")}`,
      selectedRoute.proxyUrl,
      defaultProxyUrl,
    ).source, "Unable to connect to upstream");
    sendJson(response, 502, { error: errorMessage });
    const completedAt = Date.now();
    await store.recordUsage({
      requestId: randomUUID(), routeId: selectedRoute.routeId, startedAt, completedAt,
      envName: selectedRoute.envName, accountName: selectedRoute.accountName, upstreamBaseUrl: selectedRoute.upstreamBaseUrl,
      endpoint: `/${routeSuffix.replace(/^\/+/, "")}`, model: null, inputTokens: null, outputTokens: null,
      cacheCreationTokens: null, cacheReadTokens: null, totalTokens: null, httpStatus: 502,
      latencyMs: completedAt - startedAt, actualCost: null, standardCost: null, errorMessage,
      logicalModel: usageContext?.logicalModel ?? incomingModel ?? null,
      servedModel: selectedRoute.upstreamModel ?? null,
      providerId: selectedRoute.providerId ?? null, credentialId: selectedRoute.routeId,
      agentId: usageContext?.agentId ?? (request.headers["x-codex-agent"]?.toString().trim() || null),
      ingressProtocol: usageContext?.ingressProtocol ?? incomingProtocol ?? selectedRoute.protocol,
      upstreamProtocol: selectedRoute.protocol, routeGroupId: usageContext?.routeGroupId ?? selectedRoute.routeGroupId ?? null,
      routeRuleId: usageContext?.routeRuleId ?? null, timeToFirstTokenMs: null,
      retryAfterMs: lastRetryableResponse?.retryAfterMs ?? null, finalCandidate: selectedRoute.routeId,
      failureType: "network",
      attempts, attemptCount: attempts.length, attemptedAccounts: [...new Set(attempts.map((attempt) => attempt.accountName))],
    });
    return;
  }

  const tap = new UsageTap();
  await relayResponse(upstreamResponse, response, tap);
  const completedAt = Date.now();
  const usage = tap.finish();
  const finalErrorMessage = tap.errorSummary(upstreamResponse.status);
  await store.recordUsage({
    requestId: randomUUID(), routeId: selectedRoute.routeId, startedAt, completedAt,
    envName: selectedRoute.envName, accountName: selectedRoute.accountName, upstreamBaseUrl: selectedRoute.upstreamBaseUrl,
    endpoint: `/${routeSuffix.replace(/^\/+/, "")}`, model: usage?.model ?? null,
    inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null,
    reasoningTokens: usage?.reasoningTokens ?? null,
    cacheCreationTokens: usage?.cacheCreationTokens ?? null, cacheReadTokens: usage?.cacheReadTokens ?? null,
    totalTokens: usage?.totalTokens ?? null, httpStatus: upstreamResponse.status,
    latencyMs: completedAt - startedAt, actualCost: null, standardCost: null,
    errorMessage: finalErrorMessage,
    logicalModel: usageContext?.logicalModel ?? incomingModel ?? null,
    servedModel: usage?.model ?? selectedRoute.upstreamModel ?? null,
    providerId: selectedRoute.providerId ?? null, credentialId: selectedRoute.routeId,
    agentId: usageContext?.agentId ?? (request.headers["x-codex-agent"]?.toString().trim() || null),
    ingressProtocol: usageContext?.ingressProtocol ?? incomingProtocol ?? selectedRoute.protocol,
    upstreamProtocol: selectedRoute.protocol, routeGroupId: usageContext?.routeGroupId ?? selectedRoute.routeGroupId ?? null,
    routeRuleId: usageContext?.routeRuleId ?? null, timeToFirstTokenMs: tap.timeToFirstTokenMs(startedAt),
    retryAfterMs: retryAfterMs(upstreamResponse) ?? null, finalCandidate: selectedRoute.routeId,
    failureType: upstreamResponse.status >= 400 ? sanitizePoolFailureReason(classifyPoolFailure(upstreamResponse.status)) : null,
    attempts, attemptCount: attempts.length, attemptedAccounts: [...new Set(attempts.map((attempt) => attempt.accountName))],
  });
}

function mapGatewaySuffix(routeSuffix: string, incoming: RouteProtocol, target: RouteProtocol, model?: string): string {
  if (incoming === target) return routeSuffix;
  if (target === "anthropic") return "messages";
  if (target === "chat_completions") return "chat/completions";
  if (target === "gemini") {
    const geminiModel = model?.trim() || extractProtocolModel("gemini", routeSuffix) || "gemini-2.5-flash";
    return `v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`;
  }
  return "responses";
}

async function convertUpstreamResponse(response: Response, source: RouteProtocol, target: RouteProtocol): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.body) return response;
  if (contentType.includes("text/event-stream")) {
    const raw = await response.text();
    const converted = adaptProtocolSseChunk(source, target, raw);
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(converted, { status: response.status, headers });
  }
  if (!contentType.includes("json")) return response;
  try {
    const body = JSON.parse(await response.text()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) return response;
    const converted = adaptProtocolResponse(source, target, body as Record<string, unknown>);
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(JSON.stringify(converted), { status: response.status, headers });
  } catch {
    return response;
  }
}

async function proxyCompatibilityRequest(
  request: IncomingMessage,
  response: ServerResponse,
  route: RouteTarget,
  secret: RouteRuntimeSecret,
  store: UsageStore,
  history: ConversationHistoryStore,
  usageContext?: UsageTelemetryContext,
  defaultProxyUrl?: string,
): Promise<void> {
  const startedAt = Date.now();
  let status = 500;
  let errorMessage: string | null = null;
  const tap = new UsageTap();
  let requestBody: Record<string, unknown> = {};
  try {
    requestBody = await readJson(request, 32 * 1024 * 1024) as Record<string, unknown>;
    const headers = forwardedHeaders(request.headers);
    applyConfiguredRouteHeaders(headers, route.requestHeaders);
    const upstream = `${route.upstreamBaseUrl.replace(/\/+$/, "")}/responses`;
    const proxy = resolveUpstreamProxy(upstream, route.proxyUrl, defaultProxyUrl);
    const result = await handleChatCompatibilityRequest({
      route: { ...route, proxyUrl: proxy.url }, secret, authorization: request.headers.authorization, request: requestBody,
      headers, history,
    });
    status = result.status;
    await relayResponse(result, response, tap);
  } catch (error) {
    status = typeof (error as { status?: unknown }).status === "number" ? Number((error as { status: number }).status) : 500;
    errorMessage = safeUpstreamFailureMessage(error, resolveUpstreamProxy(
      `${route.upstreamBaseUrl.replace(/\/+$/, "")}/responses`, route.proxyUrl, defaultProxyUrl,
    ).source, "Compatibility routing failed");
    sendJson(response, status, { error: { message: errorMessage } });
  }
  const completedAt = Date.now();
  const usage = tap.finish();
  const finalErrorMessage = errorMessage ?? tap.errorSummary(status);
  const requestModel = typeof requestBody?.model === "string" ? requestBody.model : null;
  await store.recordUsage({ requestId: randomUUID(), routeId: route.routeId, startedAt, completedAt,
    envName: route.envName, accountName: route.accountName, upstreamBaseUrl: route.upstreamBaseUrl,
    endpoint: "/responses", model: usage?.model ?? null, inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null, reasoningTokens: usage?.reasoningTokens ?? null,
    cacheCreationTokens: usage?.cacheCreationTokens ?? null,
    cacheReadTokens: usage?.cacheReadTokens ?? null, totalTokens: usage?.totalTokens ?? null,
    httpStatus: status, latencyMs: completedAt - startedAt, actualCost: null, standardCost: null,
    errorMessage: finalErrorMessage,
    logicalModel: usageContext?.logicalModel ?? requestModel,
    servedModel: usage?.model ?? route.upstreamModel ?? null,
    providerId: route.providerId ?? null, credentialId: route.routeId,
    agentId: usageContext?.agentId ?? (request.headers["x-codex-agent"]?.toString().trim() || null),
    ingressProtocol: usageContext?.ingressProtocol ?? route.protocol,
    upstreamProtocol: route.protocol, routeGroupId: usageContext?.routeGroupId ?? route.routeGroupId ?? null,
    routeRuleId: usageContext?.routeRuleId ?? null, timeToFirstTokenMs: tap.timeToFirstTokenMs(startedAt),
    retryAfterMs: null, finalCandidate: route.routeId,
    failureType: status >= 400 ? sanitizePoolFailureReason(classifyPoolFailure(status)) : null,
    attempts: [{ accountName: route.accountName, startedAt, completedAt, httpStatus: status,
      reason: status >= 400 ? sanitizePoolFailureReason(classifyPoolFailure(status)) : null,
      errorMessage: finalErrorMessage, retryAfterMs: null, outcome: status >= 400 ? "returned" : "success" }],
    attemptCount: 1, attemptedAccounts: [route.accountName],
  });
}

export async function startUsageRouterService(options: UsageRouterServiceOptions): Promise<RunningUsageRouterService> {
  await mkdir(options.stateDir, { recursive: true });
  // Prefer the shared framework-agnostic route engine in the real desktop
  // service.  The local resolver remains as a test/development fallback when
  // a package artifact is unavailable.
  await initializeModelRouteEngine();
  let pluginManager: RuntimePluginManager | undefined;
  try {
    const pluginRuntime = await loadGatewayPluginRuntime();
    const candidate = new pluginRuntime.ProviderPluginManager({
      rootDir: join(options.stateDir, "provider-plugins"),
      log: (line: string) => console.warn(`[provider-plugin] ${line}`),
    }) as RuntimePluginManager;
    const activation = await candidate.activateInstalled();
    for (const failure of activation.failed) console.warn(`[provider-plugin] ${failure.id}: ${failure.message}`);
    pluginManager = candidate;
  } catch (error) {
    // A missing OS sandbox or a malformed installed plugin must not take down
    // manual account switching or the built-in Gateway routes.
    console.warn(`[provider-plugin] runtime unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const store = await createUsageStore(join(options.stateDir, "usage.db"));
  const adminToken = options.adminToken ?? randomBytes(32).toString("hex");
  const routes = new Map((await store.listRoutes()).filter((route) => route.enabled).map((route) => [route.routeId, route]));
  const pools = new Map((await store.listPools()).filter((pool) => pool.enabled).map((pool) => [pool.poolId, pool]));
  const gateways = new Map((await store.listGateways()).filter((gateway) => gateway.enabled).map((gateway) => [gateway.gatewayId, gateway]));
  const gatewayHealth = new Map<string, { consecutiveFailures: number; cooldownUntil: number | null }>();
  const gatewayRouteMetrics = new Map<string, GatewayRouteMetricState>();
  const gatewayQuotaState = new Map<string, { windowStartedAt: number; requests: number; tokens: number }>();
  const consumeGatewayQuota = (gateway: EnvironmentGateway, estimatedTokens: number): boolean => {
    if (!gateway.quota) return true;
    const now = Date.now();
    const windowMs = gateway.quota.windowMinutes * 60_000;
    const previous = gatewayQuotaState.get(gateway.gatewayId);
    const state = !previous || now - previous.windowStartedAt >= windowMs
      ? { windowStartedAt: now, requests: 0, tokens: 0 }
      : previous;
    if (gateway.quota.maxRequests !== undefined && state.requests >= gateway.quota.maxRequests) return false;
    if (gateway.quota.maxTokens !== undefined && state.tokens + estimatedTokens > gateway.quota.maxTokens) return false;
    state.requests += 1;
    state.tokens += estimatedTokens;
    gatewayQuotaState.set(gateway.gatewayId, state);
    return true;
  };
  const gatewayRouteAvailable = (gateway: EnvironmentGateway, route: RouteTarget): boolean => {
    const health = gatewayHealth.get(gatewayRouteMetricKey(gateway, route.routeId));
    return !health || health.cooldownUntil === null || health.cooldownUntil <= Date.now();
  };
  const gatewayRouteMetricKey = (gateway: EnvironmentGateway, routeId: string): string => `${gateway.gatewayId}:${routeId}`;
  const routeMetricWindowMs = (gateway: EnvironmentGateway): number => Math.max(60_000, (gateway.quota?.windowMinutes ?? 60) * 60_000);
  const getGatewayRouteMetric = (gateway: EnvironmentGateway, routeId: string, now = Date.now()): GatewayRouteMetricState => {
    const key = gatewayRouteMetricKey(gateway, routeId);
    const existing = gatewayRouteMetrics.get(key);
    const windowMs = routeMetricWindowMs(gateway);
    if (existing && now - existing.windowStartedAt < windowMs) return existing;
    const fresh: GatewayRouteMetricState = {
      windowStartedAt: now, requestsInWindow: 0, tokensInWindow: 0, latencyMs: 0,
      resetAt: now + windowMs,
    };
    gatewayRouteMetrics.set(key, fresh);
    return fresh;
  };
  const snapshotGatewayRouteMetrics = (gateway: EnvironmentGateway): Readonly<Record<string, GatewayRouteRuntimeMetrics>> => {
    const now = Date.now();
    return Object.fromEntries(gateway.routeIds.map((routeId) => {
      const metric = getGatewayRouteMetric(gateway, routeId, now);
      return [routeId, {
        requestsInWindow: metric.requestsInWindow,
        tokensInWindow: metric.tokensInWindow,
        latencyMs: metric.latencyMs,
        resetAt: metric.resetAt,
      }];
    }));
  };
  const recordGatewayRouteOutcome = (
    gateway: EnvironmentGateway,
    route: RouteTarget,
    success: boolean,
    status: number | null,
    telemetry: RouteOutcomeTelemetry,
  ): void => {
    const metric = getGatewayRouteMetric(gateway, route.routeId);
    const previousRequests = metric.requestsInWindow;
    metric.requestsInWindow += 1;
    metric.tokensInWindow += telemetry.estimatedTokens;
    metric.latencyMs = previousRequests === 0
      ? telemetry.latencyMs
      : ((metric.latencyMs * previousRequests) + telemetry.latencyMs) / metric.requestsInWindow;
    if (success) {
      gatewayHealth.delete(gatewayRouteMetricKey(gateway, route.routeId));
      return;
    }
    if (!isPoolRetryableFailure(classifyPoolFailure(status), status)) return;
    const healthKey = gatewayRouteMetricKey(gateway, route.routeId);
    const previous = gatewayHealth.get(healthKey) ?? { consecutiveFailures: 0, cooldownUntil: null };
    const failures = previous.consecutiveFailures + 1;
    gatewayHealth.set(healthKey, {
      consecutiveFailures: failures,
      cooldownUntil: cooldownForFailure(failures),
    });
  };
  const poolSecrets = new Map<string, Map<string, PoolRuntimeSecret>>();
  const poolTokens = new Map<string, string>();
  const routeSecrets = new RouteSecretStore();
  let defaultProxyUrl = options.defaultProxyUrl ? normalizeUpstreamProxyUrl(options.defaultProxyUrl) : undefined;
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
        if (url.pathname === "/admin/proxy" && request.method === "PUT") {
          const payload = await readJson(request) as { proxyUrl?: unknown };
          const previousProxyUrl = defaultProxyUrl;
          if (payload.proxyUrl === undefined || payload.proxyUrl === null || payload.proxyUrl === "") {
            defaultProxyUrl = undefined;
          } else if (typeof payload.proxyUrl !== "string") {
            return sendJson(response, 400, { error: "Invalid default proxy URL" });
          } else {
            try {
              defaultProxyUrl = normalizeUpstreamProxyUrl(payload.proxyUrl);
            } catch (error) {
              return sendJson(response, 400, { error: error instanceof Error ? error.message : "Invalid default proxy URL" });
            }
          }
          if (previousProxyUrl !== defaultProxyUrl) {
            await closeUpstreamProxyAgents();
            gatewayHealth.clear();
          }
          response.statusCode = 204;
          return response.end();
        }
        if (url.pathname === "/admin/trace" && request.method === "GET") {
          const fromValue = url.searchParams.get("from");
          const toValue = url.searchParams.get("to");
          const from = fromValue === null ? undefined : Number(fromValue);
          const to = toValue === null ? undefined : Number(toValue);
          const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));
          const eventName = url.searchParams.get("event") || undefined;
          const envName = url.searchParams.get("envName") || undefined;
          const gatewayId = url.searchParams.get("gatewayId") || undefined;
          const routeId = url.searchParams.get("routeId") || undefined;
          const events: Array<Record<string, unknown>> = [];
          for (const path of [`${eventLogPath}.1`, eventLogPath]) {
            const raw = await readFile(path, "utf8").catch(() => "");
            for (const line of raw.split("\n")) {
              if (!line.trim()) continue;
              try {
                const value = JSON.parse(line) as Record<string, unknown>;
                const at = typeof value.at === "number" ? value.at : 0;
                if (from !== undefined && Number.isFinite(from) && at < from) continue;
                if (to !== undefined && Number.isFinite(to) && at > to) continue;
                if (eventName && value.event !== eventName) continue;
                if (envName && value.envName !== envName) continue;
                if (gatewayId && value.gatewayId !== gatewayId) continue;
                if (routeId && value.routeId !== routeId) continue;
                events.push(value);
              } catch {
                // Ignore a partial final JSONL line during an active write.
              }
            }
          }
          events.sort((left, right) => Number(right.at ?? 0) - Number(left.at ?? 0));
          return sendJson(response, 200, events.slice(0, limit));
        }
        if (url.pathname === "/admin/routes" && request.method === "GET") {
          return sendJson(response, 200, await store.listRoutes());
        }
        if (url.pathname === "/admin/gateways" && request.method === "GET") {
          return sendJson(response, 200, await store.listGateways());
        }
        if (url.pathname === "/admin/gateways" && request.method === "PUT") {
          const gateway = await readJson(request) as EnvironmentGateway;
          if (!isValidEnvironmentGateway(gateway) || gateway.routeIds.length === 0
            || gateway.defaultRouteId && !gateway.routeIds.includes(gateway.defaultRouteId)
            || gateway.poolId && !pools.has(gateway.poolId)) {
            return sendJson(response, 400, { error: "Invalid environment gateway" });
          }
          const missingRoute = gateway.routeIds.some((routeId) => !routes.has(routeId));
          if (missingRoute) return sendJson(response, 400, { error: "Gateway route is missing" });
          await store.upsertGateway(gateway);
          if (gateway.enabled) gateways.set(gateway.gatewayId, gateway);
          else gateways.delete(gateway.gatewayId);
          response.statusCode = 204; return response.end();
        }
        const gatewayHealthMatch = url.pathname.match(/^\/admin\/gateways\/([^/]+)\/health$/);
        if (gatewayHealthMatch && request.method === "GET") {
          const gateway = gateways.get(decodeURIComponent(gatewayHealthMatch[1]));
          if (!gateway) return sendJson(response, 404, { error: "Gateway is disabled or missing" });
          const now = Date.now();
          return sendJson(response, 200, gateway.routeIds.map((routeId) => {
            const health = gatewayHealth.get(gatewayRouteMetricKey(gateway, routeId));
            return {
              routeId,
              state: health && health.cooldownUntil !== null && health.cooldownUntil > now ? "cooldown" : "healthy",
              consecutiveFailures: health?.consecutiveFailures ?? 0,
              cooldownUntil: health?.cooldownUntil ?? null,
            };
          }));
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
              && (member.proxyUrl === undefined || isSafeRouteProxyUrl(member.proxyUrl))
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
            authMode: payload.authMode === "auth" ? "auth" : "apikey",
            accountId: typeof payload.accountId === "string" && payload.accountId.trim() ? payload.accountId.trim() : undefined,
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
          if (route.proxyUrl !== undefined && !isSafeRouteProxyUrl(route.proxyUrl)) return sendJson(response, 400, { error: "Invalid route proxy URL" });
          await store.upsertRoute(route);
          if (route.enabled) routes.set(route.routeId, route); else routes.delete(route.routeId);
          response.statusCode = 204; return response.end();
        }
        if (routeMatch && request.method === "DELETE") {
          const routeId = decodeURIComponent(routeMatch[1]);
          routes.delete(routeId); routeSecrets.delete(routeId); history.invalidateRoute(routeId); await store.removeRoute(routeId);
          response.statusCode = 204; return response.end();
        }
        const gatewayDeleteMatch = url.pathname.match(/^\/admin\/gateways\/([^/]+)$/);
        if (gatewayDeleteMatch && request.method === "DELETE") {
          const gatewayId = decodeURIComponent(gatewayDeleteMatch[1]);
          gateways.delete(gatewayId);
          await store.removeGateway(gatewayId);
          response.statusCode = 204; return response.end();
        }
        return sendJson(response, 404, { error: "Not found" });
      }
      const gatewayMatch = url.pathname.match(/^\/gateways\/([^/]+)\/?(.*)$/);
      if (gatewayMatch) {
        const gatewayId = decodeURIComponent(gatewayMatch[1]);
        const gateway = gateways.get(gatewayId);
        if (!gateway) return sendJson(response, 404, { error: "Gateway is disabled or missing" });
        const gatewayRouteSuffix = gatewayMatch[2] || "responses";
        const gatewayProtocol = detectGatewayProtocol(gatewayRouteSuffix);
        const gatewayRequestId = randomUUID();
        const upgradeRequested = hasUpgradeIntent(request.headers);
        const requestMethod = (request.method ?? "GET").toUpperCase();
        if (gatewayProtocol === "responses" && (requestMethod !== "POST" || upgradeRequested)) {
          const rejectionCode = upgradeRequested ? "GATEWAY_WEBSOCKET_UNSUPPORTED" : "GATEWAY_HTTP_ONLY";
          void recordPoolEvent({
            event: "gateway_request_rejected",
            at: Date.now(),
            requestId: gatewayRequestId,
            gatewayId,
            envName: gateway.envName,
            protocol: gatewayProtocol,
            method: requestMethod,
            requestedModel: null,
            hasUpgrade: upgradeRequested,
            rejectionCode,
            failureReason: "protocol_mismatch",
            errorMessage: upgradeRequested
              ? "Gateway Responses endpoint does not support WebSocket transport"
              : "Gateway Responses endpoint only accepts HTTP POST requests",
          });
          response.setHeader("allow", "POST");
          return sendJson(response, 405, {
            error: upgradeRequested
              ? "Gateway Responses endpoint only supports HTTP POST/SSE; WebSocket transport is disabled"
              : "Gateway Responses endpoint only accepts HTTP POST requests",
            code: rejectionCode,
            requestId: gatewayRequestId,
          });
        }
        let bodyOverride: Buffer | undefined;
        if (requestMethod !== "GET" && requestMethod !== "HEAD") {
          bodyOverride = await readRequestBodyBuffer(request);
        }
        const parsedGatewayBody = bodyOverride?.length ? parseRequestBody(bodyOverride) : undefined;
        const requestedModel = extractProtocolModel(gatewayProtocol, gatewayRouteSuffix, parsedGatewayBody);
        const gatewayRoutes = gateway.routeIds
          .map((routeId) => routes.get(routeId))
          .filter((route): route is RouteTarget => route !== undefined);
        const availableGatewayRoutes = gatewayRoutes.filter((route) => gatewayRouteAvailable(gateway, route));
        const resolverCandidateRoutes = availableGatewayRoutes.filter((route) => route.enabled && route.envName === gateway.envName);
        const routeResult = resolveModelRoute(
          availableGatewayRoutes,
          {
            gatewayId,
            envName: gateway.envName,
            protocol: gatewayProtocol,
            allowProtocolConversion: true,
            routeMetrics: snapshotGatewayRouteMetrics(gateway),
            routeRules: gateway.routeRules,
            ruleContext: inferGatewayRuleContext(request, parsedGatewayBody, requestedModel),
            requestedModel,
            requestedAccountName: request.headers["x-codex-account"]?.toString().trim() || undefined,
            sessionKey: request.headers["x-codex-session"]?.toString().trim() || undefined,
            requiredCapabilities: inferGatewayCapabilities(parsedGatewayBody),
          },
          gateway.defaultRouteId,
          gateway.routeGroups,
        );
        if ("code" in routeResult) {
          const persistedRoutes = await store.listRoutes().catch(() => [] as RouteTarget[]);
          const persistedRoutesById = new Map(persistedRoutes.map((route) => [route.routeId, route]));
          const routeDiagnostics = gateway.routeIds.map((routeId) => {
            const loadedRoute = routes.get(routeId);
            const persistedRoute = persistedRoutesById.get(routeId);
            const health = gatewayHealth.get(gatewayRouteMetricKey(gateway, routeId));
            return {
              routeId,
              accountName: persistedRoute?.accountName ?? loadedRoute?.accountName ?? null,
              envName: persistedRoute?.envName ?? loadedRoute?.envName ?? null,
              protocol: persistedRoute?.protocol ?? loadedRoute?.protocol ?? null,
              enabled: persistedRoute?.enabled ?? loadedRoute?.enabled ?? false,
              loaded: Boolean(loadedRoute),
              available: Boolean(loadedRoute && gatewayRouteAvailable(gateway, loadedRoute)),
              cooldownUntil: health?.cooldownUntil ?? null,
            };
          });
          void recordPoolEvent({
            event: "gateway_route_resolution_failed",
            at: Date.now(),
            requestId: gatewayRequestId,
            gatewayId,
            envName: gateway.envName,
            protocol: gatewayProtocol,
            requestedModel: requestedModel ?? null,
            requestedAccountName: request.headers["x-codex-account"]?.toString().trim() || null,
            requiredCapabilities: inferGatewayCapabilities(parsedGatewayBody),
            failureCode: routeResult.code,
            failureMessage: routeResult.message,
            failureStage: resolverCandidateRoutes.length === 0 ? "route_filter" : "model_or_capability_filter",
            configuredRouteIds: gateway.routeIds,
            loadedRouteIds: gatewayRoutes.map((route) => route.routeId),
            availableRouteIds: availableGatewayRoutes.map((route) => route.routeId),
            resolverCandidateRouteIds: resolverCandidateRoutes.map((route) => route.routeId),
            missingRouteIds: gateway.routeIds.filter((routeId) => !persistedRoutesById.has(routeId)),
            disabledRouteIds: routeDiagnostics.filter((route) => route.enabled === false && persistedRoutesById.has(route.routeId)).map((route) => route.routeId),
            environmentMismatchRouteIds: routeDiagnostics.filter((route) => route.envName !== null && route.envName !== gateway.envName).map((route) => route.routeId),
            protocolMismatchRouteIds: routeDiagnostics.filter((route) => route.protocol !== null && route.protocol !== gatewayProtocol).map((route) => route.routeId),
            cooldownRouteIds: routeDiagnostics.filter((route) => route.loaded && !route.available).map((route) => route.routeId),
            routeGroupIds: Object.keys(gateway.routeGroups ?? {}),
            routeDiagnostics,
          });
          return sendJson(response, routeResult.code === "NO_ROUTE" ? 503 : 404, { error: routeResult.message, code: routeResult.code });
        }
        const route = routeResult.route;
        const gatewayUsageContext: UsageTelemetryContext = {
          logicalModel: requestedModel ?? null,
          agentId: request.headers["x-codex-agent"]?.toString().trim() || null,
          ingressProtocol: gatewayProtocol,
          routeGroupId: routeResult.routeGroupId ?? route.routeGroupId ?? null,
          routeRuleId: routeResult.routeRuleId ?? null,
        };
        if (!consumeGatewayQuota(gateway, bodyOverride?.length ? Math.max(1, Math.ceil(bodyOverride.length / 4)) : 1)) {
          return sendJson(response, 429, { error: "Gateway quota exceeded", code: "GATEWAY_QUOTA_EXCEEDED" });
        }
        void recordPoolEvent({
          event: "gateway_route_selected",
          at: Date.now(),
          requestId: gatewayRequestId,
          gatewayId,
          envName: gateway.envName,
          requestedModel: requestedModel ?? null,
          protocol: gatewayProtocol,
          routeId: route.routeId,
          accountName: route.accountName,
          providerId: route.providerId ?? null,
          routeGroupId: route.routeGroupId ?? null,
          reason: routeResult.reason,
        });
        if (gateway.poolId) {
          const pool = pools.get(gateway.poolId);
          if (!pool) return sendJson(response, 503, { error: "Gateway credential pool is unavailable", code: "GATEWAY_POOL_UNAVAILABLE" });
          if (pool.protocol !== gatewayProtocol) return sendJson(response, 400, { error: `Gateway protocol '${gatewayProtocol}' does not match credential pool protocol '${pool.protocol}'`, code: "GATEWAY_POOL_PROTOCOL_MISMATCH" });
          const requestedGroup = requestedModel
            ? Object.values(gateway.routeGroups ?? {}).find((group) => group.exposedModelId === requestedModel || group.id === requestedModel)
            : routeResult.reason === "route_rule" && routeResult.routeGroupId
              ? gateway.routeGroups?.[routeResult.routeGroupId]
              : undefined;
          const selectedGatewayRoutes = requestedGroup?.routeIds
            .map((routeId) => routes.get(routeId))
            .filter((candidate): candidate is RouteTarget => candidate !== undefined)
            ?? (requestedModel || routeResult.reason === "route_rule"
              ? [route]
              : gateway.routeIds.map((routeId) => routes.get(routeId)).filter((candidate): candidate is RouteTarget => candidate !== undefined));
          const selectedAccountNames = new Set(selectedGatewayRoutes.map((candidate) => candidate.accountName));
          const allowedRouteIds = pool.members
            .filter((member) => selectedAccountNames.has(member.accountName))
            .map((member) => member.routeId);
          const poolModelOverrides = new Map(
            selectedGatewayRoutes
              .filter((candidate) => candidate.upstreamModel)
              .map((candidate) => [candidate.accountName, candidate.upstreamModel!] as const),
          );
          const poolProtocolOverrides = new Map(
            selectedGatewayRoutes
              .map((candidate) => [candidate.accountName, candidate.protocol] as const),
          );
          return await proxyAccountPoolRequest(
            request,
            response,
            pool,
            routes,
            new Map(Array.from((poolSecrets.get(pool.poolId) ?? new Map()).entries())),
            poolTokens.get(pool.poolId) ?? "",
            store,
            history,
            `${gatewayMatch[2]}${url.search}`,
            undefined,
            recordPoolEvent,
            allowedRouteIds,
            poolModelOverrides,
            poolProtocolOverrides,
            bodyOverride,
            gatewayUsageContext,
            defaultProxyUrl,
          );
        }
        const legacyFallbackRoutes = gateway.routeGroups
          ? (Object.values(gateway.routeGroups).find((group) => group.routeIds.includes(route.routeId))?.routeIds
            .map((routeId) => routes.get(routeId)).filter((candidate): candidate is RouteTarget => candidate !== undefined && gatewayRouteAvailable(gateway, candidate)) ?? [])
          : [];
        const onGatewayRouteOutcome = (candidate: RouteTarget, success: boolean, status: number | null, telemetry: RouteOutcomeTelemetry): void => {
          recordGatewayRouteOutcome(gateway, candidate, success, status, telemetry);
          void recordPoolEvent({
            event: "gateway_route_attempt",
            at: Date.now(),
            requestId: gatewayRequestId,
            gatewayId,
            envName: gateway.envName,
            requestedModel: requestedModel ?? null,
            routeId: candidate.routeId,
            accountName: candidate.accountName,
            providerId: candidate.providerId ?? null,
            ingressProtocol: gatewayProtocol,
            upstreamProtocol: telemetry.upstreamProtocol,
            attemptIndex: telemetry.attemptIndex,
            attemptCount: telemetry.attemptCount,
            status,
            success,
            outcome: telemetry.outcome,
            failureReason: telemetry.failureReason,
            errorMessage: telemetry.errorMessage,
            errorName: telemetry.errorName ?? null,
            errorCode: telemetry.errorCode ?? null,
            errorCause: telemetry.errorCause ?? null,
            retryAfterMs: telemetry.retryAfterMs,
            latencyMs: telemetry.latencyMs,
            proxySource: telemetry.proxySource,
            cooldownUntil: gatewayHealth.get(gatewayRouteMetricKey(gateway, candidate.routeId))?.cooldownUntil ?? null,
          });
        };
        return await proxyRequest(
          request,
          response,
          route,
          `${gatewayMatch[2]}${url.search}`,
          store,
          routeSecrets.get(route.routeId),
          bodyOverride,
          routeResult.fallbackRoutes ?? legacyFallbackRoutes,
          (candidate) => routeSecrets.get(candidate.routeId),
          onGatewayRouteOutcome,
          gatewayProtocol,
          requestedModel,
          (providerId) => providerId && pluginManager?.registry.has(providerId) ? pluginManager.registry.get(providerId) : undefined,
          gatewayUsageContext,
          defaultProxyUrl,
        );
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
        ), token ?? "", store, history, routeSuffix, matchedMember, recordPoolEvent, undefined, undefined, undefined, undefined, {
          agentId: request.headers["x-codex-agent"]?.toString().trim() || null,
          ingressProtocol: pool!.protocol,
        }, defaultProxyUrl);
      }
      const match = url.pathname.match(/^\/routes\/([^/]+)\/?(.*)$/);
      if (!match) return sendJson(response, 404, { error: "Not found" });
      const route = routes.get(decodeURIComponent(match[1]));
      if (!route) return sendJson(response, 404, { error: "Route is disabled or missing" });
      if (route.protocol === "chat_completions") {
        const secret = routeSecrets.get(route.routeId);
        if (!secret) return sendJson(response, 503, { error: "Route credentials are not hydrated" });
        return await proxyCompatibilityRequest(request, response, route, secret, store, history, {
          agentId: request.headers["x-codex-agent"]?.toString().trim() || null,
          ingressProtocol: route.protocol,
        }, defaultProxyUrl);
      }
      await proxyRequest(request, response, route, `${match[2]}${url.search}`, store, routeSecrets.get(route.routeId), undefined, [], undefined, undefined, undefined, undefined,
        (providerId) => providerId && pluginManager?.registry.has(providerId) ? pluginManager.registry.get(providerId) : undefined, {
          agentId: request.headers["x-codex-agent"]?.toString().trim() || null,
          ingressProtocol: route.protocol,
        }, defaultProxyUrl);
    } catch (error) {
      if (!response.headersSent) sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      else response.destroy(error instanceof Error ? error : undefined);
    }
  });
  server.on("upgrade", (request, socket) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const gatewayMatch = url.pathname.match(/^\/gateways\/([^/]+)\/?(.*)$/);
      const gatewayId = gatewayMatch ? decodeURIComponent(gatewayMatch[1]) : undefined;
      const gateway = gatewayId ? gateways.get(gatewayId) : undefined;
      const gatewayRouteSuffix = gatewayMatch?.[2] || "responses";
      const gatewayProtocol = detectGatewayProtocol(gatewayRouteSuffix);
      if (!gateway || gatewayProtocol !== "responses") {
        socket.destroy();
        return;
      }
      const requestId = randomUUID();
      const body = JSON.stringify({
        error: "Gateway Responses endpoint only supports HTTP POST/SSE; WebSocket transport is disabled",
        code: "GATEWAY_WEBSOCKET_UNSUPPORTED",
        requestId,
      });
      void recordPoolEvent({
        event: "gateway_request_rejected",
        at: Date.now(),
        requestId,
        gatewayId,
        envName: gateway.envName,
        protocol: gatewayProtocol,
        method: request.method ?? "GET",
        requestedModel: null,
        hasUpgrade: true,
        rejectionCode: "GATEWAY_WEBSOCKET_UNSUPPORTED",
        failureReason: "protocol_mismatch",
        errorMessage: "Gateway Responses endpoint does not support WebSocket transport",
      }).finally(() => {
        if (socket.destroyed) return;
        socket.write([
          "HTTP/1.1 405 Method Not Allowed",
          "Content-Type: application/json; charset=utf-8",
          "Allow: POST",
          "Connection: close",
          `Content-Length: ${Buffer.byteLength(body)}`,
          "",
          body,
        ].join("\r\n"));
        socket.end();
      });
    } catch {
      socket.destroy();
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
    await writePrivateJsonAtomically(portStatePath, { preferredPort: options.preferredPort, selectedPort: port });
  } else {
    await listenOnPort(server, 0);
  }
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to resolve router port");
  const state: RouterStateFile = { pid: process.pid, port: address.port, adminToken, startedAt: Date.now() };
  await writePrivateJsonAtomically(statePath, state);
  closeService = () => {
    if (!closePromise) {
      closePromise = (async () => {
        routeSecrets.clear();
        poolSecrets.clear(); poolTokens.clear();
        // Node's fetch implementation may leave keep-alive sockets open after
        // the response body has been consumed. Close idle connections first so
        // the lifecycle promise cannot wait indefinitely during shutdown.
        server.closeIdleConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        await store.close();
        await pluginManager?.close().catch(() => undefined);
        await closeUpstreamProxyAgents();
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
