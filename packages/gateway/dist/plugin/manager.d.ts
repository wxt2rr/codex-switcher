import { ProviderRegistry } from "../provider/registry.js";
import { PluginInstallationStore, type InstalledPlugin, type PluginCommandRunner, type PluginInstallSource } from "./market.js";
import { PluginRuntimeManager, type ActivePluginProvider, type PluginRuntimeOptions } from "./runtime.js";
import { GatewayMiddlewareRegistry } from "./middleware.js";
import { PluginMiddlewareRuntimeManager, type PluginMiddlewareRuntimeOptions } from "./middleware-runtime.js";
import type { ActiveGatewayMiddleware } from "./middleware.js";
import type { GatewayPluginManifest } from "./host.js";
import { PluginSettingsStore } from "./settings.js";
export interface ProviderPluginManagerOptions extends Omit<PluginRuntimeOptions, "registry">, Omit<PluginMiddlewareRuntimeOptions, "registry"> {
    rootDir: string;
    registry?: ProviderRegistry;
    middlewareRegistry?: GatewayMiddlewareRegistry;
    verifySignature?: (manifest: GatewayPluginManifest, checksum: string) => boolean | Promise<boolean>;
    settingsDir?: string;
}
export interface PluginActivationFailure {
    id: string;
    version: string;
    message: string;
}
export interface PluginActivationReport {
    activated: ActivePluginProvider[];
    middlewareActivated: ActiveGatewayMiddleware[];
    failed: PluginActivationFailure[];
}
export interface ActivePluginComponents {
    provider?: ActivePluginProvider;
    middleware?: ActiveGatewayMiddleware;
}
/**
 * Desktop-facing lifecycle coordinator for installed Provider plugins.
 * Installation metadata is persisted beside each version, activation is
 * fail-closed through PluginRuntimeManager, and one broken plugin never
 * prevents the remaining providers from starting.
 */
export declare class ProviderPluginManager {
    private readonly options;
    readonly registry: ProviderRegistry;
    readonly middlewareRegistry: GatewayMiddlewareRegistry;
    readonly installations: PluginInstallationStore;
    readonly runtime: PluginRuntimeManager;
    readonly middlewareRuntime: PluginMiddlewareRuntimeManager;
    readonly settings?: PluginSettingsStore;
    constructor(options: ProviderPluginManagerOptions);
    activateInstalled(): Promise<PluginActivationReport>;
    install(manifest: GatewayPluginManifest, source: PluginInstallSource, runCommand?: PluginCommandRunner): Promise<ActivePluginProvider>;
    installPlugin(manifest: GatewayPluginManifest, source: PluginInstallSource, runCommand?: PluginCommandRunner): Promise<ActivePluginComponents>;
    deactivate(id: string): Promise<boolean>;
    activate(id: string): Promise<ActivePluginComponents>;
    rollback(id: string): Promise<ActivePluginProvider>;
    rollbackPlugin(id: string): Promise<ActivePluginComponents>;
    remove(id: string): Promise<void>;
    listInstalled(): Promise<InstalledPlugin[]>;
    listActive(): ActivePluginProvider[];
    listActiveMiddleware(): ActiveGatewayMiddleware[];
    getSettings(id: string): Promise<Record<string, unknown>>;
    setSettings(id: string, values: Record<string, unknown>): Promise<Record<string, unknown>>;
    clearSettings(id: string): Promise<void>;
    close(): Promise<void>;
    private activateInstalledComponents;
    private assertTrustedManifest;
}
