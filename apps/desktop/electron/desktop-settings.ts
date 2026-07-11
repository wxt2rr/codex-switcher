import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface CliAutoResumeSettings {
  enabled: boolean;
  sessionNumber: number;
}

interface DesktopSettingsFile {
  cliPath?: string;
  appPath?: string;
  cliAutoResume?: Partial<CliAutoResumeSettings>;
}

export const DEFAULT_CLI_AUTO_RESUME_SETTINGS: CliAutoResumeSettings = { enabled: false, sessionNumber: 1 };

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

function normalizeCliAutoResumeSettings(value?: Partial<CliAutoResumeSettings>): CliAutoResumeSettings {
  const sessionNumber = Number(value?.sessionNumber);
  return {
    enabled: value?.enabled === true,
    sessionNumber: Number.isInteger(sessionNumber) && sessionNumber >= 1 ? sessionNumber : 1,
  };
}

async function readSettings(path: string): Promise<DesktopSettingsFile> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as DesktopSettingsFile;
  } catch {
    return {};
  }
}
