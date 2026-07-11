import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CliTerminalId = "iterm" | "terminal" | "warp" | "ghostty" | "windows-terminal" | "powershell7" | "windows-powershell" | "command-prompt";
export interface CliTerminalOption { id: CliTerminalId; label: string; supportsCurrentWindow: boolean; iconPath?: string; }
export interface CliTerminalSettings { selectedId: CliTerminalId; terminals: CliTerminalOption[]; }
interface Options { settingsPath: string; platform?: NodeJS.Platform; pathExists?: (path: string) => Promise<boolean>; commandExists?: (command: string) => Promise<boolean>; }

const MAC_TERMINALS: Array<CliTerminalOption & { paths: string[] }> = [
  { id: "iterm", label: "iTerm", supportsCurrentWindow: true, paths: ["/Applications/iTerm.app", "/Applications/iTerm2.app"] },
  { id: "terminal", label: "Terminal", supportsCurrentWindow: true, paths: ["/System/Applications/Utilities/Terminal.app", "/Applications/Utilities/Terminal.app"] },
  { id: "warp", label: "Warp", supportsCurrentWindow: false, paths: ["/Applications/Warp.app"] },
  { id: "ghostty", label: "Ghostty", supportsCurrentWindow: false, paths: ["/Applications/Ghostty.app"] },
];
const WINDOWS_TERMINALS: Array<CliTerminalOption & { command?: string; system?: boolean }> = [
  { id: "windows-terminal", label: "Windows Terminal", supportsCurrentWindow: false, command: "wt.exe" },
  { id: "powershell7", label: "PowerShell 7", supportsCurrentWindow: false, command: "pwsh.exe" },
  { id: "windows-powershell", label: "Windows PowerShell", supportsCurrentWindow: false, system: true },
  { id: "command-prompt", label: "Command Prompt", supportsCurrentWindow: false, system: true },
];

async function defaultPathExists(path: string) { try { await access(path); return true; } catch { return false; } }
async function defaultCommandExists(command: string) { try { await execFileAsync(process.platform === "win32" ? "where.exe" : "which", [command]); return true; } catch { return false; } }
async function readSettings(path: string): Promise<Record<string, unknown>> { try { return JSON.parse(await readFile(path, "utf8")); } catch { return {}; } }
async function writeSettings(path: string, settings: Record<string, unknown>) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8"); }

export async function scanCliTerminals(options: Options): Promise<CliTerminalOption[]> {
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    const exists = options.pathExists ?? defaultPathExists;
    const found: CliTerminalOption[] = [];
    for (const item of MAC_TERMINALS) {
      const checks = await Promise.all(item.paths.map(exists));
      const iconPath = item.paths[checks.findIndex(Boolean)];
      if (iconPath) found.push({ id: item.id, label: item.label, supportsCurrentWindow: item.supportsCurrentWindow, iconPath });
    }
    if (!found.some((item) => item.id === "terminal")) found.splice(Math.min(1, found.length), 0, { id: "terminal", label: "Terminal", supportsCurrentWindow: true, iconPath: "/System/Applications/Utilities/Terminal.app" });
    return found;
  }
  if (platform === "win32") {
    const exists = options.commandExists ?? defaultCommandExists;
    const found: CliTerminalOption[] = [];
    for (const item of WINDOWS_TERMINALS) if (item.system || (item.command && await exists(item.command))) found.push({ id: item.id, label: item.label, supportsCurrentWindow: false, iconPath: item.command });
    return found;
  }
  return [];
}

export async function getCliTerminalSettings(options: Options): Promise<CliTerminalSettings> {
  const terminals = await scanCliTerminals(options);
  if (!terminals.length) throw new Error("No supported terminal application was found");
  const settings = await readSettings(options.settingsPath);
  const configured = terminals.find((item) => item.id === settings.cliTerminalId);
  const selectedId = configured?.id ?? terminals[0]!.id;
  if (settings.cliTerminalId !== selectedId) { settings.cliTerminalId = selectedId; await writeSettings(options.settingsPath, settings); }
  return { selectedId, terminals };
}

export async function saveCliTerminalSelection(settingsPath: string, selectedId: CliTerminalId, terminals: CliTerminalOption[]): Promise<CliTerminalSettings> {
  if (!terminals.some((item) => item.id === selectedId)) throw new Error(`Terminal ${selectedId} is not available`);
  const settings = await readSettings(settingsPath); settings.cliTerminalId = selectedId; await writeSettings(settingsPath, settings);
  return { selectedId, terminals };
}
