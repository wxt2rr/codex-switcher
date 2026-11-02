import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  AutoUseMode,
  PreConsumeMode,
  ResetCardSettings,
  ResetCardSnapshot,
} from "../src/reset-card-model.js";
import type { StoredResetCard, StoredUsageWindow } from "./codex-reset-card-utils.js";

export interface StoredResetSnapshot extends Omit<ResetCardSnapshot, "cards" | "usageWindows"> {
  cards: StoredResetCard[];
  usageWindows: StoredUsageWindow[];
}

export interface ResetConsumptionRecord {
  id: string;
  accountKey: string;
  cardId: string;
  trigger: "manual" | "weekly-exhausted" | "expiring";
  requestId: string;
  status: "pending" | "succeeded" | "failed" | "ambiguous" | "canceled";
  code?: string;
  message?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface ResetReminderRecord {
  key: string;
  accountKey: string;
  cardId: string;
  threshold: string;
  expiresAt?: number;
  sentAt: number;
}

export interface ResetBackoffRecord {
  nextAttemptAt: number;
  failures: number;
  lastError?: string;
  lastErrorCode?: string;
}

export interface PendingResetAction {
  id: string;
  accountKey: string;
  cardId: string;
  trigger: "weekly-exhausted" | "expiring";
  requestId: string;
  dueAt: number;
  createdAt: number;
  requiresConfirmation?: boolean;
  canceled?: boolean;
}

export interface CodexSubscriptionState {
  version: 1;
  snapshots: Record<string, StoredResetSnapshot>;
  consumption: ResetConsumptionRecord[];
  reminders: ResetReminderRecord[];
  backoff: Record<string, ResetBackoffRecord>;
  pending: Record<string, PendingResetAction>;
  settings: ResetCardSettings;
}

export const DEFAULT_RESET_CARD_SETTINGS: ResetCardSettings = {
  version: 1,
  refreshIntervalMinutes: 5,
  expiryReminder: "3h",
  notificationsEnabled: false,
  autoUseMode: "off",
  preConsumeMode: "grace",
  preConsumeGraceSeconds: 30,
  notifyBeforeAutoUse: true,
  perAccount: {},
};

export function validateResetCardSettingsPatch(value: unknown): Partial<ResetCardSettings> {
  if (!isRecord(value)) throw new Error("Reset-card settings must be an object");
  const allowed = new Set(["version", "refreshIntervalMinutes", "expiryReminder", "notificationsEnabled", "autoUseMode", "preConsumeMode", "preConsumeGraceSeconds", "notifyBeforeAutoUse", "perAccount"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Unknown reset-card setting: ${key}`);
  const patch: Partial<ResetCardSettings> = {};
  if (value.version !== undefined && value.version !== 1) throw new Error("Unsupported reset-card settings version");
  if (value.refreshIntervalMinutes !== undefined && (!Number.isFinite(value.refreshIntervalMinutes) || value.refreshIntervalMinutes < 1 || value.refreshIntervalMinutes > 60)) throw new Error("Refresh interval must be between 1 and 60 minutes");
  if (value.preConsumeGraceSeconds !== undefined && (!Number.isFinite(value.preConsumeGraceSeconds) || value.preConsumeGraceSeconds < 5 || value.preConsumeGraceSeconds > 300)) throw new Error("Grace period must be between 5 and 300 seconds");
  if (value.expiryReminder !== undefined && !["off", "24h", "12h", "6h", "3h", "1h", "30m"].includes(String(value.expiryReminder))) throw new Error("Invalid expiry reminder");
  if (value.autoUseMode !== undefined && !["off", "weekly-exhausted", "expiring", "both"].includes(String(value.autoUseMode))) throw new Error("Invalid automatic-use mode");
  if (value.preConsumeMode !== undefined && !["grace", "confirm"].includes(String(value.preConsumeMode))) throw new Error("Invalid pre-consume mode");
  for (const key of ["notificationsEnabled", "notifyBeforeAutoUse"] as const) if (value[key] !== undefined && typeof value[key] !== "boolean") throw new Error(`${key} must be boolean`);
  if (value.perAccount !== undefined) {
    if (!isRecord(value.perAccount) || Object.keys(value.perAccount).length > 500) throw new Error("Invalid per-account reset-card settings");
    for (const [accountKey, item] of Object.entries(value.perAccount)) {
      if (!/^[a-z0-9._:-]{3,512}$/i.test(accountKey) || !isRecord(item)) throw new Error("Invalid per-account reset-card setting");
      if (item.enabled !== undefined && typeof item.enabled !== "boolean") throw new Error("Per-account enabled must be boolean");
      if (item.autoUseMode !== undefined && !["off", "weekly-exhausted", "expiring", "both"].includes(String(item.autoUseMode))) throw new Error("Invalid per-account automatic-use mode");
      if (item.preConsumeMode !== undefined && !["grace", "confirm"].includes(String(item.preConsumeMode))) throw new Error("Invalid per-account pre-consume mode");
    }
  }
  return value as Partial<ResetCardSettings>;
}

export function validateResetCardAccountSettingsPatch(value: unknown): {
  enabled?: boolean;
  autoUseMode?: AutoUseMode;
  preConsumeMode?: PreConsumeMode;
} {
  if (!isRecord(value) || Object.keys(value).some((key) => !["enabled", "autoUseMode", "preConsumeMode"].includes(key))) {
    throw new Error("Invalid account reset-card settings");
  }
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    throw new Error("Per-account enabled must be boolean");
  }
  if (value.autoUseMode !== undefined && !["off", "weekly-exhausted", "expiring", "both"].includes(String(value.autoUseMode))) {
    throw new Error("Invalid per-account automatic-use mode");
  }
  if (value.preConsumeMode !== undefined && !["grace", "confirm"].includes(String(value.preConsumeMode))) {
    throw new Error("Invalid per-account pre-consume mode");
  }
  return {
    ...(value.enabled === undefined ? {} : { enabled: value.enabled }),
    ...(value.autoUseMode === undefined ? {} : { autoUseMode: value.autoUseMode as AutoUseMode }),
    ...(value.preConsumeMode === undefined ? {} : { preConsumeMode: value.preConsumeMode as PreConsumeMode }),
  };
}

export interface CodexSubscriptionStateStore {
  readonly path: string;
  load(): Promise<CodexSubscriptionState>;
  update(mutator: (state: CodexSubscriptionState) => CodexSubscriptionState | void): Promise<CodexSubscriptionState>;
  getDiagnostics(): StateStoreDiagnostics;
}

export interface StateStoreDiagnostics {
  recoveredFromCorruption: boolean;
  backupPath?: string;
  migratedFromVersion?: number;
  lastError?: string;
}

const storeWriteQueues = new Map<string, Promise<void>>();

export function createCodexSubscriptionStateStore(stateDir: string): CodexSubscriptionStateStore {
  const path = join(stateDir, "codex-subscription-state.json");
  let diagnostics: StateStoreDiagnostics = { recoveredFromCorruption: false };

  const load = async (): Promise<CodexSubscriptionState> => {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const normalized = normalizeState(parsed);
      if (isRecord(parsed) && typeof parsed.version === "number" && parsed.version < 1) {
        diagnostics = { ...diagnostics, migratedFromVersion: parsed.version };
      }
      return cloneState(normalized);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        const backupPath = await backupCorruptState(path).catch(() => undefined);
        diagnostics = {
          recoveredFromCorruption: true,
          ...(backupPath ? { backupPath } : {}),
          lastError: safeErrorMessage(error),
        };
      }
      const empty = emptyState();
      await persist(empty);
      return cloneState(empty);
    }
  };

  const update = async (mutator: (state: CodexSubscriptionState) => CodexSubscriptionState | void) => {
    const run = async () => {
      const current = await load();
      const result = mutator(current) ?? current;
      const normalized = normalizeState(result);
      await persist(normalized);
      return cloneState(normalized);
    };
    const previous = storeWriteQueues.get(path) ?? Promise.resolve();
    const result = previous.then(run, run);
    storeWriteQueues.set(path, result.then(() => undefined, () => undefined));
    return result;
  };

  return { path, load, update, getDiagnostics: () => ({ ...diagnostics }) };

  async function persist(state: CodexSubscriptionState): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  }
}

function emptyState(): CodexSubscriptionState {
  return {
    version: 1,
    snapshots: {},
    consumption: [],
    reminders: [],
    backoff: {},
    pending: {},
    settings: cloneSettings(DEFAULT_RESET_CARD_SETTINGS),
  };
}

function normalizeState(value: unknown): CodexSubscriptionState {
  if (!isRecord(value)) throw new Error("Subscription state root must be an object");
  const version = typeof value.version === "number" ? value.version : 0;
  if (version > 1) throw new Error(`Unsupported subscription state version ${version}`);
  const settings = normalizeSettings(value.settings);
  const snapshots = isRecord(value.snapshots) ? Object.fromEntries(Object.entries(value.snapshots).flatMap(([key, item]) => {
    const parsed = normalizeSnapshot(item);
    return parsed ? [[key, parsed]] : [];
  })) : {};
  const consumption = Array.isArray(value.consumption) ? value.consumption.filter(isConsumption).slice(-500) : [];
  const reminders = Array.isArray(value.reminders) ? value.reminders.filter(isReminder).slice(-1000) : [];
  const backoff = isRecord(value.backoff) ? Object.fromEntries(Object.entries(value.backoff).flatMap(([key, item]) => isBackoff(item) ? [[key, item]] : [])) : {};
  const pending = isRecord(value.pending) ? Object.fromEntries(Object.entries(value.pending).flatMap(([key, item]) => isPending(item) ? [[key, item]] : [])) : {};
  return { version: 1, snapshots, consumption, reminders, backoff, pending, settings };
}

function normalizeSettings(value: unknown): ResetCardSettings {
  if (!isRecord(value)) return cloneSettings(DEFAULT_RESET_CARD_SETTINGS);
  const autoUseMode: AutoUseMode = ["off", "weekly-exhausted", "expiring", "both"].includes(String(value.autoUseMode)) ? String(value.autoUseMode) as AutoUseMode : "off";
  const preConsumeMode: PreConsumeMode = ["grace", "confirm"].includes(String(value.preConsumeMode)) ? String(value.preConsumeMode) as PreConsumeMode : "grace";
  const expiryReminder = ["off", "24h", "12h", "6h", "3h", "1h", "30m"].includes(String(value.expiryReminder)) ? String(value.expiryReminder) as ResetCardSettings["expiryReminder"] : "3h";
  const perAccount = isRecord(value.perAccount) ? Object.fromEntries(Object.entries(value.perAccount).flatMap(([key, item]) => {
    if (!isRecord(item)) return [];
    const mode = ["off", "weekly-exhausted", "expiring", "both"].includes(String(item.autoUseMode)) ? String(item.autoUseMode) as AutoUseMode : undefined;
    const account = {
      ...(mode ? { autoUseMode: mode } : {}),
      ...(typeof item.enabled === "boolean" ? { enabled: item.enabled } : {}),
      ...(["grace", "confirm"].includes(String(item.preConsumeMode)) ? { preConsumeMode: String(item.preConsumeMode) as PreConsumeMode } : {}),
    };
    return Object.keys(account).length ? [[key, account]] : [];
  })) : {};
  return {
    version: 1,
    refreshIntervalMinutes: clampInteger(value.refreshIntervalMinutes, 1, 60, 5),
    expiryReminder,
    notificationsEnabled: value.notificationsEnabled === true,
    autoUseMode,
    preConsumeMode,
    preConsumeGraceSeconds: clampInteger(value.preConsumeGraceSeconds, 5, 300, 30),
    notifyBeforeAutoUse: value.notifyBeforeAutoUse !== false,
    perAccount,
  };
}

function normalizeSnapshot(value: unknown): StoredResetSnapshot | undefined {
  if (!isRecord(value) || typeof value.accountKey !== "string" || !Array.isArray(value.cards) || !Array.isArray(value.usageWindows)) return undefined;
  return {
    accountKey: value.accountKey,
    envNames: stringArray(value.envNames),
    accountNames: stringArray(value.accountNames),
    ...(typeof value.accountId === "string" ? { accountId: value.accountId } : {}),
    ...(typeof value.workspaceId === "string" ? { workspaceId: value.workspaceId } : {}),
    ...(typeof value.plan === "string" ? { plan: value.plan } : {}),
    status: typeof value.status === "string" ? value.status as StoredResetSnapshot["status"] : "stale",
    cards: value.cards.filter(isStoredCard),
    count: typeof value.count === "number" ? Math.max(0, Math.floor(value.count)) : value.cards.filter(isStoredCard).length,
    usageWindows: value.usageWindows.filter(isStoredWindow),
    ...(typeof value.observedAt === "number" ? { observedAt: value.observedAt } : {}),
    ...(typeof value.nextRefreshAt === "number" ? { nextRefreshAt: value.nextRefreshAt } : {}),
    ...(typeof value.lastError === "string" ? { lastError: value.lastError.slice(0, 500) } : {}),
    ...(typeof value.lastErrorCode === "string" ? { lastErrorCode: value.lastErrorCode } : {}),
    isStale: value.isStale !== false,
  };
}

function isStoredCard(value: unknown): value is StoredResetCard {
  return isRecord(value) && typeof value.id === "string" && typeof value.creditId === "string" && typeof value.type === "string" && typeof value.status === "string";
}

function isStoredWindow(value: unknown): value is StoredUsageWindow {
  return isRecord(value) && typeof value.name === "string" && typeof value.used === "boolean" && typeof value.exhausted === "boolean";
}

function isConsumption(value: unknown): value is ResetConsumptionRecord {
  return isRecord(value) && typeof value.id === "string" && typeof value.accountKey === "string" && typeof value.cardId === "string" && typeof value.requestId === "string" && typeof value.status === "string" && typeof value.startedAt === "number";
}

function isReminder(value: unknown): value is ResetReminderRecord {
  return isRecord(value) && typeof value.key === "string" && typeof value.accountKey === "string" && typeof value.cardId === "string" && typeof value.threshold === "string" && typeof value.sentAt === "number";
}

function isBackoff(value: unknown): value is ResetBackoffRecord {
  return isRecord(value) && typeof value.nextAttemptAt === "number" && typeof value.failures === "number";
}

function isPending(value: unknown): value is PendingResetAction {
  return isRecord(value) && typeof value.id === "string" && typeof value.accountKey === "string" && typeof value.cardId === "string" && typeof value.trigger === "string" && typeof value.requestId === "string" && typeof value.dueAt === "number" && typeof value.createdAt === "number";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
}

function cloneSettings(value: ResetCardSettings): ResetCardSettings {
  return JSON.parse(JSON.stringify(value)) as ResetCardSettings;
}

function cloneState(value: CodexSubscriptionState): CodexSubscriptionState {
  return JSON.parse(JSON.stringify(value)) as CodexSubscriptionState;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function backupCorruptState(path: string): Promise<string | undefined> {
  const backup = `${path}.corrupt-${Date.now()}`;
  try {
    await rename(path, backup);
    return backup;
  } catch {
    await rm(path, { force: true }).catch(() => undefined);
    return undefined;
  }
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:access_token|refresh_token)\s*[=:]\s*\S+/gi, "[redacted]")
    .slice(0, 300);
}
