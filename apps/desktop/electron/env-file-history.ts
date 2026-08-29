import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type EnvFileType = "config.toml" | "auth.json";
export type EnvFileHistorySource = "manual" | "switch-cli" | "switch-app" | "restore" | "migration";

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

export interface EnvFileHistoryCleanupResult {
  scanned: number;
  deleted: number;
  cutoff: string;
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

export async function deleteExpiredEnvFileHistoryEntries(
  stateDir: string,
  retentionDays: number,
  now = new Date(),
): Promise<EnvFileHistoryCleanupResult> {
  const normalizedDays = Math.min(365, Math.max(1, Math.trunc(retentionDays) || 1));
  const cutoffDate = new Date(now.getTime() - normalizedDays * 24 * 60 * 60 * 1_000);
  const root = join(stateDir, "history", "env-files");
  let environmentDirectories: Array<{ name: string; isDirectory(): boolean }> = [];
  try {
    environmentDirectories = await readdir(root, { withFileTypes: true });
  } catch {
    return { scanned: 0, deleted: 0, cutoff: cutoffDate.toISOString() };
  }

  let scanned = 0;
  let deleted = 0;
  await Promise.all(environmentDirectories.filter((entry) => entry.isDirectory()).map(async (directory) => {
    const envDir = join(root, directory.name);
    const names = await readdir(envDir).catch(() => [] as string[]);
    await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => {
      scanned += 1;
      const path = join(envDir, name);
      try {
        const entry = JSON.parse(await readFile(path, "utf8")) as Partial<EnvFileHistoryEntry>;
        const createdAt = typeof entry.createdAt === "string" ? Date.parse(entry.createdAt) : Number.NaN;
        if (Number.isFinite(createdAt) && createdAt < cutoffDate.getTime()) {
          await rm(path, { force: true });
          deleted += 1;
        }
      } catch {
        // Keep malformed entries because their age cannot be established safely.
      }
    }));
  }));

  return { scanned, deleted, cutoff: cutoffDate.toISOString() };
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
