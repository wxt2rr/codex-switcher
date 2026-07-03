import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { delimiter, join } from "node:path";

import { detectPlatform } from "./os.js";
import { executableCandidates, getPlatformRuntime, resolveHomeDir } from "./runtime.js";

export interface ResolvedCommand {
  source: "env" | "candidate";
  path: string;
}

export interface WindowsLauncherCommandStatus {
  command: string;
  resolved: ResolvedCommand | null;
}

export interface WindowsReadinessSnapshot {
  launchers: WindowsLauncherCommandStatus[];
  cliCandidates: string[];
  appCandidates: string[];
  shellInitFiles: string[];
}

export async function resolveCommandPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): Promise<ResolvedCommand | null> {
  const pathValue = env.PATH || "";
  const dirs = pathValue.split(delimiter).filter(Boolean);

  for (const dir of dirs) {
    for (const candidate of executableCandidates(command, platform)) {
      const fullPath = join(dir, candidate);
      if (await isExecutable(fullPath)) {
        return { source: "env", path: fullPath };
      }
    }
  }

  for (const candidate of codexCliCandidatePaths(env, platform)) {
    if (await isExecutable(candidate)) {
      return { source: "candidate", path: candidate };
    }
  }

  return null;
}

export async function resolveCodexAppPath(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): Promise<string | null> {
  if (env.CODEX_SWITCHER_APP_BIN) {
    return (await isExecutable(env.CODEX_SWITCHER_APP_BIN)) ? env.CODEX_SWITCHER_APP_BIN : null;
  }

  for (const candidate of codexAppCandidatePaths(env, platform)) {
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function resolveWindowsLauncherCommands(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): Promise<WindowsLauncherCommandStatus[]> {
  const commands = ["wt", "powershell", "cmd"];
  return Promise.all(
    commands.map(async (command) => ({
      command: `${command}.exe`,
      resolved: await resolveCommandPath(command, env, platform),
    })),
  );
}

export async function getWindowsReadinessSnapshot(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): Promise<WindowsReadinessSnapshot> {
  return {
    launchers: await resolveWindowsLauncherCommands(env, platform),
    cliCandidates: codexCliCandidatePaths(env, platform),
    appCandidates: codexAppCandidatePaths(env, platform),
    shellInitFiles: getPlatformRuntime(env, platform).shellInitFiles,
  };
}

export function codexCliCandidatePaths(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): string[] {
  if (env.CODEX_SWITCHER_CODEX_BIN) {
    return [env.CODEX_SWITCHER_CODEX_BIN];
  }

  const runtime = getPlatformRuntime(env, platform);
  const homeDir = runtime.paths.homeDir;

  if (runtime.platform === "windows") {
    return [
      join(homeDir, "AppData", "Local", "Programs", "Codex", "codex.exe"),
      join(homeDir, "AppData", "Local", "Programs", "Codex", "resources", "codex.exe"),
    ];
  }

  return [
    "/Applications/Codex.app/Contents/Resources/codex",
    join(homeDir, "Applications", "Codex.app", "Contents", "Resources", "codex"),
  ];
}

export function codexAppCandidatePaths(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): string[] {
  const homeDir = resolveHomeDir(env, platform);
  const normalized = detectPlatform(platform);

  if (normalized === "windows") {
    return [
      join(homeDir, "AppData", "Local", "Programs", "Codex", "Codex.exe"),
      join(homeDir, "AppData", "Local", "Programs", "Codex", "CodexApp.exe"),
    ];
  }

  return [
    "/Applications/Codex.app/Contents/MacOS/Codex",
    join(homeDir, "Applications", "Codex.app", "Contents", "MacOS", "Codex"),
  ];
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}
