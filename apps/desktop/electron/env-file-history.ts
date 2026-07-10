import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type EnvFileType = "config.toml" | "auth.json";
export type EnvFileHistorySource = "manual" | "switch-cli" | "switch-app" | "restore";

export interface EnvFileSnapshot {
  configToml: string;
  authJson: string;
}

export interface EnvFileHistoryEntry {
  id: string;
  envName: string;
  fileType: EnvFileType;
  source: EnvFileHistorySource;
  createdAt: string;
  content: string;
}

export async function readEnvFileSnapshot(envPath: string): Promise<EnvFileSnapshot> {
  return {
    configToml: await readText(join(envPath, "config.toml")),
    authJson: await readText(join(envPath, "auth.json")),
  };
}

export async function appendEnvFileHistoryEntry(options: {
  stateDir: string;
  envName: string;
  fileType: EnvFileType;
  source: EnvFileHistorySource;
  content: string;
}): Promise<EnvFileHistoryEntry> {
  const entry: EnvFileHistoryEntry = {
    id: randomUUID(),
    envName: options.envName,
    fileType: options.fileType,
    source: options.source,
    createdAt: new Date().toISOString(),
    content: options.content,
  };
  const path = getHistoryEntryPath(options.stateDir, options.envName, entry.id);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
  return entry;
}

export async function listEnvFileHistoryEntries(stateDir: string, envName: string): Promise<EnvFileHistoryEntry[]> {
  const dir = getHistoryDir(stateDir, envName);
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const entries = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        try {
          const raw = await readFile(join(dir, name), "utf8");
          return JSON.parse(raw) as EnvFileHistoryEntry;
        } catch {
          return null;
        }
      }),
  );

  return entries
    .filter((entry): entry is EnvFileHistoryEntry => entry !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteEnvFileHistoryEntries(stateDir: string, envName: string, ids: string[]): Promise<number> {
  const uniqueIds = Array.from(new Set(ids.map((item) => item.trim()).filter(Boolean)));
  await Promise.all(
    uniqueIds.map((id) => rm(getHistoryEntryPath(stateDir, envName, id), { force: true })),
  );
  return uniqueIds.length;
}

function getHistoryDir(stateDir: string, envName: string): string {
  return join(stateDir, "history", "env-files", envName);
}

function getHistoryEntryPath(stateDir: string, envName: string, id: string): string {
  return join(getHistoryDir(stateDir, envName), `${id}.json`);
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}
