import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative } from "node:path";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";

import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

export const CODEX_SWITCHER_PROVIDER_ID = "codex_switcher_router";

export type CodexConversationRepairStatus =
  | "already-current"
  | "repairable"
  | "provider-missing"
  | "model-mismatch"
  | "metadata-mismatch"
  | "incomplete";

export interface CodexConversationRepairEnvironment {
  envName: string;
  homePath: string;
  gatewayEnabled?: boolean;
}

export interface CodexConversationCandidate {
  envName: string;
  homePath: string;
  stateDbPath?: string;
  sessionPath?: string;
  recordedProvider?: string;
  recordedModel?: string;
  cwd?: string;
  currentProvider?: string;
  currentModel?: string;
  targetProvider: string;
  gatewayEnabled: boolean;
  providerMatches: boolean;
  modelMatches?: boolean;
  metadataConsistent: boolean;
  canRepair: boolean;
  status: CodexConversationRepairStatus;
  statusMessage: string;
}

export interface CodexConversationInspectionResult {
  conversationId: string;
  status: "not-found" | "found" | "ambiguous";
  candidates: CodexConversationCandidate[];
  message: string;
}

export interface CodexConversationRepairOptions {
  conversationId: string;
  envName?: string;
  targetProviderId?: string;
  environments: CodexConversationRepairEnvironment[];
  stateDir: string;
  isRunning?: (envName: string) => Promise<boolean>;
}

export interface CodexConversationRepairResult {
  conversationId: string;
  envName: string;
  sessionPath?: string;
  stateDbPath?: string;
  previousProvider?: string;
  providerId: string;
  filesUpdated: string[];
  backupPath?: string;
  message: string;
}

interface ThreadRecord {
  id: string;
  modelProvider?: string;
  model?: string;
  cwd?: string;
  rolloutPath?: string;
}

interface SessionMetadata {
  id: string;
  modelProvider?: string;
  model?: string;
  cwd?: string;
}

interface SessionMatch {
  path: string;
  metadata: SessionMetadata;
}

interface ConfigSummary {
  modelProvider?: string;
  model?: string;
}

interface BackupManifest {
  version: 1;
  conversationId: string;
  envName: string;
  providerId: string;
  createdAt: string;
  files: string[];
}

let sqlModule: Promise<SqlJsStatic> | undefined;

