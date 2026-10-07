import { spawn } from "node:child_process";

import type { AgentFileSystem, RemoteAgentFileSystemTransport } from "./contracts.js";
import { createRemoteAgentFileSystem, type NodeAgentFileSystemOptions } from "./adapter.js";

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

const MISSING_FILE_EXIT_CODE = 73;

/**
 * Create a remote Agent filesystem over SSH without interpolating paths into
 * the SSH command line. Data is encoded into a fixed POSIX shell script, then
 * decoded remotely, so spaces, quotes and shell metacharacters remain data.
 */
export function createSshAgentFileSystem(root: string, options: SshAgentFileSystemOptions): AgentFileSystem {
  const runScript = options.runScript ?? createSshScriptRunner(options);
  const transport: RemoteAgentFileSystemTransport = {
    async read(path) {
      const result = await runScript(readScript(path));
      if (result.exitCode === MISSING_FILE_EXIT_CODE) return null;
      assertRemoteSuccess(result, "read");
      const encoded = result.stdout.replace(/\s+/g, "");
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
        throw new Error("Remote Agent read returned invalid base64");
      }
      return Buffer.from(encoded, "base64").toString("utf8");
    },
    async write(path, content) {
      const result = await runScript(writeScript(path, content));
      assertRemoteSuccess(result, "write");
    },
    async remove(path) {
      const result = await runScript(removeScript(path));
      assertRemoteSuccess(result, "remove");
    },
    async list(path) {
      const result = await runScript(listScript(path));
      if (result.exitCode === MISSING_FILE_EXIT_CODE) return [];
      assertRemoteSuccess(result, "list");
      return result.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    },
  };
  return createRemoteAgentFileSystem(root, transport, {
    pathStyle: options.pathStyle ?? "posix",
    additionalRoots: options.additionalRoots,
  });
}

function createSshScriptRunner(options: SshAgentFileSystemOptions): RemoteAgentCommandRunner {
  const sshPath = options.sshPath ?? "ssh";
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxOutputBytes = options.maxOutputBytes ?? 8 * 1024 * 1024;
  const args = ["-T", "-o", "BatchMode=yes"];
  if (options.port !== undefined) args.push("-p", String(options.port));
  if (options.identityFile) args.push("-i", options.identityFile);
  args.push(options.host, "sh", "-s");

  return (script) => new Promise((resolve, reject) => {
    const child = spawn(sshPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    const finishResolve = (value: RemoteAgentCommandResult) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(value);
    };
    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      child.kill("SIGTERM");
      reject(error);
    };
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        finishReject(new Error(`SSH Agent operation exceeded the ${maxOutputBytes}-byte output limit`));
        return;
      }
      target.push(chunk);
    };
    timeout = setTimeout(() => {
      finishReject(new Error(`SSH Agent operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (error) => finishReject(error instanceof Error ? error : new Error(String(error))));
    child.on("close", (code, signal) => {
      if (settled) return;
      if (code === null) {
        finishReject(new Error(`SSH Agent process ended by ${signal ?? "unknown signal"}`));
        return;
      }
      finishResolve({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), exitCode: code });
    });
    child.stdin.on("error", (error) => finishReject(error instanceof Error ? error : new Error(String(error))));
    child.stdin.end(script, "utf8");
  });
}

function assertRemoteSuccess(result: RemoteAgentCommandResult, operation: string): void {
  if (result.exitCode === 0) return;
  const detail = result.stderr.trim().replace(/\s+/g, " ").slice(0, 500);
  throw new Error(`Remote Agent ${operation} failed with exit code ${result.exitCode}${detail ? `: ${detail}` : ""}`);
}

function readScript(path: string): string {
  return `${shellHeader()}\npath=$(decode '${encode(path)}')\nif [ ! -f "$path" ]; then exit ${MISSING_FILE_EXIT_CODE}; fi\nbase64 "$path"\n`;
}

function writeScript(path: string, content: string): string {
  return `${shellHeader()}\npath=$(decode '${encode(path)}')\ncontent='${encode(content)}'\nparent=$(dirname -- "$path")\nmkdir -p -- "$parent"\ntemporary=$(mktemp "$path.codex-switcher.XXXXXX")\ntrap 'rm -f -- "$temporary"' EXIT\nprintf '%s' "$content" | decode > "$temporary"\nmv -f -- "$temporary" "$path"\ntrap - EXIT\n`;
}

function removeScript(path: string): string {
  return `${shellHeader()}\npath=$(decode '${encode(path)}')\nrm -f -- "$path"\n`;
}

function listScript(path: string): string {
  return `${shellHeader()}\npath=$(decode '${encode(path)}')\nif [ ! -d "$path" ]; then exit ${MISSING_FILE_EXIT_CODE}; fi\nfor item in "$path"/*; do [ -e "$item" ] || continue; basename -- "$item"; done\n`;
}

function shellHeader(): string {
  return `set -eu
decode() {
  if [ "$#" -gt 0 ]; then
    input="$1"
  else
    input=$(cat)
  fi
  if printf '%s' "$input" | base64 -d 2>/dev/null; then return 0; fi
  printf '%s' "$input" | base64 -D
}`;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}
