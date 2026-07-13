import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface CliAutoResumeSettings {
  enabled: boolean;
  sessionNumber: number;
}

export interface RouterLifecycleSettings {
  stopOnAppQuit: boolean;
}

export interface RouterPortSettings {
  preferredPort: number;
}

export interface EnvHistoryRetentionSettings {
  enabled: boolean;
  retentionDays: number;
}

interface DesktopSettingsFile {
  cliPath?: string;
  appPath?: string;
  cliAutoResume?: Partial<CliAutoResumeSettings>;
  routerLifecycle?: Partial<RouterLifecycleSettings>;
  routerPort?: Partial<RouterPortSettings>;
  envHistoryRetention?: Partial<EnvHistoryRetentionSettings>;
}

export const DEFAULT_CLI_AUTO_RESUME_SETTINGS: CliAutoResumeSettings = { enabled: false, sessionNumber: 1 };
export const DEFAULT_ROUTER_LIFECYCLE_SETTINGS: RouterLifecycleSettings = { stopOnAppQuit: false };
export const DEFAULT_ROUTER_PORT_SETTINGS: RouterPortSettings = { preferredPort: 17832 };
export const DEFAULT_ENV_HISTORY_RETENTION_SETTINGS: EnvHistoryRetentionSettings = {
  enabled: false,
  retentionDays: 30,
};

export async function readCliAutoResumeSettings(path: string): Promise<CliAutoResumeSettings> {
  const settings = await readSettings(path);
  return normalizeCliAutoResumeSettings(settings.cliAutoResume);
}

export async function saveCliAutoResumeSettings(path: string, value: CliAutoResumeSettings): Promise<CliAutoResumeSettings> {
  const normalized = normalizeCliAutoResumeSettings(value);
  const settings = await readSettings(path);
  settings.cliAutoResume = normalized;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return normalized;
}

export async function readRouterLifecycleSettings(path: string): Promise<RouterLifecycleSettings> {
  const settings = await readSettings(path);
  return { stopOnAppQuit: settings.routerLifecycle?.stopOnAppQuit === true };
}

export async function saveRouterLifecycleSettings(
  path: string,
  value: RouterLifecycleSettings,
): Promise<RouterLifecycleSettings> {
  const normalized = { stopOnAppQuit: value.stopOnAppQuit === true };
  const settings = await readSettings(path);
  settings.routerLifecycle = normalized;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return normalized;
}

export async function readRouterPortSettings(path: string): Promise<RouterPortSettings> {
  const settings = await readSettings(path);
  return normalizeRouterPortSettings(settings.routerPort);
}

export async function saveRouterPortSettings(
  path: string,
  value: RouterPortSettings,
): Promise<RouterPortSettings> {
  const normalized = normalizeRouterPortSettings(value);
  const settings = await readSettings(path);
  settings.routerPort = normalized;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return normalized;
}

export async function readEnvHistoryRetentionSettings(path: string): Promise<EnvHistoryRetentionSettings> {
  const settings = await readSettings(path);
  return normalizeEnvHistoryRetentionSettings(settings.envHistoryRetention);
}

export async function saveEnvHistoryRetentionSettings(
  path: string,
  value: EnvHistoryRetentionSettings,
): Promise<EnvHistoryRetentionSettings> {
  const normalized = normalizeEnvHistoryRetentionSettings(value);
  const settings = await readSettings(path);
  settings.envHistoryRetention = normalized;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return normalized;
}

function normalizeCliAutoResumeSettings(value?: Partial<CliAutoResumeSettings>): CliAutoResumeSettings {
  const sessionNumber = Number(value?.sessionNumber);
  return {
    enabled: value?.enabled === true,
    sessionNumber: Number.isInteger(sessionNumber) && sessionNumber >= 1 ? sessionNumber : 1,
  };
}

function normalizeEnvHistoryRetentionSettings(
  value?: Partial<EnvHistoryRetentionSettings>,
): EnvHistoryRetentionSettings {
  const retentionDays = Math.trunc(Number(value?.retentionDays));
  return {
    enabled: value?.enabled === true,
    retentionDays: Number.isFinite(retentionDays)
      ? Math.min(365, Math.max(1, retentionDays))
      : DEFAULT_ENV_HISTORY_RETENTION_SETTINGS.retentionDays,
  };
}

function normalizeRouterPortSettings(value?: Partial<RouterPortSettings>): RouterPortSettings {
  const preferredPort = Math.trunc(Number(value?.preferredPort));
  return {
    preferredPort: Number.isFinite(preferredPort) && preferredPort >= 1024 && preferredPort <= 65535
      ? preferredPort
      : DEFAULT_ROUTER_PORT_SETTINGS.preferredPort,
  };
}

async function readSettings(path: string): Promise<DesktopSettingsFile> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as DesktopSettingsFile;
  } catch {
    return {};
  }
}
