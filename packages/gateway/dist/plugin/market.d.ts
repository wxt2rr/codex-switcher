import { type GatewayPluginManifest } from "./host.js";
export interface PluginMarketEntry extends GatewayPluginManifest {
    description?: string;
    downloadUrl?: string;
    /** Explicit install source; market entries never infer executable sources from free-form URLs. */
    source?: PluginInstallSource;
    checksum?: string;
    updatedAt: number;
}
export interface PluginMarketClient {
    fetchIndex(url: string): Promise<unknown>;
}
export interface PluginMarketOptions {
    verifySignature?: (manifest: GatewayPluginManifest, checksum?: string) => boolean | Promise<boolean>;
}
export interface InstalledPlugin {
    id: string;
    version: string;
    path: string;
    active: boolean;
    manifest?: GatewayPluginManifest;
    previousVersion?: string;
    checksum?: string;
}
export type PluginInstallSource = {
    kind: "local";
    path: string;
} | {
    kind: "npm";
    spec: string;
} | {
    kind: "git";
    url: string;
    ref?: string;
};
export interface PluginCommandResult {
    code: number;
    stdout: string;
    stderr: string;
}
export type PluginCommandRunner = (command: string, args: readonly string[], cwd: string) => Promise<PluginCommandResult>;
export interface PluginInstallationOptions {
    verifySignature?: (manifest: GatewayPluginManifest, checksum: string) => boolean | Promise<boolean>;
}
export declare class PluginMarket {
    private readonly cachePath;
    private readonly options;
    constructor(cachePath: string, options?: PluginMarketOptions);
    update(url: string, client: PluginMarketClient): Promise<PluginMarketEntry[]>;
    list(): Promise<PluginMarketEntry[]>;
    static cachePath(root: string): string;
}
export declare function validatePluginMarketEntry(value: unknown): value is PluginMarketEntry;
export declare class PluginInstallationStore {
    private readonly root;
    private readonly options;
    constructor(root: string, options?: PluginInstallationOptions);
    installFromSource(manifest: GatewayPluginManifest, source: PluginInstallSource, runCommand?: PluginCommandRunner): Promise<InstalledPlugin>;
    install(manifest: GatewayPluginManifest, sourceDirectory: string): Promise<InstalledPlugin>;
    list(): Promise<InstalledPlugin[]>;
    rollback(id: string): Promise<InstalledPlugin>;
    remove(id: string): Promise<void>;
    private readActive;
    private readManifest;
    private readVersionChecksum;
}
