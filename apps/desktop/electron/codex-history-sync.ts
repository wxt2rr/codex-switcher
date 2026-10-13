import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";

import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

export const CODEX_SWITCHER_PROVIDER_ID = "codex_switcher_router";

export interface CodexHistorySyncResult {
  envName: string;
  providerId: string;
  sessionsScanned: number;
  sessionsUpdated: number;
  threadsUpdated: number;
  backupPath?: string;
  message: string;
}

export interface SyncCodexHistoryOptions {
  envName: string;
  homePath: string;
  stateDir: string;
  isRunning?: () => Promise<boolean>;
  providerId?: string;
}

interface SessionChange {
  path: string;
  updated: Buffer;
}

interface BackupManifest {
  version: 1;
  envName: string;
  providerId: string;
  createdAt: string;
  files: string[];
}

let sqlModule: Promise<SqlJsStatic> | undefined;

function loadSql(): Promise<SqlJsStatic> {
  const moduleAnchor = typeof __filename === "string" ? __filename : join(process.cwd(), "package.json");
  const resolveFromWorkspace = createRequire(moduleAnchor);
  sqlModule ??= initSqlJs({ locateFile: () => resolveFromWorkspace.resolve("sql.js/dist/sql-wasm.wasm") });
  return sqlModule;
}

/**
 * Re-labels Codex's provider metadata without touching message content. The
 * operation is intentionally home-scoped and refuses to run while a managed
 * Codex App instance is active, because SQLite WAL files may otherwise race
 * with the migration.
 */
export async function syncCodexProviderHistory(options: SyncCodexHistoryOptions): Promise<CodexHistorySyncResult> {
  const providerId = options.providerId?.trim() || CODEX_SWITCHER_PROVIDER_ID;
  if (await options.isRunning?.()) {
    throw new Error(`Cannot sync conversation history for '${options.envName}' while Codex is running`);
  }

  const sessionPaths = await listSessionJsonlFiles(join(options.homePath, "sessions"));
  const changes: SessionChange[] = [];
  for (const path of sessionPaths) {
    const original = await readFile(path);
    const updated = rewriteSessionProvider(original, providerId);
    if (updated) changes.push({ path, updated });
  }

  const dbPath = join(options.homePath, "state_5.sqlite");
  const dbExists = await fileExists(dbPath);
  const sidecars: string[] = [];
  for (const suffix of ["-wal", "-shm"]) {
    if (await fileExists(join(options.homePath, `state_5.sqlite${suffix}`))) sidecars.push(suffix);
  }
  const threadsPresent = dbExists ? await hasThreadsProviderColumn(dbPath) : false;
  if (!changes.length && !threadsPresent) {
    return {
      envName: options.envName,
      providerId,
      sessionsScanned: sessionPaths.length,
      sessionsUpdated: 0,
      threadsUpdated: 0,
      message: `No conversation history needed provider migration for ${options.envName}`,
    };
  }

  const backupPath = join(
    options.stateDir,
    "history",
    "provider-sync",
    `${safePathPart(options.envName)}-${Date.now()}-${randomUUID().slice(0, 8)}`,
  );
  await mkdir(backupPath, { recursive: true });

  const manifest: BackupManifest = {
    version: 1,
    envName: options.envName,
    providerId,
    createdAt: new Date().toISOString(),
    files: [],
  };
  const backupFile = async (source: string, relativePath: string) => {
    const destination = join(backupPath, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    manifest.files.push(relativePath);
  };

  try {
    for (const change of changes) {
      await backupFile(change.path, relative(options.homePath, change.path));
    }
    if (dbExists) {
      await backupFile(dbPath, "state_5.sqlite");
      for (const suffix of sidecars) {
        const sidecarPath = join(options.homePath, `state_5.sqlite${suffix}`);
        if (await fileExists(sidecarPath)) await backupFile(sidecarPath, `state_5.sqlite${suffix}`);
      }
    }
    await writeJsonFile(join(backupPath, "manifest.json"), manifest);

    for (const change of changes) await writeFileAtomically(change.path, change.updated);
    let threadsUpdated = 0;
    if (dbExists && threadsPresent) {
      threadsUpdated = await rewriteThreadsProvider(dbPath, providerId);
      // A freshly exported database supersedes WAL/SHM state. Keeping stale
      // sidecars beside it would make SQLite replay old provider values.
      for (const suffix of sidecars) await rm(join(options.homePath, `state_5.sqlite${suffix}`), { force: true });
    }

    return {
      envName: options.envName,
      providerId,
      sessionsScanned: sessionPaths.length,
      sessionsUpdated: changes.length,
      threadsUpdated,
      backupPath,
      message: `Synchronized ${changes.length} conversation files and ${threadsUpdated} thread records for ${options.envName}`,
    };
  } catch (error) {
    await restoreBackup(options.homePath, backupPath, manifest).catch(() => undefined);
    throw error;
  }
}

async function listSessionJsonlFiles(root: string): Promise<string[]> {
  if (!(await fileExists(root))) return [];
  const output: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) output.push(path);
    }
  };
  await visit(root);
  return output.sort();
}

function rewriteSessionProvider(content: Buffer, providerId: string): Buffer | undefined {
  const text = content.toString("utf8");
  const lines = text.split(/(\r?\n)/);
  let changed = false;
  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index];
    if (!line?.trim()) continue;
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      if (record.type !== "session_meta") continue;
      const payload = record.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
      const metadata = payload as Record<string, unknown>;
      if (metadata.model_provider === providerId) return undefined;
      if (typeof metadata.model_provider !== "string") continue;
      lines[index] = JSON.stringify({ ...record, payload: { ...metadata, model_provider: providerId } });
      changed = true;
      break;
    } catch {
      // A malformed later record is unrelated to the metadata header. Leave it
      // intact and continue looking for the first valid session_meta record.
    }
  }
  return changed ? Buffer.from(lines.join(""), "utf8") : undefined;
}

async function hasThreadsProviderColumn(path: string): Promise<boolean> {
  const db = await openDatabase(path);
  try {
    const rows = db.exec("PRAGMA table_info(threads)");
    const columns = rows[0]?.values ?? [];
    return columns.some((row) => String(row[1] ?? "") === "model_provider");
  } finally {
    db.close();
  }
}

async function rewriteThreadsProvider(path: string, providerId: string): Promise<number> {
  const db = await openDatabase(path);
  try {
    db.run("BEGIN TRANSACTION");
    db.run("UPDATE threads SET model_provider = ? WHERE model_provider IS NOT ?", [providerId, providerId]);
    const changed = db.getRowsModified();
    db.run("COMMIT");
    const exported = Buffer.from(db.export());
    await writeFileAtomically(path, exported);
    return changed;
  } catch (error) {
    try { db.run("ROLLBACK"); } catch { /* transaction may already be closed */ }
    throw error;
  } finally {
    db.close();
  }
}

async function openDatabase(path: string): Promise<Database> {
  const SQL = await loadSql();
  return new SQL.Database(new Uint8Array(await readFile(path)));
}

async function restoreBackup(homePath: string, backupPath: string, manifest: BackupManifest): Promise<void> {
  for (const relativePath of manifest.files) {
    const source = join(backupPath, relativePath);
    const destination = join(homePath, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeFileAtomically(path: string, data: Buffer): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const mode = await stat(path).then((value) => value.mode & 0o777).catch(() => undefined);
  await writeFile(temporary, data, mode === undefined ? undefined : { mode });
  try {
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function safePathPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "_") || "environment";
}
