import { type GatewayPluginManifest, type PluginHostOptions, type PluginLogSink, type PluginTransport } from "./host.js";
import { GatewayMiddlewareRegistry, type ActiveGatewayMiddleware } from "./middleware.js";
import type { PluginSandboxOptions } from "./sandbox.js";
export interface PluginMiddlewareRuntimeOptions {
    registry: GatewayMiddlewareRegistry;
    sandbox?: PluginSandboxOptions;
    host?: Omit<PluginHostOptions, "manifest">;
    globalConcurrency?: {
        maxConcurrent?: number;
        maxQueue?: number;
    };
    maxRestarts?: number;
    log?: PluginLogSink;
    transportFactory?: (manifest: GatewayPluginManifest, path: string, sandbox: PluginSandboxOptions) => PluginTransport | Promise<PluginTransport>;
}
export declare class PluginMiddlewareRuntimeManager {
    private readonly options;
    private readonly active;
    private readonly transportFactory;
    private readonly globalConcurrency;
    constructor(options: PluginMiddlewareRuntimeOptions);
    activate(manifest: GatewayPluginManifest, path: string): Promise<ActiveGatewayMiddleware>;
    deactivate(id: string): Promise<boolean>;
    close(): Promise<void>;
    list(): ActiveGatewayMiddleware[];
}
