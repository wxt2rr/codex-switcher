import { type GatewayPluginManifest } from "./host.js";
/**
 * Host-owned lifecycle for agent integrations.
 *
 * Agent plugins are declarative integrations: the desktop host owns the
 * target application's configuration and secret boundary, so activation does
 * not start an untrusted child process or hand it credential material. The
 * manifest still participates in the same install/trust/enable lifecycle as
 * provider and middleware plugins.
 */
export interface ActivePluginAgent {
    manifest: GatewayPluginManifest;
    path: string;
}
export declare class PluginAgentRuntimeManager {
    private readonly active;
    activate(manifest: GatewayPluginManifest, path: string): Promise<ActivePluginAgent>;
    deactivate(id: string): Promise<boolean>;
    close(): Promise<void>;
    list(): ActivePluginAgent[];
}
