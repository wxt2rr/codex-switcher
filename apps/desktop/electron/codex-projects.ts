import { basename, join, resolve } from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";

export interface CodexProject {
  path: string;
  name: string;
  lastUsedAt?: string;
}

export interface CodexResumeSession {
  id: string;
  cwd: string;
  updatedAt: string;
  path: string;
}

export async function findCodexResumeSession(
  codexHome: string,
  cwd: string,
  sessionNumber: number,
): Promise<CodexResumeSession | undefined> {
  if (!Number.isInteger(sessionNumber) || sessionNumber < 1) return undefined;
  const activity = await readSessionActivity(join(codexHome, "session_index.jsonl"));
  const paths = await listJsonlFiles(join(codexHome, "sessions"));
  const normalizedCwd = normalizePath(cwd);
  const sessions: CodexResumeSession[] = [];

  for (const path of paths) {
    const line = (await readText(path)).split(/\r?\n/, 1)[0] ?? "";
    try {
      const value = JSON.parse(line) as {
        type?: unknown;
        timestamp?: unknown;
        payload?: { id?: unknown; cwd?: unknown; timestamp?: unknown };
      };
      if (value.type !== "session_meta") continue;
      const id = typeof value.payload?.id === "string" ? value.payload.id : "";
      const sessionCwd = typeof value.payload?.cwd === "string" ? value.payload.cwd : "";
      if (!id || !sessionCwd || normalizePath(sessionCwd) !== normalizedCwd) continue;
      const fallback = typeof value.timestamp === "string"
        ? value.timestamp
        : typeof value.payload?.timestamp === "string" ? value.payload.timestamp : "";
      sessions.push({ id, cwd: sessionCwd, updatedAt: activity.get(id) ?? fallback, path });
    } catch {
      // Ignore partial or corrupt session files.
    }
  }

  sessions.sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
  return sessions[sessionNumber - 1];
}

export async function readCodexProjects(codexHome: string): Promise<CodexProject[]> {
  const config = await readText(join(codexHome, "config.toml"));
  if (!config) return [];

  const paths = [...config.matchAll(/^\s*\[projects\."((?:[^"\\]|\\.)*)"\]\s*$/gm)]
    .map((match) => decodeTomlString(match[1] ?? ""))
    .filter((path, index, items) => Boolean(path) && items.indexOf(path) === index);
  const recent = await readRecentProjects(join(codexHome, "session_index.jsonl"));
  const projects: CodexProject[] = [];

  for (const path of paths) {
    try {
      if (!(await stat(path)).isDirectory()) continue;
    } catch {
      continue;
    }
    projects.push({ path, name: basename(path) || path, lastUsedAt: recent.get(path) });
  }

  return projects.sort((left, right) => {
    const leftTime = left.lastUsedAt ? Date.parse(left.lastUsedAt) : 0;
    const rightTime = right.lastUsedAt ? Date.parse(right.lastUsedAt) : 0;
    return rightTime - leftTime;
  });
}

async function readRecentProjects(path: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const content = await readText(path);
  for (const line of content.split(/\r?\n/)) {
    try {
      const value = JSON.parse(line) as { cwd?: unknown; updated_at?: unknown };
      if (typeof value.cwd !== "string" || typeof value.updated_at !== "string") continue;
      const timestamp = new Date(value.updated_at);
      if (Number.isNaN(timestamp.getTime())) continue;
      const normalized = timestamp.toISOString();
      if (!result.has(value.cwd) || normalized > (result.get(value.cwd) ?? "")) result.set(value.cwd, normalized);
    } catch {
      // Ignore partial or legacy index records.
    }
  }
  return result;
}

async function readSessionActivity(path: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const content = await readText(path);
  for (const line of content.split(/\r?\n/)) {
    try {
      const value = JSON.parse(line) as { id?: unknown; updated_at?: unknown };
      if (typeof value.id !== "string" || typeof value.updated_at !== "string") continue;
      const timestamp = new Date(value.updated_at);
      if (!Number.isNaN(timestamp.getTime())) result.set(value.id, timestamp.toISOString());
    } catch {
      // Ignore partial index records.
    }
  }
  return result;
}

async function listJsonlFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await listJsonlFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) result.push(path);
  }
  return result;
}

function normalizePath(path: string): string {
  const normalized = resolve(path).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function decodeTomlString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}
