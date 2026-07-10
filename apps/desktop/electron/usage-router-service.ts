import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";

import { extractTokenUsage, type RouteTarget, type UsageFilter } from "./usage-routing-model.js";
import { createUsageStore, type UsageStore } from "./usage-store.js";

export interface UsageRouterServiceOptions {
  stateDir: string;
  adminToken?: string;
  port?: number;
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

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) throw new Error("Admin payload is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
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

  response.statusCode = upstreamResponse.status;
  upstreamResponse.headers.forEach((value, name) => {
    if (!["content-length", "transfer-encoding", "connection"].includes(name.toLowerCase())) {
      response.setHeader(name, value);
    }
  });
  const tap = new UsageTap();
  if (upstreamResponse.body) {
    const reader = upstreamResponse.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      tap.push(value);
      if (!response.write(Buffer.from(value))) await new Promise<void>((resolve) => response.once("drain", resolve));
    }
  }
  response.end();
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

export async function startUsageRouterService(options: UsageRouterServiceOptions): Promise<RunningUsageRouterService> {
  await mkdir(options.stateDir, { recursive: true });
  const store = await createUsageStore(join(options.stateDir, "usage.db"));
  const adminToken = options.adminToken ?? randomBytes(32).toString("hex");
  const routes = new Map((await store.listRoutes()).filter((route) => route.enabled).map((route) => [route.routeId, route]));

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/health") return sendJson(response, 200, { ok: true, pid: process.pid });
      if (url.pathname.startsWith("/admin/")) {
        if (!isAuthorized(request, adminToken)) return sendJson(response, 401, { error: "Unauthorized" });
        if (url.pathname === "/admin/routes" && request.method === "GET") {
          return sendJson(response, 200, await store.listRoutes());
        }
        if (url.pathname === "/admin/stats" && request.method === "GET") {
          return sendJson(response, 200, await store.queryUsage(filterFromUrl(url)));
        }
        if (url.pathname === "/admin/pricing" && request.method === "GET") {
          return sendJson(response, 200, await store.listPricing());
        }
        if (url.pathname === "/admin/pricing" && request.method === "PUT") {
          await store.upsertPricing(await readJson(request) as import("./usage-routing-model.js").PricingProfile);
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
          routes.delete(routeId); await store.removeRoute(routeId);
          response.statusCode = 204; return response.end();
        }
        return sendJson(response, 404, { error: "Not found" });
      }
      const match = url.pathname.match(/^\/routes\/([^/]+)\/?(.*)$/);
      if (!match) return sendJson(response, 404, { error: "Not found" });
      const route = routes.get(decodeURIComponent(match[1]));
      if (!route) return sendJson(response, 404, { error: "Route is disabled or missing" });
      await proxyRequest(request, response, route, `${match[2]}${url.search}`, store);
    } catch (error) {
      if (!response.headersSent) sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      else response.destroy(error instanceof Error ? error : undefined);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to resolve router port");
  const state: RouterStateFile = { pid: process.pid, port: address.port, adminToken, startedAt: Date.now() };
  const statePath = join(options.stateDir, "router-state.json");
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
  await chmod(statePath, 0o600);
  return {
    port: address.port, origin: `http://127.0.0.1:${address.port}`, adminToken,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await store.close();
    },
  };
}
