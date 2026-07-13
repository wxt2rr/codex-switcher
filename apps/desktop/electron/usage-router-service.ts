import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";

import {
  extractTokenUsage,
  type RouteRuntimeSecret,
  type RouteTarget,
  type UsageFilter,
  type UsageRequestQuery,
} from "./usage-routing-model.js";
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

export const USAGE_ROUTER_API_VERSION = 6;

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

async function relayResponse(source: Response, target: ServerResponse, tap?: UsageTap): Promise<void> {
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
    sendJson(response, 502, { error: error instanceof Error ? error.message : String(error) });
    const completedAt = Date.now();
    await store.recordUsage({
      requestId: randomUUID(), routeId: route.routeId, startedAt, completedAt,
      envName: route.envName, accountName: route.accountName, upstreamBaseUrl: route.upstreamBaseUrl,
      endpoint: `/${routeSuffix.replace(/^\/+/, "")}`, model: null, inputTokens: null, outputTokens: null,
      cacheCreationTokens: null, cacheReadTokens: null, totalTokens: null, httpStatus: 502,
      latencyMs: completedAt - startedAt, actualCost: null, standardCost: null,
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
    sendJson(response, status, { error: { message: error instanceof Error ? error.message : String(error) } });
  }
  const completedAt = Date.now();
  const usage = tap.finish();
  await store.recordUsage({ requestId: randomUUID(), routeId: route.routeId, startedAt, completedAt,
    envName: route.envName, accountName: route.accountName, upstreamBaseUrl: route.upstreamBaseUrl,
    endpoint: "/responses", model: usage?.model ?? null, inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null, cacheCreationTokens: usage?.cacheCreationTokens ?? null,
    cacheReadTokens: usage?.cacheReadTokens ?? null, totalTokens: usage?.totalTokens ?? null,
    httpStatus: status, latencyMs: completedAt - startedAt, actualCost: null, standardCost: null });
}

export async function startUsageRouterService(options: UsageRouterServiceOptions): Promise<RunningUsageRouterService> {
  await mkdir(options.stateDir, { recursive: true });
  const store = await createUsageStore(join(options.stateDir, "usage.db"));
  const adminToken = options.adminToken ?? randomBytes(32).toString("hex");
  const routes = new Map((await store.listRoutes()).filter((route) => route.enabled).map((route) => [route.routeId, route]));
  const routeSecrets = new RouteSecretStore();
  const history = new ConversationHistoryStore({
    persistence: new FileHistoryPersistence(join(options.stateDir, "chat-history")),
  });
  const statePath = join(options.stateDir, "router-state.json");
  const portStatePath = join(options.stateDir, "router-port.json");
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
        if (url.pathname === "/admin/stats" && request.method === "GET") {
          return sendJson(response, 200, await store.queryUsage(filterFromUrl(url)));
        }
        if (url.pathname === "/admin/requests" && request.method === "GET") {
          return sendJson(response, 200, await store.queryUsageRequests(requestQueryFromUrl(url)));
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
