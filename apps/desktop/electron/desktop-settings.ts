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

export interface GeneratedImageRecoverySettings {
  enabled: boolean;
}

export interface AppEnvironmentBadgeSettings {
  enabled: boolean;
}

export interface AppWindowSettings {
  counts: Record<string, number>;
}

interface DesktopSettingsFile {
  cliPath?: string;
  appPath?: string;
  cliAutoResume?: Partial<CliAutoResumeSettings>;
  routerLifecycle?: Partial<RouterLifecycleSettings>;
  routerPort?: Partial<RouterPortSettings>;
  envHistoryRetention?: Partial<EnvHistoryRetentionSettings>;
  generatedImageRecovery?: Partial<GeneratedImageRecoverySettings>;
  appEnvironmentBadges?: Partial<AppEnvironmentBadgeSettings>;
  appWindowCounts?: Record<string, unknown>;
}

export const DEFAULT_CLI_AUTO_RESUME_SETTINGS: CliAutoResumeSettings = { enabled: false, sessionNumber: 1 };
export const DEFAULT_ROUTER_LIFECYCLE_SETTINGS: RouterLifecycleSettings = { stopOnAppQuit: false };
export const DEFAULT_ROUTER_PORT_SETTINGS: RouterPortSettings = { preferredPort: 17832 };
export const DEFAULT_ENV_HISTORY_RETENTION_SETTINGS: EnvHistoryRetentionSettings = {
  enabled: false,
  retentionDays: 30,
};
export const DEFAULT_GENERATED_IMAGE_RECOVERY_SETTINGS: GeneratedImageRecoverySettings = { enabled: false };
export const DEFAULT_APP_ENVIRONMENT_BADGE_SETTINGS: AppEnvironmentBadgeSettings = { enabled: false };
export const DEFAULT_APP_WINDOW_COUNT = 1;
export const MAX_APP_WINDOW_COUNT = 8;

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

export async function readGeneratedImageRecoverySettings(path: string): Promise<GeneratedImageRecoverySettings> {
  const settings = await readSettings(path);
  return { enabled: settings.generatedImageRecovery?.enabled === true };
}

export async function saveGeneratedImageRecoverySettings(
  path: string,
  value: GeneratedImageRecoverySettings,
): Promise<GeneratedImageRecoverySettings> {
  const normalized = { enabled: value.enabled === true };
  const settings = await readSettings(path);
  settings.generatedImageRecovery = normalized;
  await writeSettings(path, settings);
  return normalized;
}

export async function readAppEnvironmentBadgeSettings(path: string): Promise<AppEnvironmentBadgeSettings> {
  const settings = await readSettings(path);
  return { enabled: settings.appEnvironmentBadges?.enabled === true };
}

export async function saveAppEnvironmentBadgeSettings(
  path: string,
  value: AppEnvironmentBadgeSettings,
): Promise<AppEnvironmentBadgeSettings> {
  const normalized = { enabled: value.enabled === true };
  const settings = await readSettings(path);
  settings.appEnvironmentBadges = normalized;
  await writeSettings(path, settings);
  return normalized;
}

export async function readAppWindowSettings(path: string): Promise<AppWindowSettings> {
  const settings = await readSettings(path);
  return normalizeAppWindowSettings(settings.appWindowCounts);
}

export async function saveAppWindowCount(path: string, envName: string, count: number): Promise<number> {
  const normalizedEnvName = normalizeEnvName(envName);
  const normalizedCount = normalizeAppWindowCount(count);
  const settings = await readSettings(path);
  const current = normalizeAppWindowSettings(settings.appWindowCounts);
  settings.appWindowCounts = { ...current.counts, [normalizedEnvName]: normalizedCount };
  await writeSettings(path, settings);
  return normalizedCount;
}

export async function renameAppWindowCount(path: string, envName: string, nextEnvName: string): Promise<void> {
  const source = normalizeEnvName(envName);
  const target = normalizeEnvName(nextEnvName);
  if (source === target) return;
  const settings = await readSettings(path);
  const current = normalizeAppWindowSettings(settings.appWindowCounts).counts;
  const count = current[source];
  if (count === undefined) return;
  const { [source]: _removed, ...remaining } = current;
  settings.appWindowCounts = { ...remaining, [target]: count };
  await writeSettings(path, settings);
}

export async function removeAppWindowCount(path: string, envName: string): Promise<void> {
  const normalizedEnvName = normalizeEnvName(envName);
  const settings = await readSettings(path);
  const current = normalizeAppWindowSettings(settings.appWindowCounts).counts;
  if (current[normalizedEnvName] === undefined) return;
  const { [normalizedEnvName]: _removed, ...remaining } = current;
  settings.appWindowCounts = remaining;
  await writeSettings(path, settings);
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

function normalizeAppWindowSettings(value?: Record<string, unknown>): AppWindowSettings {
  const counts = Object.fromEntries(
    Object.entries(value ?? {})
      .map(([envName, count]) => [envName.trim(), normalizeAppWindowCount(Number(count))] as const)
      .filter(([envName]) => envName.length > 0),
  );
  return { counts };
}

function normalizeAppWindowCount(value: number): number {
  const count = Math.trunc(value);
  return Number.isFinite(count)
    ? Math.min(MAX_APP_WINDOW_COUNT, Math.max(DEFAULT_APP_WINDOW_COUNT, count))
    : DEFAULT_APP_WINDOW_COUNT;
}

function normalizeEnvName(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("Environment name is required");
  return normalized;
}

async function writeSettings(path: string, settings: DesktopSettingsFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

async function readSettings(path: string): Promise<DesktopSettingsFile> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as DesktopSettingsFile;
  } catch {
    return {};
  }
}
