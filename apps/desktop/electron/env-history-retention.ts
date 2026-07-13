import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { readEnvHistoryRetentionSettings } from "./desktop-settings.js";
import { deleteExpiredEnvFileHistoryEntries, type EnvFileHistoryCleanupResult } from "./env-file-history.js";

interface EnvHistoryCleanupState {
  completedDate?: string;
  completedAt?: string;
}

export interface EnvHistoryCleanupRunResult extends EnvFileHistoryCleanupResult {
  ran: boolean;
  reason: "disabled" | "already-completed" | "completed";
}

export async function runEnvHistoryCleanupIfDue(options: {
  stateDir: string;
  settingsPath: string;
  now?: Date;
  force?: boolean;
}): Promise<EnvHistoryCleanupRunResult> {
  const now = options.now ?? new Date();
  const settings = await readEnvHistoryRetentionSettings(options.settingsPath);
  const cutoff = new Date(now.getTime() - settings.retentionDays * 24 * 60 * 60 * 1_000).toISOString();
  if (!settings.enabled) return { ran: false, reason: "disabled", scanned: 0, deleted: 0, cutoff };

  const completedDate = formatLocalDate(now);
  const statePath = join(options.stateDir, "history", "env-history-cleanup-state.json");
  const state = await readCleanupState(statePath);
  if (!options.force && state.completedDate === completedDate) {
    return { ran: false, reason: "already-completed", scanned: 0, deleted: 0, cutoff };
  }

  const result = await deleteExpiredEnvFileHistoryEntries(options.stateDir, settings.retentionDays, now);
  await writeCleanupState(statePath, { completedDate, completedAt: now.toISOString() });
  return { ran: true, reason: "completed", ...result };
}

function formatLocalDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function readCleanupState(path: string): Promise<EnvHistoryCleanupState> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as EnvHistoryCleanupState;
  } catch {
    return {};
  }
}

async function writeCleanupState(path: string, state: EnvHistoryCleanupState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}