/** Accept both the raw thread UUID and Codex's deep-link representation. */
export function normalizeCodexConversationId(value: string): string {
  const input = value.trim();
  const match = input.match(/^codex:\/\/threads\/([^/?#]+)(?:[/?#].*)?$/i);
  if (!match) return input;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return match[1]!;
  }
}

function loadSql(): Promise<SqlJsStatic> {
  const moduleAnchor = typeof __filename === "string" ? __filename : join(process.cwd(), "package.json");
  const resolveFromWorkspace = createRequire(moduleAnchor);
  sqlModule ??= initSqlJs({ locateFile: () => resolveFromWorkspace.resolve("sql.js/dist/sql-wasm.wasm") });
  return sqlModule;
}

export async function inspectCodexConversation(
  conversationId: string,
  environments: CodexConversationRepairEnvironment[],
): Promise<CodexConversationInspectionResult> {
  const normalizedId = normalizeCodexConversationId(conversationId);
  if (!normalizedId) throw new Error("Conversation ID is required");

  const candidates: CodexConversationCandidate[] = [];
  for (const environment of environments) {
    const homePath = environment.homePath.trim();
    if (!homePath) continue;
    const candidate = await inspectEnvironmentConversation(normalizedId, environment);
    if (candidate) candidates.push(candidate);
  }

  if (candidates.length === 0) {
    return {
      conversationId: normalizedId,
      status: "not-found",
      candidates: [],
      message: `Conversation '${normalizedId}' was not found in the configured Codex environments`,
    };
  }

  if (candidates.length > 1) {
    return {
      conversationId: normalizedId,
      status: "ambiguous",
      candidates,
      message: `Conversation '${normalizedId}' was found in ${candidates.length} configured environments`,
    };
  }

  return {
    conversationId: normalizedId,
    status: "found",
    candidates,
    message: candidates[0]!.statusMessage,
  };
}

export async function repairCodexConversation(
  options: CodexConversationRepairOptions,
): Promise<CodexConversationRepairResult> {
  const normalizedId = normalizeCodexConversationId(options.conversationId);
  if (!normalizedId) throw new Error("Conversation ID is required");

  const inspection = await inspectCodexConversation(normalizedId, options.environments);
  const matches = options.envName
    ? inspection.candidates.filter((candidate) => candidate.envName === options.envName)
    : inspection.candidates;
  if (matches.length === 0) {
    throw new Error(inspection.message);
  }
  if (matches.length > 1) {
    throw new Error(`Conversation '${normalizedId}' matches multiple environments; select one environment first`);
  }

  const candidate = matches[0]!;
  if (!candidate.sessionPath && !candidate.stateDbPath) {
    throw new Error(`Conversation '${normalizedId}' has no editable session metadata`);
  }
  if (candidate.status === "already-current") {
    return {
      conversationId: normalizedId,
      envName: candidate.envName,
      sessionPath: candidate.sessionPath,
      stateDbPath: candidate.stateDbPath,
      previousProvider: candidate.recordedProvider,
      providerId: candidate.targetProvider,
      filesUpdated: [],
      message: `Conversation '${normalizedId}' already uses provider '${candidate.targetProvider}'`,
    };
  }
  if (!candidate.canRepair) {
    throw new Error(candidate.statusMessage);
  }
  if (await options.isRunning?.(candidate.envName)) {
    throw new Error(`Cannot repair conversation '${normalizedId}' while Codex is running in '${candidate.envName}'`);
  }

  const providerId = options.targetProviderId?.trim() || candidate.targetProvider;
  if (!providerId) throw new Error(`No current provider is configured for '${candidate.envName}'`);
  if (providerId !== candidate.targetProvider) {
    throw new Error(`Provider '${providerId}' is not the current provider for '${candidate.envName}'`);
  }

  const backupPath = join(
    options.stateDir,
    "history",
    "provider-repair",
    `${safePathPart(candidate.envName)}-${safePathPart(normalizedId)}-${Date.now()}-${randomUUID().slice(0, 8)}`,
  );
  await mkdir(backupPath, { recursive: true });
  const manifest: BackupManifest = {
    version: 1,
    conversationId: normalizedId,
    envName: candidate.envName,
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

  const sidecars: string[] = [];
  if (candidate.stateDbPath) {
    for (const suffix of ["-wal", "-shm"]) {
      if (await fileExists(`${candidate.stateDbPath}${suffix}`)) sidecars.push(suffix);
    }
  }

  try {
    if (candidate.sessionPath) {
      await backupFile(candidate.sessionPath, relative(candidate.homePath, candidate.sessionPath));
    }
    if (candidate.stateDbPath) {
      await backupFile(candidate.stateDbPath, "state_5.sqlite");
      for (const suffix of sidecars) {
        await backupFile(`${candidate.stateDbPath}${suffix}`, `state_5.sqlite${suffix}`);
      }
    }
    await writeJsonFile(join(backupPath, "manifest.json"), manifest);

    const filesUpdated: string[] = [];
    if (candidate.sessionPath) {
      const original = await readFile(candidate.sessionPath);
      const updated = rewriteSessionProvider(original, normalizedId, providerId);
      if (updated) {
        await writeFileAtomically(candidate.sessionPath, updated);
        filesUpdated.push(candidate.sessionPath);
      }
    }

    if (candidate.stateDbPath) {
      const threadsUpdated = await rewriteThreadProvider(candidate.stateDbPath, normalizedId, providerId);
      if (threadsUpdated > 0) {
        filesUpdated.push(candidate.stateDbPath);
        for (const suffix of sidecars) await rm(`${candidate.stateDbPath}${suffix}`, { force: true });
      }
    }

    if (filesUpdated.length === 0) {
      throw new Error(`Conversation '${normalizedId}' was found, but no provider metadata changed`);
    }

    const verified = await inspectEnvironmentConversation(
      normalizedId,
      options.environments.find((environment) => environment.envName === candidate.envName) ?? {
        envName: candidate.envName,
        homePath: candidate.homePath,
      },
    );
    if (!verified || verified.recordedProvider !== providerId || !verified.metadataConsistent) {
      throw new Error(`Conversation '${normalizedId}' failed provider metadata verification after repair`);
    }

    return {
      conversationId: normalizedId,
      envName: candidate.envName,
      sessionPath: candidate.sessionPath,
      stateDbPath: candidate.stateDbPath,
      previousProvider: candidate.recordedProvider,
      providerId,
      filesUpdated,
      backupPath,
      message: `Repaired conversation '${normalizedId}' in environment '${candidate.envName}'`,
    };
  } catch (error) {
    await restoreBackup(candidate.homePath, backupPath, manifest).catch(() => undefined);
    throw error;
  }
}

async function inspectEnvironmentConversation(
  conversationId: string,
  environment: CodexConversationRepairEnvironment,
): Promise<CodexConversationCandidate | undefined> {
  const homePath = environment.homePath.trim();
  const stateDbPath = join(homePath, "state_5.sqlite");
  const dbRecord = await readThreadRecord(stateDbPath, conversationId).catch(() => undefined);
  const sessionMatch = await resolveSessionMatch(homePath, conversationId, dbRecord?.rolloutPath).catch(() => undefined);
  if (!dbRecord && !sessionMatch) return undefined;

  const config = await readConfigSummary(join(homePath, "config.toml"));
  const gatewayEnabled = environment.gatewayEnabled === true;
  const currentProvider = config.modelProvider || (gatewayEnabled ? CODEX_SWITCHER_PROVIDER_ID : undefined);
  const targetProvider = currentProvider || CODEX_SWITCHER_PROVIDER_ID;
  const recordedProvider = sessionMatch?.metadata.modelProvider || dbRecord?.modelProvider;
  const recordedModel = sessionMatch?.metadata.model || dbRecord?.model;
  const cwd = sessionMatch?.metadata.cwd || dbRecord?.cwd;
  const metadataConsistent = !sessionMatch?.metadata.modelProvider || !dbRecord?.modelProvider
    ? true
    : sessionMatch.metadata.modelProvider === dbRecord.modelProvider;
  const providerMatches = Boolean(recordedProvider && currentProvider && recordedProvider === currentProvider);
  const modelMatches = recordedModel && config.model ? recordedModel === config.model : undefined;

  let status: CodexConversationRepairStatus;
  let statusMessage: string;
  let canRepair = false;
  if (!currentProvider) {
    status = "provider-missing";
    statusMessage = `No current provider is configured for '${environment.envName}'`;
  } else if (providerMatches) {
    status = "already-current";
    statusMessage = `Conversation '${conversationId}' already uses provider '${currentProvider}'`;
  } else if (modelMatches === false) {
    status = "model-mismatch";
    statusMessage = `Conversation model '${recordedModel}' differs from current model '${config.model}'`;
  } else if (!metadataConsistent) {
    status = "metadata-mismatch";
    statusMessage = "Session JSONL and SQLite provider metadata differ; repair requires explicit confirmation";
    canRepair = true;
  } else if (recordedProvider) {
    status = "repairable";
    statusMessage = `Provider '${recordedProvider}' can be changed to '${currentProvider}' for this conversation`;
    canRepair = true;
  } else {
    status = "incomplete";
    statusMessage = "Conversation metadata does not contain a recorded provider";
  }

  return {
    envName: environment.envName,
    homePath,
    ...(dbRecord ? { stateDbPath } : {}),
    ...(sessionMatch ? { sessionPath: sessionMatch.path } : {}),
    ...(recordedProvider ? { recordedProvider } : {}),
    ...(recordedModel ? { recordedModel } : {}),
    ...(cwd ? { cwd } : {}),
    ...(currentProvider ? { currentProvider } : {}),
    ...(config.model ? { currentModel: config.model } : {}),
    targetProvider,
    gatewayEnabled,
    providerMatches,
    ...(modelMatches !== undefined ? { modelMatches } : {}),
    metadataConsistent,
    canRepair,
    status,
    statusMessage,
  };
}

async function readThreadRecord(path: string, conversationId: string): Promise<ThreadRecord | undefined> {
  if (!(await fileExists(path))) return undefined;
  const db = await openDatabase(path);
  try {
    const columns = getTableColumns(db, "threads");
    if (!columns.has("id")) return undefined;
    const selected = ["id", "model_provider", "model", "cwd", "rollout_path"].filter((column) => columns.has(column));
    if (!selected.length) return undefined;
    const statement = db.prepare(`SELECT ${selected.join(", ")} FROM threads WHERE id = ? LIMIT 1`);
    try {
      statement.bind([conversationId]);
      if (!statement.step()) return undefined;
      const row = statement.getAsObject() as Record<string, unknown>;
      return {
        id: String(row.id ?? conversationId),
        ...(typeof row.model_provider === "string" && row.model_provider ? { modelProvider: row.model_provider } : {}),
        ...(typeof row.model === "string" && row.model ? { model: row.model } : {}),
        ...(typeof row.cwd === "string" && row.cwd ? { cwd: row.cwd } : {}),
        ...(typeof row.rollout_path === "string" && row.rollout_path ? { rolloutPath: row.rollout_path } : {}),
      };
    } finally {
      statement.free();
    }
  } finally {
    db.close();
  }
}

async function resolveSessionMatch(homePath: string, conversationId: string, rolloutPath?: string): Promise<SessionMatch | undefined> {
  const candidates: string[] = [];
  if (rolloutPath) candidates.push(isAbsolute(rolloutPath) ? rolloutPath : join(homePath, rolloutPath));
  const paths = await listSessionJsonlFiles(join(homePath, "sessions"));
  for (const path of paths) if (!candidates.includes(path)) candidates.push(path);

  for (const path of candidates) {
    const metadata = await readSessionMetadata(path, conversationId);
    if (metadata) return { path, metadata };
  }
  return undefined;
}

async function readSessionMetadata(path: string, conversationId: string): Promise<SessionMetadata | undefined> {
  if (!(await fileExists(path))) return undefined;
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      if (record.type !== "session_meta") continue;
      const payload = record.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
      const value = payload as Record<string, unknown>;
      const id = typeof value.id === "string" ? value.id : typeof value.session_id === "string" ? value.session_id : "";
      if (id !== conversationId) continue;
      return {
        id,
        ...(typeof value.model_provider === "string" && value.model_provider ? { modelProvider: value.model_provider } : {}),
        ...(typeof value.model === "string" && value.model ? { model: value.model } : {}),
        ...(typeof value.cwd === "string" && value.cwd ? { cwd: value.cwd } : {}),
      };
    } catch {
      // Ignore malformed records and continue looking for the session header.
    }
  }
  return undefined;
}

function rewriteSessionProvider(content: Buffer, conversationId: string, providerId: string): Buffer | undefined {
  const lines = content.toString("utf8").split(/(\r?\n)/);
  let changed = false;
  let sessionMatched = false;
  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index];
    if (!line?.trim()) continue;
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      if (record.type === "session_meta") {
        const payload = record.payload;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
        const metadata = payload as Record<string, unknown>;
        const id = typeof metadata.id === "string" ? metadata.id : typeof metadata.session_id === "string" ? metadata.session_id : "";
        if (id !== conversationId) continue;
        sessionMatched = true;
        if (metadata.model_provider !== providerId) {
          lines[index] = JSON.stringify({ ...record, payload: { ...metadata, model_provider: providerId } });
          changed = true;
        }
        continue;
      }
      if (!sessionMatched || record.type !== "event_msg") continue;
      const payload = record.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
      const event = payload as Record<string, unknown>;
      if (event.type !== "thread_settings_applied") continue;
      const settings = event.thread_settings;
      if (!settings || typeof settings !== "object" || Array.isArray(settings)) continue;
      const threadSettings = settings as Record<string, unknown>;
      if (threadSettings.model_provider_id === providerId) continue;
      if (typeof threadSettings.model_provider_id !== "string") continue;
      lines[index] = JSON.stringify({ ...record, payload: { ...event, thread_settings: { ...threadSettings, model_provider_id: providerId } } });
      changed = true;
    } catch {
      // Preserve malformed or non-metadata records byte-for-byte.
    }
  }
  return sessionMatched && changed ? Buffer.from(lines.join(""), "utf8") : undefined;
}

