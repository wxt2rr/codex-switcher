import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export type CodexToolKind = "cli" | "app";
export type CodexToolSource = "manual" | "environment" | "path" | "candidate" | "missing";
export interface CodexToolStatus { kind: CodexToolKind; path: string; detectedPath: string; manualPath: string; source: CodexToolSource; available: boolean; }
interface DesktopSettings { cliPath?: string; appPath?: string; }
export interface CodexToolPathOptions { settingsPath: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; validateCli?: (path: string) => Promise<void>; }

async function isExecutable(path: string) { try { const info = await stat(path); if (!info.isFile()) return false; await access(path, constants.X_OK); return true; } catch { return false; } }
async function readSettings(path: string): Promise<DesktopSettings> { try { return JSON.parse(await readFile(path, "utf8")) as DesktopSettings; } catch { return {}; } }
async function writeSettings(path: string, value: DesktopSettings) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`); }
function pathCandidates(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform) { const exts = platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""]; return (env.PATH || "").split(delimiter).filter(Boolean).flatMap((dir) => exts.map((ext) => join(dir, `${command}${ext}`))); }
function knownCandidates(kind: CodexToolKind, env: NodeJS.ProcessEnv, platform: NodeJS.Platform) {
  const home = platform === "win32" ? env.USERPROFILE || env.HOME || "" : env.HOME || "";
  if (kind === "cli") return platform === "win32"
    ? [join(home, "AppData", "Local", "Programs", "Codex", "codex.exe"), join(home, "AppData", "Roaming", "npm", "codex.cmd")]
    : ["/opt/homebrew/bin/codex", "/usr/local/bin/codex", join(home, ".local", "bin", "codex")];
  return platform === "win32"
    ? [join(home, "AppData", "Local", "Programs", "Codex", "Codex.exe"), join(home, "AppData", "Local", "Programs", "Codex", "CodexApp.exe")]
    : ["/Applications/Codex.app/Contents/MacOS/Codex", join(home, "Applications", "Codex.app", "Contents", "MacOS", "Codex")];
}
async function firstExecutable(items: string[]) { for (const item of items) if (item && await isExecutable(item)) return item; return ""; }
async function normalizeManualPath(kind: CodexToolKind, value: string, platform: NodeJS.Platform): Promise<string> {
  if (await isExecutable(value)) return value;
  const nested = kind === "app"
    ? platform === "win32"
      ? [join(value, "Codex.exe"), join(value, "CodexApp.exe")]
      : [join(value, "Contents", "MacOS", "Codex")]
    : platform === "win32"
      ? [join(value, "codex.exe"), join(value, "codex.cmd")]
      : [join(value, "codex")];
  return firstExecutable(nested);
}
async function detectPath(kind: CodexToolKind, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Promise<{ path: string; source: CodexToolSource }> {
  const explicit = kind === "cli" ? env.CODEX_SWITCHER_CODEX_BIN || env.CODEX_BIN : env.CODEX_SWITCHER_APP_BIN;
  if (explicit?.trim() && await isExecutable(explicit.trim())) return { path: explicit.trim(), source: "environment" };
  const fromPath = kind === "cli" ? await firstExecutable(pathCandidates("codex", env, platform)) : "";
  if (fromPath) return { path: fromPath, source: "path" };
  const candidate = await firstExecutable(knownCandidates(kind, env, platform));
  return candidate ? { path: candidate, source: "candidate" } : { path: "", source: "missing" };
}
export async function getCodexToolStatus(kind: CodexToolKind, options: CodexToolPathOptions): Promise<CodexToolStatus> {
  const env = options.env ?? process.env; const platform = options.platform ?? process.platform; const settings = await readSettings(options.settingsPath);
  const manualPath = (kind === "cli" ? settings.cliPath : settings.appPath)?.trim() || ""; const detected = await detectPath(kind, env, platform); const manualAvailable = manualPath ? await isExecutable(manualPath) : false;
  return { kind, path: manualAvailable ? manualPath : detected.path, detectedPath: detected.path, manualPath, source: manualAvailable ? "manual" : detected.source, available: manualAvailable || Boolean(detected.path) };
}
export async function listCodexToolStatuses(options: CodexToolPathOptions) { return Promise.all([getCodexToolStatus("cli", options), getCodexToolStatus("app", options)]); }
export async function saveCodexToolPath(kind: CodexToolKind, path: string, options: CodexToolPathOptions) {
  const input = path.trim(); const value = input ? await normalizeManualPath(kind, input, options.platform ?? process.platform) : ""; if (!value) throw new Error(`${kind === "cli" ? "Codex CLI" : "Codex App"} path is not executable: ${input || "(empty)"}`);
  if (kind === "cli") { try { if (options.validateCli) await options.validateCli(value); else if ((options.platform ?? process.platform) === "win32" && /\.(cmd|bat)$/i.test(value)) await execFileAsync("cmd.exe", ["/d", "/s", "/c", `"${value}" --version`], { timeout: 10_000 }); else await execFileAsync(value, ["--version"], { timeout: 10_000 }); } catch (error) { throw new Error(`Codex CLI validation failed: ${error instanceof Error ? error.message : String(error)}`); } }
  const settings = await readSettings(options.settingsPath); if (kind === "cli") settings.cliPath = value; else settings.appPath = value; await writeSettings(options.settingsPath, settings); return getCodexToolStatus(kind, options);
}
export async function resetCodexToolPath(kind: CodexToolKind, options: CodexToolPathOptions) { const settings = await readSettings(options.settingsPath); if (kind === "cli") delete settings.cliPath; else delete settings.appPath; await writeSettings(options.settingsPath, settings); return getCodexToolStatus(kind, options); }
export function buildEffectiveCodexEnv(statuses: CodexToolStatus[], env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv { const cli = statuses.find((x) => x.kind === "cli"); const app = statuses.find((x) => x.kind === "app"); return { ...env, ...(cli?.available ? { CODEX_SWITCHER_CODEX_BIN: cli.path, CODEX_BIN: cli.path } : {}), ...(app?.available ? { CODEX_SWITCHER_APP_BIN: app.path } : {}) }; }
