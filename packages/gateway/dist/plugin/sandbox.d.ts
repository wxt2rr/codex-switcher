import type { GatewayPluginManifest } from "./host.js";
export type PluginSandboxMode = "required" | "best-effort" | "disabled";
export type PluginSandboxKind = "macos-sandbox-exec" | "linux-bubblewrap" | "windows-app-container" | "none";
export interface PluginSandboxOptions {
    mode?: PluginSandboxMode;
    platform?: NodeJS.Platform;
    sandboxExecutable?: string;
    windowsSandboxExecutable?: string;
    nodeExecutable?: string;
}
export interface PluginLaunchSpec {
    command: string;
    args: string[];
    cwd: string;
    sandbox: {
        mode: PluginSandboxMode;
        kind: PluginSandboxKind;
        executable?: string;
        reason?: string;
    };
}
export declare class PluginSandboxUnavailableError extends Error {
    constructor(platform: NodeJS.Platform, detail: string);
}
/**
 * Build the actual child-process command for a plugin. The host-level
 * permission checks remain authoritative; this layer adds an OS boundary so
 * a compromised plugin cannot silently become a normal child process.
 */
export declare function buildPluginLaunchSpec(manifest: GatewayPluginManifest, cwd: string, options?: PluginSandboxOptions): PluginLaunchSpec;
