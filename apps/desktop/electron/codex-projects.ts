import { basename, join } from "node:path";
import { readFile, stat } from "node:fs/promises";

export interface CodexProject {
  path: string;
  name: string;
  lastUsedAt?: string;
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
