import type { ProviderAuthMethod, ProviderEndpoint } from "../provider/adapters.js";
import { ProviderRegistry } from "../provider/registry.js";
import { PluginHost, type GatewayPluginManifest, type PluginHostOptions, type PluginLogSink, type PluginTransport } from "./host.js";
import type { InstalledPlugin } from "./market.js";
import type { PluginSandboxOptions } from "./sandbox.js";
export interface PluginProviderDescriptor {
    id: string;
    displayName: string;
    authMethods: ProviderAuthMethod[];
    endpoints: ProviderEndpoint[];
}
export interface PluginRuntimeOptions {
    registry: ProviderRegistry;
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
export interface ActivePluginProvider {
    manifest: GatewayPluginManifest;
    path: string;
    descriptor: PluginProviderDescriptor;
    host: PluginHost;
}
/**
 * Turns an installed provider plugin into a live ProviderAdapter. The plugin
 * must first describe its explicit provider contract over RPC; no credential
 * or prompt data is needed for activation.
 */
export declare class PluginRuntimeManager {
    private readonly options;
    private readonly active;
    private readonly transportFactory;
    private readonly globalConcurrency;
    constructor(options: PluginRuntimeOptions);
    activate(manifest: GatewayPluginManifest, path: string): Promise<ActivePluginProvider>;
    activateInstalled(manifest: GatewayPluginManifest, installed: InstalledPlugin): Promise<ActivePluginProvider>;
    deactivate(id: string): Promise<boolean>;
    close(): Promise<void>;
    list(): ActivePluginProvider[];
}
