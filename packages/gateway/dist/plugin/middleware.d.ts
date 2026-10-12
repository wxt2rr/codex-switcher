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
export declare class GatewayMiddlewareRegistry {
    private readonly active;
    register(middleware: ActiveGatewayMiddleware): void;
    unregister(id: string): boolean;
    list(): ActiveGatewayMiddleware[];
    runRequest(body: JsonObject, context: GatewayMiddlewareContext): Promise<{
        body: JsonObject;
        model?: string;
        reject?: GatewayMiddlewareReject;
    }>;
    runEvent(event: JsonObject, context: GatewayMiddlewareContext): Promise<{
        event: JsonObject | null;
        reject?: GatewayMiddlewareReject;
    }>;
    runResponse(body: JsonObject, context: GatewayMiddlewareContext): Promise<{
        body: JsonObject;
        reject?: GatewayMiddlewareReject;
    }>;
    close(): Promise<void>;
    private call;
}
export declare function normalizeMiddlewareResult(value: unknown): GatewayMiddlewareResult | undefined;
