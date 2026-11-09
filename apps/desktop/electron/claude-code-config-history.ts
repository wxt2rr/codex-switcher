import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ClaudeCodeConfigHistorySource = "connect" | "disconnect" | "restore" | "migration" | "authorization_cleanup";

export interface ClaudeCodeConfigHistoryEntry {
  id: string;
  configPath: string;
  source: ClaudeCodeConfigHistorySource;
  createdAt: string;
  content: string;
}

export interface ClaudeCodeConfigHistoryPreview {
  id: string;
  configPath: string;
  source: ClaudeCodeConfigHistorySource;
  createdAt: string;
  contentPreview: string;
}

export interface ClaudeCodeConfigHistoryCleanupResult {
  scanned: number;
  deleted: number;
  cutoff: string;
}

const HISTORY_NAMESPACE = "claude-code";

export async function appendClaudeCodeConfigHistoryEntry(options: {
  stateDir: string;
  configPath: string;
  source: ClaudeCodeConfigHistorySource;
  content: string;
}): Promise<ClaudeCodeConfigHistoryEntry> {
  const entry: ClaudeCodeConfigHistoryEntry = {
    id: randomUUID(),
    configPath: options.configPath,
    source: options.source,
    createdAt: new Date().toISOString(),
    content: options.content,
  };
  const path = getHistoryEntryPath(options.stateDir, entry.id);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700).catch(() => undefined);
  await writeFile(path, `${JSON.stringify(entry, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
  return entry;
}

export async function listClaudeCodeConfigHistoryEntries(stateDir: string): Promise<ClaudeCodeConfigHistoryEntry[]> {
  const dir = getHistoryDir(stateDir);
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const entries = await Promise.all(
    names
      .filter((name) => name.endsWith(".json") && isSafeHistoryId(name.slice(0, -5)))
      .map(async (name) => {
        try {
          const value = JSON.parse(await readFile(join(dir, name), "utf8")) as Partial<ClaudeCodeConfigHistoryEntry>;
          if (!isHistoryEntry(value)) return null;
          return value;
        } catch {
          return null;
        }
      }),
  );

  return entries
    .filter((entry): entry is ClaudeCodeConfigHistoryEntry => entry !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function deleteClaudeCodeConfigHistoryEntries(stateDir: string, ids: string[]): Promise<number> {
  const uniqueIds = Array.from(new Set(ids.map((item) => item.trim()).filter(isSafeHistoryId)));
  await Promise.all(uniqueIds.map((id) => rm(getHistoryEntryPath(stateDir, id), { force: true })));
  return uniqueIds.length;
}

export async function deleteExpiredClaudeCodeConfigHistoryEntries(
  stateDir: string,
  retentionDays: number,
  now = new Date(),
): Promise<ClaudeCodeConfigHistoryCleanupResult> {
  const normalizedDays = Math.min(365, Math.max(1, Math.trunc(retentionDays) || 1));
  const cutoffDate = new Date(now.getTime() - normalizedDays * 24 * 60 * 60 * 1_000);
  const dir = getHistoryDir(stateDir);
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return { scanned: 0, deleted: 0, cutoff: cutoffDate.toISOString() };
  }

  let scanned = 0;
  let deleted = 0;
  await Promise.all(names.filter((name) => name.endsWith(".json") && isSafeHistoryId(name.slice(0, -5))).map(async (name) => {
    scanned += 1;
    const path = join(dir, name);
    try {
      const value = JSON.parse(await readFile(path, "utf8")) as Partial<ClaudeCodeConfigHistoryEntry>;
      const createdAt = typeof value.createdAt === "string" ? Date.parse(value.createdAt) : Number.NaN;
      if (Number.isFinite(createdAt) && createdAt < cutoffDate.getTime()) {
        await rm(path, { force: true });
        deleted += 1;
      }
    } catch {
      // Keep malformed entries because their age cannot be established safely.
    }
  }));

  return { scanned, deleted, cutoff: cutoffDate.toISOString() };
}

export function toClaudeCodeConfigHistoryPreview(entry: ClaudeCodeConfigHistoryEntry): ClaudeCodeConfigHistoryPreview {
  return {
    id: entry.id,
    configPath: entry.configPath,
    source: entry.source,
    createdAt: entry.createdAt,
    contentPreview: redactConfigContent(entry.content),
  };
}

export function redactConfigContent(content: string): string {
  return content.replace(
    /(\"[^\"]*(?:key|token|secret|password)[^\"]*\"\s*:\s*\")([^\"]*)(\")/gi,
    (_match, prefix: string, _secret: string, suffix: string) => `${prefix}••••${suffix}`,
  );
}

function getHistoryDir(stateDir: string): string {
  return join(stateDir, "history", "agent-files", HISTORY_NAMESPACE);
}

function getHistoryEntryPath(stateDir: string, id: string): string {
  return join(getHistoryDir(stateDir), `${id}.json`);
}

function isSafeHistoryId(value: string): boolean {
  return /^[a-zA-Z0-9-]{8,80}$/.test(value);
}

function isHistoryEntry(value: Partial<ClaudeCodeConfigHistoryEntry>): value is ClaudeCodeConfigHistoryEntry {
  return typeof value.id === "string"
    && isSafeHistoryId(value.id)
    && typeof value.configPath === "string"
    && (value.source === "connect" || value.source === "disconnect" || value.source === "restore" || value.source === "migration" || value.source === "authorization_cleanup")
    && typeof value.createdAt === "string"
    && typeof value.content === "string";
}
