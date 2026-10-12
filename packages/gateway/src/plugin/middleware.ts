import type { GatewayProtocol, JsonObject } from "../protocol.js";
import { PluginHost, type GatewayPluginManifest } from "./host.js";

export type GatewayMiddlewareHook = "onRequest" | "onEvent" | "onResponse";

export interface GatewayMiddlewareContext {
  requestId: string;
  traceId: string;
  protocol: GatewayProtocol;
  model: string;
  stream: boolean;
  path?: string;
  agentId?: string;
  environmentId?: string;
  state: Record<string, unknown>;
  options?: JsonObject;
}

export interface GatewayMiddlewareReject {
  status?: number;
  message: string;
  code?: string;
}

export interface GatewayMiddlewareResult {
  body?: JsonObject;
  model?: string;
  reject?: GatewayMiddlewareReject;
  drop?: boolean;
}

export interface ActiveGatewayMiddleware {
  id: string;
  name: string;
  priority: number;
  manifest: GatewayPluginManifest;
  host: PluginHost;
  hooks: readonly GatewayMiddlewareHook[];
}

/**
 * Executes middleware outside the gateway process while preserving the
 * gateway's request/response shape. Middleware is deliberately fail-open for
 * crashes and timeouts: an explicit reject is the only way to block a request.
 */
export class GatewayMiddlewareRegistry {
  private readonly active = new Map<string, ActiveGatewayMiddleware>();

  register(middleware: ActiveGatewayMiddleware): void {
    if (this.active.has(middleware.id)) throw new Error(`Middleware '${middleware.id}' is already registered`);
    if (!middleware.hooks.length) throw new Error(`Middleware '${middleware.id}' must expose at least one hook`);
    this.active.set(middleware.id, middleware);
  }

  unregister(id: string): boolean { return this.active.delete(id); }

  list(): ActiveGatewayMiddleware[] {
    return [...this.active.values()].sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
  }

  async runRequest(body: JsonObject, context: GatewayMiddlewareContext): Promise<{ body: JsonObject; model?: string; reject?: GatewayMiddlewareReject }> {
    let current = body;
    let model: string | undefined;
    for (const middleware of this.list()) {
      if (!middleware.hooks.includes("onRequest")) continue;
      const result = await this.call(middleware, "middleware.onRequest", { body: current, context });
      if (!result) continue;
      if (result.reject) return { body: current, ...(model ? { model } : {}), reject: result.reject };
      if (result.body) current = result.body;
      if (result.model?.trim()) model = result.model.trim();
    }
    return { body: current, ...(model ? { model } : {}) };
  }

  async runEvent(event: JsonObject, context: GatewayMiddlewareContext): Promise<{ event: JsonObject | null; reject?: GatewayMiddlewareReject }> {
    let current: JsonObject | null = event;
    for (const middleware of this.list()) {
      if (!current || !middleware.hooks.includes("onEvent")) break;
      const result = await this.call(middleware, "middleware.onEvent", { event: current, context });
      if (!result) continue;
      if (result.drop) { current = null; continue; }
      if (result.reject) return { event: current, reject: result.reject };
      if (result.body) current = result.body;
    }
    return { event: current };
  }

  async runResponse(body: JsonObject, context: GatewayMiddlewareContext): Promise<{ body: JsonObject; reject?: GatewayMiddlewareReject }> {
    let current = body;
    for (const middleware of this.list()) {
      if (!middleware.hooks.includes("onResponse")) continue;
      const result = await this.call(middleware, "middleware.onResponse", { body: current, context });
      if (!result) continue;
      if (result.reject) return { body: current, reject: result.reject };
      if (result.body) current = result.body;
    }
    return { body: current };
  }

  async close(): Promise<void> {
    for (const middleware of this.active.values()) await middleware.host.close().catch(() => undefined);
    this.active.clear();
  }

  private async call(middleware: ActiveGatewayMiddleware, method: string, params: Record<string, unknown>): Promise<GatewayMiddlewareResult | undefined> {
    try {
      const response = await middleware.host.callWithPermission(method, params, "middleware");
      return normalizeMiddlewareResult(response.result);
    } catch {
      return undefined;
    }
  }
}

export function normalizeMiddlewareResult(value: unknown): GatewayMiddlewareResult | undefined {
  if (value === undefined || value === null) return undefined;
  if (isRecord(value) && isRecord(value.reject) && typeof value.reject.message === "string") {
    return {
      ...(isRecord(value.body) ? { body: value.body } : {}),
      ...(typeof value.model === "string" ? { model: value.model } : {}),
      reject: {
        message: value.reject.message,
        ...(typeof value.reject.status === "number" ? { status: value.reject.status } : {}),
        ...(typeof value.reject.code === "string" ? { code: value.reject.code } : {}),
      },
    };
  }
  if (!isRecord(value)) return undefined;
  return {
    ...(isRecord(value.body) ? { body: value.body } : {}),
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    ...(value.drop === true ? { drop: true } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
