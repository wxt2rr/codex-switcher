import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type UpdateInstallMode = "automatic" | "manual" | "unsupported";

export interface UpdateInstallResult {
  mode: UpdateInstallMode;
  message: string;
}

export interface UpdateInstallRequest {
  artifactKind: string;
  downloadedPath: string;
  currentPid: number;
  executablePath: string;
  appImagePath?: string;
  releaseUrl?: string;
}

export function resolveUpdateInstallMode(kind: string, platform: NodeJS.Platform): UpdateInstallMode {
  if (platform === "win32" && kind === "win-nsis") return "automatic";
  if (platform === "linux" && kind === "linux-appimage") return "automatic";
  if (platform === "darwin" && (kind === "mac-zip" || kind === "mac-dmg")) return "manual";
  return "unsupported";
}

export function createWindowsInstallScript(request: UpdateInstallRequest, scriptPath: string): void {
  const installer = quoteWindows(request.downloadedPath);
  const executable = quoteWindows(request.executablePath);
  const script = [
    "@echo off",
    ":wait_for_app",
    `tasklist /FI "PID eq ${request.currentPid}" | find "${request.currentPid}" >nul`,
    "if not errorlevel 1 (",
    "  timeout /t 1 /nobreak >nul",
    "  goto wait_for_app",
    ")",
    `start /wait "" ${installer} /S`,
    `start "" ${executable}`,
    `del "%~f0"`,
  ].join("\r\n");
  writeHelperScript(scriptPath, script, false);
}

export function createLinuxAppImageInstallScript(request: UpdateInstallRequest, scriptPath: string): void {
  if (!request.appImagePath) throw new Error("Running AppImage path is not available");
  const downloaded = quoteShell(request.downloadedPath);
  const target = quoteShell(request.appImagePath);
  const script = [
    "#!/bin/sh",
    "set -eu",
    `while kill -0 ${request.currentPid} 2>/dev/null; do sleep 1; done`,
    `chmod +x ${downloaded}`,
    `mv -f ${downloaded} ${target}`,
    `nohup ${target} >/dev/null 2>&1 &`,
    `rm -f ${quoteShell(scriptPath)}`,
  ].join("\n");
  writeHelperScript(scriptPath, script, true);
}

export function createUpdateHelperPath(extension: "cmd" | "sh"): string {
  const directory = join(tmpdir(), "codex-switcher-updates");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return join(directory, `install-${Date.now()}-${randomUUID()}.${extension}`);
}

function writeHelperScript(path: string, contents: string, executable: boolean): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${contents}\n`, { mode: executable ? 0o700 : 0o600 });
  if (executable) chmodSync(path, 0o700);
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function quoteWindows(value: string): string {
  return `"${value.replaceAll("%", "%%").replaceAll('"', '""')}"`;
}
