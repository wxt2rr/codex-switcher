import type { AgentFileSystem } from "./contracts.js";
import { type NodeAgentFileSystemOptions } from "./adapter.js";
export interface RemoteAgentCommandResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}
export type RemoteAgentCommandRunner = (script: string) => Promise<RemoteAgentCommandResult>;
export interface SshAgentFileSystemOptions extends NodeAgentFileSystemOptions {
    host: string;
    port?: number;
    identityFile?: string;
    sshPath?: string;
    timeoutMs?: number;
    maxOutputBytes?: number;
    /** Injected runner for deterministic tests or an application-managed SSH session. */
    runScript?: RemoteAgentCommandRunner;
}
/**
 * Create a remote Agent filesystem over SSH without interpolating paths into
 * the SSH command line. Data is encoded into a fixed POSIX shell script, then
 * decoded remotely, so spaces, quotes and shell metacharacters remain data.
 */
export declare function createSshAgentFileSystem(root: string, options: SshAgentFileSystemOptions): AgentFileSystem;
