import { ProviderRegistry } from "../provider/registry.js";
import { PluginInstallationStore, type InstalledPlugin, type PluginCommandRunner, type PluginInstallSource } from "./market.js";
import { PluginRuntimeManager, type ActivePluginProvider, type PluginRuntimeOptions } from "./runtime.js";
import type { GatewayPluginManifest } from "./host.js";
export interface ProviderPluginManagerOptions extends Omit<PluginRuntimeOptions, "registry"> {
    rootDir: string;
    registry?: ProviderRegistry;
    verifySignature?: (manifest: GatewayPluginManifest, checksum: string) => boolean | Promise<boolean>;
}
export interface PluginActivationFailure {
    id: string;
    version: string;
    message: string;
}
export interface PluginActivationReport {
    activated: ActivePluginProvider[];
    failed: PluginActivationFailure[];
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
    readonly installations: PluginInstallationStore;
    readonly runtime: PluginRuntimeManager;
    constructor(options: ProviderPluginManagerOptions);
    activateInstalled(): Promise<PluginActivationReport>;
    install(manifest: GatewayPluginManifest, source: PluginInstallSource, runCommand?: PluginCommandRunner): Promise<ActivePluginProvider>;
    deactivate(id: string): Promise<boolean>;
    rollback(id: string): Promise<ActivePluginProvider>;
    remove(id: string): Promise<void>;
    listInstalled(): Promise<InstalledPlugin[]>;
    listActive(): ActivePluginProvider[];
    close(): Promise<void>;
    private assertTrustedManifest;
}
