import type { AgentAdapter, AgentAdapterOptions, AgentFileSystem, AgentAdapterProfile, RemoteAgentFileSystemTransport } from "./contracts.js";
export type AgentPathStyle = "native" | "posix" | "windows";
export interface NodeAgentFileSystemOptions {
    /**
     * Additional absolute roots that may be addressed by the adapter. This is
     * used for the Switcher state directory, which intentionally lives outside
     * an Agent's home directory.
     */
    additionalRoots?: readonly string[];
    /**
     * WSL uses POSIX paths (including /mnt/<drive>), while a native Windows
     * process uses drive/UNC paths. Keeping this explicit makes remote and
     * cross-platform Agent filesystems deterministic instead of relying on the
     * host process to guess a path flavor.
     */
    pathStyle?: AgentPathStyle;
}
/** Resolve a local/WSL/Windows Agent path without allowing root escape. */
export declare function resolveAgentPath(root: string, requestedPath: string, options?: NodeAgentFileSystemOptions): string;
export declare function createNodeAgentFileSystem(root: string, options?: NodeAgentFileSystemOptions): AgentFileSystem;
/**
 * Adapt a remote transport to the same path-confined filesystem contract used
 * by every Agent adapter. The transport never receives caller-provided paths
 * before they have been resolved beneath the Agent root or an explicit
 * additional root.
 */
export declare function createRemoteAgentFileSystem(root: string, transport: RemoteAgentFileSystemTransport, options?: NodeAgentFileSystemOptions): AgentFileSystem;
export declare function createAgentAdapter(profile: AgentAdapterProfile, options: AgentAdapterOptions): AgentAdapter;
export declare function createBuiltInAgentAdapters(options: AgentAdapterOptions): ReadonlyMap<string, AgentAdapter>;
