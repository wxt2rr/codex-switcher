import { type ChildProcessWithoutNullStreams } from "node:child_process";
import { type PluginSandboxOptions } from "./sandbox.js";
export declare const PLUGIN_PROTOCOL_VERSION = 1;
export declare const MAX_PLUGIN_FRAME_BYTES: number;
export interface GatewayPluginManifest {
    id: string;
    name: string;
    version: string;
    apiVersion: number;
    entry: string;
    permissions: PluginPermission[];
    signature?: string;
    checksum?: string;
}
export type PluginPermission = "provider" | "agent" | "usage" | "network" | "filesystem" | "secrets";
export interface PluginRpcRequest {
    jsonrpc: "2.0";
    id: string;
    method: string;
    params?: Record<string, unknown>;
}
export interface PluginRpcResponse {
    jsonrpc: "2.0";
    id: string;
    result?: unknown;
    error?: {
        code: number;
        message: string;
    };
}
export interface PluginTransport {
    send(request: PluginRpcRequest): Promise<PluginRpcResponse>;
    /** Cancel a request that exceeded the host deadline when the transport can release it. */
    cancel?(requestId: string): void;
    close(): Promise<void>;
}
export type PluginLogSink = (line: string) => void;
export interface PluginHostOptions {
    timeoutMs?: number;
    maxConcurrent?: number;
    maxQueue?: number;
    manifest?: GatewayPluginManifest;
    allowedPermissions?: readonly PluginPermission[];
    /** Shared across hosts to cap total in-flight plugin RPCs. */
    concurrencyLimiter?: PluginConcurrencyLimiter;
}
export interface PluginConcurrencyLimiterOptions {
    maxConcurrent?: number;
    maxQueue?: number;
}
/**
 * Bounds plugin RPC work across all ProviderPlugin hosts in one Gateway
 * runtime. Per-plugin limits still apply in PluginHost; this limiter prevents
 * several otherwise-healthy plugins from exhausting the Gateway together.
 */
export declare class PluginConcurrencyLimiter {
    private readonly maxConcurrent;
    private readonly maxQueue;
    private active;
    private closed;
    private readonly queue;
    constructor(options?: PluginConcurrencyLimiterOptions);
    acquire(): Promise<() => void>;
    close(): void;
    private createRelease;
    private pump;
}
export declare function validatePluginManifest(value: unknown): value is GatewayPluginManifest;
export declare function requiredPluginPermission(method: string): PluginPermission;
export declare class PluginPermissionError extends Error {
    readonly permission: PluginPermission;
    constructor(permission: PluginPermission, method: string);
}
export declare function encodePluginFrame(value: PluginRpcRequest | PluginRpcResponse): string;
export declare function decodePluginFrame(value: string): PluginRpcRequest | PluginRpcResponse;
export declare class PluginHost {
    private readonly transport;
    private readonly timeoutMs;
    private readonly maxConcurrent;
    private readonly maxQueue;
    private active;
    private readonly queue;
    private readonly manifest?;
    private readonly allowedPermissions;
    private readonly concurrencyLimiter?;
    private closed;
    private closePromise;
    constructor(transport: PluginTransport, options?: PluginHostOptions);
    call(method: string, params?: Record<string, unknown>): Promise<PluginRpcResponse>;
    /**
     * Some provider lifecycle calls carry a secret resolved by the host. They
     * must opt into the stronger `secrets` permission explicitly; a provider
     * plugin cannot receive credential material merely because it can call a
     * normal provider method.
     */
    callWithPermission(method: string, params: Record<string, unknown> | undefined, permission: PluginPermission): Promise<PluginRpcResponse>;
    close(): Promise<void>;
    private pump;
    private execute;
}
export declare class ProcessPluginTransport implements PluginTransport {
    private readonly child;
    private readonly maxPending;
    private readonly log?;
    private readonly pending;
    private readonly maxPendingBytes;
    private pendingBytes;
    private buffer;
    private writeChain;
    constructor(child: ChildProcessWithoutNullStreams, maxPending?: number, maxPendingBytes?: number, log?: PluginLogSink | undefined);
    static start(manifest: GatewayPluginManifest, cwd: string, environment?: Record<string, string>, sandboxOptions?: PluginSandboxOptions, log?: PluginLogSink): ProcessPluginTransport;
    send(request: PluginRpcRequest): Promise<PluginRpcResponse>;
    cancel(requestId: string): void;
    close(): Promise<void>;
    private consume;
    private failAll;
    private writeFrame;
}
/**
 * Electron's process.execPath is the Electron binary rather than node. The
 * child must opt into Electron's Node-compatible mode, while standalone Node
 * callers keep a minimal environment and never inherit host secrets.
 */
export declare function buildPluginProcessEnvironment(overrides?: Record<string, string>): Record<string, string>;
export declare function redactPluginLog(value: string): string;
export declare class RestartingPluginTransport implements PluginTransport {
    private readonly factory;
    private readonly maxRestarts;
    private current;
    private restarts;
    private closed;
    constructor(factory: (attempt: number) => Promise<PluginTransport> | PluginTransport, maxRestarts?: number);
    send(request: PluginRpcRequest): Promise<PluginRpcResponse>;
    close(): Promise<void>;
    cancel(requestId: string): void;
    private transport;
}