async function rewriteThreadProvider(path: string, conversationId: string, providerId: string): Promise<number> {
  const db = await openDatabase(path);
  try {
    const columns = getTableColumns(db, "threads");
    if (!columns.has("id") || !columns.has("model_provider")) return 0;
    db.run("BEGIN TRANSACTION");
    db.run("UPDATE threads SET model_provider = ? WHERE id = ? AND model_provider IS NOT ?", [providerId, conversationId, providerId]);
    const changed = db.getRowsModified();
    db.run("COMMIT");
    if (changed > 0) await writeFileAtomically(path, Buffer.from(db.export()));
    return changed;
  } catch (error) {
    try { db.run("ROLLBACK"); } catch { /* transaction may already be closed */ }
    throw error;
  } finally {
    db.close();
  }
}

function getTableColumns(db: Database, table: string): Set<string> {
  const rows = db.exec(`PRAGMA table_info(${table})`)[0]?.values ?? [];
  return new Set(rows.map((row) => String(row[1] ?? "")));
}

async function readConfigSummary(path: string): Promise<ConfigSummary> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch {
    return {};
  }
  const topLevelLines: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (line.trim().startsWith("[")) break;
    topLevelLines.push(line);
  }
  const topLevel = topLevelLines.join("\n");
  const read = (key: string) => topLevel.match(new RegExp(`^\\s*${key}\\s*=\\s*[\\\"']([^\\\"']+)[\\\"']\\s*$`, "m"))?.[1]?.trim();
  return {
    ...(read("model_provider") ? { modelProvider: read("model_provider") } : {}),
    ...(read("model") ? { model: read("model") } : {}),
  };
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
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "_") || "conversation";
}
