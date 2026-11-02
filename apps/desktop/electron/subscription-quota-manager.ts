import { randomUUID } from "node:crypto";

import type {
  AutoUseMode,
  ResetCardOperationEvent,
  ResetCardRefreshResult,
  ResetCardSettings,
  ResetCardSnapshot,
  ResetCardSupportStatus,
} from "../src/reset-card-model.js";
import { safeCardId, type CodexSubscriptionAccount } from "./codex-reset-card-utils.js";
import { CodexSubscriptionClient, CodexSubscriptionError } from "./codex-subscription-client.js";
import { decideResetGatewayAdmission } from "./codex-reset-gateway-admission.js";
import { autoUseModeAllows, evaluateAutoUse, expiryReminderLeadMs } from "./codex-reset-policy.js";
import {
  createCodexSubscriptionStateStore,
  DEFAULT_RESET_CARD_SETTINGS,
  type CodexSubscriptionState,
  type CodexSubscriptionStateStore,
  type ResetConsumptionRecord,
  type StoredResetSnapshot,
} from "./codex-subscription-state.js";

export interface SubscriptionQuotaManagerOptions {
  stateDir: string;
  discoverAccounts: () => Promise<CodexSubscriptionAccount[]>;
  client?: CodexSubscriptionClientLike;
  now?: () => number;
  onSnapshot?: (snapshot: ResetCardSnapshot) => void;
  onOperation?: (event: ResetCardOperationEvent) => void;
  onNotify?: (input: { kind: "expiring" | "sync-error" | "reauth-required" | "pre-consume" | "consumed" | "failed"; accountKey: string; snapshot?: ResetCardSnapshot; message: string }) => Promise<void> | void;
  allowWeeklyAutoUse?: (accountKey: string) => Promise<boolean> | boolean;
  onUsageSnapshot?: (accountKey: string, windows: ResetCardSnapshot["usageWindows"]) => Promise<void> | void;
}

export interface CodexSubscriptionClientLike {
  readAccount(account: CodexSubscriptionAccount): Promise<{
    accountId?: string;
    workspaceId?: string;
    plan?: string;
    usageWindows: import("./codex-reset-card-utils.js").StoredUsageWindow[];
    cards: import("./codex-reset-card-utils.js").StoredResetCard[];
    observedAt: number;
  }>;
  consume(account: CodexSubscriptionAccount, creditId: string, requestId: string): Promise<{ code: string; windowsReset: number }>;
}

const MIN_READ_INTERVAL_MS = 30_000;
const STALE_AFTER_MS = 15 * 60_000;
const MAX_CONCURRENCY = 3;

export class SubscriptionQuotaManager {
  private readonly store: CodexSubscriptionStateStore;
  private readonly client: CodexSubscriptionClientLike;
  private readonly now: () => number;
  private readonly onSnapshot?: SubscriptionQuotaManagerOptions["onSnapshot"];
  private readonly onOperation?: SubscriptionQuotaManagerOptions["onOperation"];
  private readonly onNotify?: SubscriptionQuotaManagerOptions["onNotify"];
  private readonly discoverAccounts: SubscriptionQuotaManagerOptions["discoverAccounts"];
  private readonly allowWeeklyAutoUse: NonNullable<SubscriptionQuotaManagerOptions["allowWeeklyAutoUse"]>;
  private readonly onUsageSnapshot?: SubscriptionQuotaManagerOptions["onUsageSnapshot"];
  private readonly inFlight = new Map<string, Promise<ResetCardRefreshResult>>();
  private readonly accountLocks = new Map<string, Promise<unknown>>();
  private readonly accounts = new Map<string, CodexSubscriptionAccount>();
  private timer?: ReturnType<typeof setTimeout>;
  private timerGeneration = 0;
  private readonly pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly autoUseRunning = new Set<string>();
  private started = false;
  private state: CodexSubscriptionState = {
    version: 1,
    snapshots: {},
    consumption: [],
    reminders: [],
    backoff: {},
    pending: {},
    settings: DEFAULT_RESET_CARD_SETTINGS,
  };

  constructor(options: SubscriptionQuotaManagerOptions) {
    this.store = createCodexSubscriptionStateStore(options.stateDir);
    this.client = options.client ?? new CodexSubscriptionClient();
    this.now = options.now ?? Date.now;
    this.onSnapshot = options.onSnapshot;
    this.onOperation = options.onOperation;
    this.onNotify = options.onNotify;
    this.discoverAccounts = options.discoverAccounts;
    this.allowWeeklyAutoUse = options.allowWeeklyAutoUse ?? (() => true);
    this.onUsageSnapshot = options.onUsageSnapshot;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.state = await this.store.load();
    await this.refreshAll(false);
    await this.resumePendingActions();
    this.scheduleNextTick();
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.timerGeneration += 1;
    for (const timer of this.pendingTimers.values()) clearTimeout(timer);
    this.pendingTimers.clear();
    await Promise.allSettled([...this.inFlight.values()]);
  }

  async refreshAll(force = false): Promise<ResetCardSnapshot[]> {
    const unique = await this.synchronizeAccounts();
    const keys = [...unique.keys()];
    const results: ResetCardSnapshot[] = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < keys.length) {
        const key = keys[cursor++];
        const result = await this.refreshAccount(key, force).catch(() => undefined);
        if (result) results.push(result.snapshot);
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, Math.max(1, keys.length)) }, worker));
    return results;
  }

  /** Reconcile accounts after login/logout/CRUD without tying correctness to
   * the Accounts page being mounted. */
  async notifyAccountsChanged(): Promise<ResetCardSnapshot[]> {
    return this.refreshAll(true);
  }

  /** Focus/resume refresh is intentionally best-effort and still obeys the
   * one-flight, backoff and minimum-read guards. */
  async notifyAppFocus(): Promise<ResetCardSnapshot[]> {
    return this.refreshAll(false);
  }

  async notifySystemResume(): Promise<ResetCardSnapshot[]> {
    return this.refreshAll(false);
  }

  /**
   * Gateway admission hook. The caller supplies the already-evaluated pool
   * candidate state; this method never consumes on a generic 429 or when a
   * fallback account exists, and delegates the actual destructive operation
   * to the same per-account lock/idempotency path as the desktop UI.
   */
  async consumeForGateway(input: {
    accountKey?: string;
    envName?: string;
    accountName?: string;
    poolEnabled: boolean;
    viableFallback: boolean;
    failureStatus?: number;
    failureReason?: string;
    alreadyRetried?: boolean;
  }): Promise<Awaited<ReturnType<SubscriptionQuotaManager["consume"]>> | undefined> {
    const accounts = await this.synchronizeAccounts();
    const resolvedAccount = input.accountKey ? accounts.get(input.accountKey)
      : [...accounts.values()].find((account) => account.envName === input.envName && account.accountName === input.accountName);
    const accountKey = resolvedAccount?.accountKey;
    if (!accountKey) return undefined;
    const snapshot = (await this.refreshAccount(accountKey, true)).snapshot;
    const weekly = snapshot.usageWindows.find((window) => window.name === "weekly");
    const admission = decideResetGatewayAdmission({
      subscriptionAccount: snapshot.status !== "unsupported" && snapshot.status !== "unauthorized",
      weeklyExhausted: Boolean(weekly?.exhausted),
      poolEnabled: input.poolEnabled,
      viableFallback: input.viableFallback,
      failureStatus: input.failureStatus,
      failureReason: input.failureReason,
      alreadyRetried: input.alreadyRetried === true,
    });
    if (!admission.allowed) return undefined;
    const settings = effectiveSettings(this.state.settings, accountKey);
    if (!settings.enabled || !autoUseModeAllows(settings.mode, "weekly-exhausted")) return undefined;
    const decision = evaluateAutoUse(snapshot, {
      accountKey,
      now: this.now(),
      mode: "weekly-exhausted",
      expiringLeadMs: 0,
      consumption: this.state.consumption,
    });
    if (!decision || decision.trigger !== "weekly-exhausted") return undefined;
    if (settings.preConsumeMode === "confirm") {
      await this.scheduleAutomaticUse(accountKey, snapshot as StoredResetSnapshot);
      return undefined;
    }
    if (settings.notifyBeforeAutoUse) {
      try {
        await this.onNotify?.({ kind: "pre-consume", accountKey, snapshot, message: "网关请求触发了周额度重置，等待安全缓冲后重新校验。" });
      } catch { /* notification is best effort */ }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, settings.graceSeconds * 1000));
    return this.consume(accountKey, decision.cardId, "weekly-exhausted", undefined, true);
  }

  async refreshAccount(accountKey: string, force = false): Promise<ResetCardRefreshResult> {
    if (!this.accounts.has(accountKey)) await this.synchronizeAccounts();
    const existing = this.inFlight.get(accountKey);
    if (existing) return existing;
    const task = this.refreshAccountInternal(accountKey, force).finally(() => this.inFlight.delete(accountKey));
    this.inFlight.set(accountKey, task);
    return task;
  }

  private async synchronizeAccounts(): Promise<Map<string, CodexSubscriptionAccount>> {
    const discovered = await this.discoverAccounts();
    const unique = new Map<string, CodexSubscriptionAccount>();
    for (const account of discovered) {
      const existing = unique.get(account.accountKey);
      unique.set(account.accountKey, existing ? mergeAccountRefs(existing, account) : account);
    }
    this.accounts.clear();
    for (const [key, account] of unique) this.accounts.set(key, account);
    return unique;
  }

  async getSnapshots(): Promise<ResetCardSnapshot[]> {
    this.state = await this.store.load();
    if (this.started) {
      const accounts = await this.synchronizeAccounts();
      return Object.entries(this.state.snapshots)
        .filter(([accountKey]) => accounts.has(accountKey))
        .map(([, snapshot]) => this.publicSnapshot(snapshot));
    }
    return Object.values(this.state.snapshots).map((snapshot) => this.publicSnapshot(snapshot));
  }

  async getSettings(): Promise<ResetCardSettings> {
    this.state = await this.store.load();
    return structuredClone(this.state.settings);
  }

  async setSettings(value: Partial<ResetCardSettings>): Promise<ResetCardSettings> {
    const canceled: string[] = [];
    this.state = await this.store.update((state) => {
      state.settings = normalizeSettings({ ...state.settings, ...value });
      for (const [accountKey, action] of Object.entries(state.pending)) {
        const effective = effectiveSettings(state.settings, accountKey);
        if (!effective.enabled || effective.mode === "off") {
          action.canceled = true;
          canceled.push(action.id);
          delete state.pending[accountKey];
        }
      }
      return state;
    });
    for (const actionId of canceled) {
      const timer = this.pendingTimers.get(actionId);
      if (timer) clearTimeout(timer);
      this.pendingTimers.delete(actionId);
      this.emit({ id: actionId, type: "consume", status: "canceled", message: "自动使用重置卡已取消", at: this.now() });
    }
    this.restartTimer();
    return structuredClone(this.state.settings);
  }

  async consume(accountKey: string, cardId?: string, trigger: "manual" | "weekly-exhausted" | "expiring" = "manual", requestIdOverride?: string, confirmed = false): Promise<{ result: ResetCardRefreshResult; outcome: { code: string; windowsReset: number; requestId: string; message: string } }> {
    if (trigger === "manual" && !confirmed) throw new Error("Manual reset-card consumption requires explicit confirmation");
    return this.withAccountLock(accountKey, async () => {
      // A manual choice supersedes any queued automatic action for this
      // account. Cancel it before re-reading the upstream so a grace timer
      // cannot consume a second card after the user has already acted.
      if (trigger === "manual" && this.state.pending[accountKey]) {
        await this.cancelPendingAction(accountKey);
      }
      const account = this.accounts.get(accountKey) ?? (await this.discoverAccounts()).find((item) => item.accountKey === accountKey);
      if (!account) throw new Error("Subscription account is no longer available");
      const fresh = await this.readFresh(account);
      const selected = cardId ? fresh.cards.find((card) => card.id === cardId || safeCardId(card.creditId) === cardId) : fresh.cards[0];
      if (!selected) throw new Error("The selected reset card is no longer available");
      const requestId = requestIdOverride ?? randomUUID();
      const recordId = randomUUID();
      await this.recordConsumption({ id: recordId, accountKey, cardId: selected.id, trigger, requestId, status: "pending", startedAt: this.now() });
      this.emit({ id: recordId, type: "consume", accountKey, status: "started", message: "正在重新校验重置卡并准备使用", at: this.now() });
      try {
        const outcome = await this.client.consume(account, selected.creditId, requestId);
        const message = describeConsumeOutcome(outcome.code, outcome.windowsReset);
        await this.recordConsumption({ id: recordId, accountKey, cardId: selected.id, trigger, requestId, status: outcome.code === "reset" ? "succeeded" : "failed", code: outcome.code, message, startedAt: this.now(), finishedAt: this.now() });
        this.emit({ id: recordId, type: "consume", accountKey, status: outcome.code === "reset" ? "succeeded" : "failed", message, at: this.now() });
        const result = await this.refreshAccount(accountKey, true);
        await this.onNotify?.({ kind: outcome.code === "reset" ? "consumed" : "failed", accountKey, snapshot: result.snapshot, message });
        return { result, outcome: { ...outcome, requestId, message } };
      } catch (error) {
        const kind = error instanceof CodexSubscriptionError && error.kind === "network" ? "ambiguous" : "failed";
        const message = error instanceof Error ? error.message : String(error);
        await this.recordConsumption({ id: recordId, accountKey, cardId: selected.id, trigger, requestId, status: kind, message, startedAt: this.now(), finishedAt: this.now() });
        this.emit({ id: recordId, type: "consume", accountKey, status: kind, message, at: this.now() });
        await this.onNotify?.({ kind: "failed", accountKey, message });
        throw error;
      }
    });
  }

  async setAccountAutoUse(accountKey: string, input: { enabled?: boolean; autoUseMode?: AutoUseMode; preConsumeMode?: ResetCardSettings["preConsumeMode"] }): Promise<ResetCardSettings> {
    this.state = await this.store.load();
    const current = this.state.settings.perAccount[accountKey] ?? {};
    return this.setSettings({ perAccount: { ...(this.state.settings.perAccount ?? {}), [accountKey]: { ...current, ...input } } });
  }

  getStateDiagnostics() {
    return this.store.getDiagnostics();
  }

  async getPendingActions(): Promise<Array<{ id: string; accountKey: string; cardId: string; trigger: "weekly-exhausted" | "expiring"; dueAt: number; requiresConfirmation: boolean }>> {
    this.state = await this.store.load();
    return Object.values(this.state.pending)
      .filter((item) => !item.canceled)
      .map((item) => ({ id: item.id, accountKey: item.accountKey, cardId: item.cardId, trigger: item.trigger, dueAt: item.dueAt, requiresConfirmation: item.requiresConfirmation === true }));
  }

  async confirmPendingAction(accountKey: string, actionId?: string): Promise<void> {
    this.state = await this.store.load();
    const action = this.state.pending[accountKey];
    if (!action || action.canceled || !action.requiresConfirmation || (actionId && action.id !== actionId)) throw new Error("No pending reset-card action requires confirmation");
    await this.runPendingAction(action.id);
  }

  async cancelPendingAction(accountKey: string, actionId?: string): Promise<void> {
    const timer = [...this.pendingTimers.entries()].find(([id]) => id === actionId);
    if (timer) {
      clearTimeout(timer[1]);
      this.pendingTimers.delete(timer[0]);
    }
    this.state = await this.store.update((state) => {
      const action = state.pending[accountKey];
      if (action && (!actionId || action.id === actionId)) {
        action.canceled = true;
        delete state.pending[accountKey];
        this.emit({ id: action.id, type: "consume", accountKey, status: "canceled", message: "自动使用重置卡已取消", at: this.now() });
      }
      return state;
    });
  }

  private async refreshAccountInternal(accountKey: string, force: boolean): Promise<ResetCardRefreshResult> {
    const account = this.accounts.get(accountKey);
    if (!account) throw new Error(`Unknown subscription account: ${accountKey}`);
    this.state = await this.store.load();
    const previous = this.state.snapshots[accountKey];
    const backoff = this.state.backoff[accountKey];
    const now = this.now();
    if (!force && backoff && backoff.nextAttemptAt > now) {
      return { snapshot: this.publicSnapshot(previous ?? this.emptySnapshot(account)), refreshedAt: previous?.observedAt ?? now };
    }
    if (!force && previous?.observedAt && now - previous.observedAt < MIN_READ_INTERVAL_MS) {
      return { snapshot: this.publicSnapshot(previous), refreshedAt: previous.observedAt };
    }
    this.emit({ id: randomUUID(), type: "sync", accountKey, status: "started", message: "正在同步订阅额度和重置卡", at: now });
    try {
      const result = await this.readFresh(account);
      const refs = this.referencesFor(accountKey);
      const snapshot: StoredResetSnapshot = {
        accountKey,
        envNames: refs.map((item) => item.envName),
        accountNames: refs.map((item) => item.accountName),
        ...(result.accountId ? { accountId: result.accountId } : account.accountId ? { accountId: account.accountId } : {}),
        ...(result.workspaceId ? { workspaceId: result.workspaceId } : account.workspaceId ? { workspaceId: account.workspaceId } : {}),
        ...(result.plan ? { plan: result.plan } : {}),
        status: result.cards.length ? "fresh" : "empty",
        cards: result.cards,
        count: result.cards.length,
        usageWindows: result.usageWindows,
        observedAt: result.observedAt,
        nextRefreshAt: result.observedAt + this.state.settings.refreshIntervalMinutes * 60_000,
        isStale: false,
      };
      this.state = await this.store.update((state) => {
        state.snapshots[accountKey] = snapshot;
        delete state.backoff[accountKey];
        return state;
      });
      const publicSnapshot = this.publicSnapshot(snapshot);
      try { this.onSnapshot?.(publicSnapshot); } catch { /* renderer delivery must not fail sync */ }
      try { await this.onUsageSnapshot?.(accountKey, publicSnapshot.usageWindows); } catch { /* legacy metrics are best effort */ }
      await this.maybeNotifyExpiring(accountKey, snapshot);
      await this.scheduleAutomaticUse(accountKey, snapshot);
      this.emit({ id: randomUUID(), type: "sync", accountKey, status: "succeeded", message: "订阅额度和重置卡已同步", at: result.observedAt });
      return { snapshot: publicSnapshot, refreshedAt: result.observedAt };
    } catch (error) {
      const kind = error instanceof CodexSubscriptionError ? error.kind : "api";
      const message = error instanceof Error ? error.message : String(error);
      const status: ResetCardSupportStatus = kind === "unauthorized" ? "unauthorized" : kind === "unsupported" ? "unsupported" : kind === "rate-limited" ? "rate-limited" : kind === "network" ? "network-error" : kind === "parse" ? "parse-error" : "api-error";
      const failures = (this.state.backoff[accountKey]?.failures ?? 0) + 1;
      const retryAfterMs = error instanceof CodexSubscriptionError ? error.retryAfterMs ?? 0 : 0;
      const nextRefreshAt = now + Math.max(nextBackoffMs(failures), retryAfterMs);
      const snapshot: StoredResetSnapshot = {
        ...(previous ?? this.emptySnapshot(account)),
        // A credential or endpoint capability failure must not be hidden by
        // a previously good card list. Keep the last cards for context, but
        // surface the actionable state so automation and the UI fail closed.
        status: kind === "unauthorized" || kind === "unsupported"
          ? status
          : previous?.cards.length ? "stale" : status,
        isStale: true,
        lastError: message.slice(0, 500),
        lastErrorCode: kind,
        nextRefreshAt,
      };
      this.state = await this.store.update((state) => {
        state.snapshots[accountKey] = snapshot;
        state.backoff[accountKey] = { failures, nextAttemptAt: snapshot.nextRefreshAt ?? now + 300_000, lastError: message.slice(0, 500), lastErrorCode: kind };
        return state;
      });
      const publicSnapshot = this.publicSnapshot(snapshot);
      this.onSnapshot?.(publicSnapshot);
      this.emit({ id: randomUUID(), type: "sync", accountKey, status: "failed", message, at: now });
      if (kind === "unauthorized" || kind === "unsupported") {
        await this.cancelPendingForAccount(accountKey, kind === "unauthorized"
          ? "账号需要重新登录，已取消自动使用重置卡"
          : "上游不支持重置卡，已取消自动使用重置卡");
      }
      await this.maybeNotifyError(kind === "unauthorized" ? "reauth-required" : "sync-error", accountKey, publicSnapshot, message);
      throw error;
    }
  }

  private async readFresh(account: CodexSubscriptionAccount) {
    return this.client.readAccount(account);
  }

  private referencesFor(accountKey: string) {
    const account = this.accounts.get(accountKey);
    return account?.references?.length ? account.references : account ? [{ envName: account.envName, accountName: account.accountName }] : [];
  }

  private emptySnapshot(account: CodexSubscriptionAccount): StoredResetSnapshot {
    return { accountKey: account.accountKey, envNames: [account.envName], accountNames: [account.accountName], ...(account.accountId ? { accountId: account.accountId } : {}), ...(account.workspaceId ? { workspaceId: account.workspaceId } : {}), status: "stale", cards: [], count: 0, usageWindows: [], isStale: true };
  }

  private publicSnapshot(snapshot: StoredResetSnapshot): ResetCardSnapshot {
    return {
      ...snapshot,
      cards: snapshot.cards.map(({ creditId: _creditId, ...card }) => card),
      usageWindows: [...snapshot.usageWindows],
    };
  }

  private emit(event: ResetCardOperationEvent): void {
    this.onOperation?.(event);
  }

  private async recordConsumption(record: ResetConsumptionRecord): Promise<void> {
    this.state = await this.store.update((state) => {
      const existing = state.consumption.findIndex((item) => item.id === record.id);
      if (existing >= 0) state.consumption[existing] = record;
      else state.consumption.push(record);
      state.consumption = state.consumption.slice(-500);
      return state;
    });
  }

  private async scheduleAutomaticUse(accountKey: string, snapshot: StoredResetSnapshot): Promise<void> {
    if (this.autoUseRunning.has(accountKey)) return;
    const settings = effectiveSettings(this.state.settings, accountKey);
    if (!settings.enabled || settings.mode === "off") return;
    if (settings.mode === "weekly-exhausted" || settings.mode === "both") {
      if (!(await this.allowWeeklyAutoUse(accountKey))) return;
    }
    const decision = evaluateAutoUse(snapshot, {
      accountKey,
      now: this.now(),
      mode: settings.mode,
      expiringLeadMs: Math.max(30 * 60_000, settings.expiringLeadMs),
      consumption: this.state.consumption,
    });
    if (!decision || this.state.pending[accountKey]) return;
    const actionId = randomUUID();
    const dueAt = this.now() + (settings.preConsumeMode === "grace" ? settings.graceSeconds * 1000 : 0);
    const requiresConfirmation = settings.preConsumeMode === "confirm";
    const action = { id: actionId, accountKey, cardId: decision.cardId, trigger: decision.trigger, requestId: randomUUID(), dueAt, createdAt: this.now(), requiresConfirmation } as const;
    this.state = await this.store.update((state) => { state.pending[accountKey] = action; return state; });
    this.emit({ id: actionId, type: "consume", accountKey, status: "waiting", message: requiresConfirmation
      ? `需要确认后使用重置卡：${decision.reason}`
      : `将在 ${Math.max(0, Math.ceil((dueAt - this.now()) / 1000))} 秒后${settings.preConsumeMode === "grace" ? "自动" : "立即"}使用重置卡：${decision.reason}`, at: this.now() });
    if (settings.notifyBeforeAutoUse) {
      await this.onNotify?.({ kind: "pre-consume", accountKey, snapshot: this.publicSnapshot(snapshot), message: `即将使用重置卡：${decision.reason}` });
    }
    if (!requiresConfirmation) {
      const timer = setTimeout(() => { void this.runPendingAction(actionId); }, Math.max(0, dueAt - this.now()));
      timer.unref?.();
      this.pendingTimers.set(actionId, timer);
    }
  }

  private async runPendingAction(actionId: string): Promise<void> {
    const action = Object.values(this.state.pending).find((item) => item.id === actionId);
    if (!action || action.canceled || this.autoUseRunning.has(action.accountKey)) return;
    this.pendingTimers.delete(actionId);
    this.autoUseRunning.add(action.accountKey);
    try {
      await this.consume(action.accountKey, action.cardId, action.trigger, action.requestId);
    } catch {
      // consume records and notification contain the actionable error.
    } finally {
      this.autoUseRunning.delete(action.accountKey);
      this.state = await this.store.update((state) => { delete state.pending[action.accountKey]; return state; });
    }
  }

  private async resumePendingActions(): Promise<void> {
    for (const action of Object.values(this.state.pending)) {
      if (action.canceled || action.requiresConfirmation) continue;
      const delayMs = Math.max(0, action.dueAt - this.now());
      const timer = setTimeout(() => { void this.runPendingAction(action.id); }, delayMs);
      timer.unref?.();
      this.pendingTimers.set(action.id, timer);
    }
  }

  private async cancelPendingForAccount(accountKey: string, message: string): Promise<void> {
    const action = this.state.pending[accountKey];
    if (!action) return;
    const timer = this.pendingTimers.get(action.id);
    if (timer) clearTimeout(timer);
    this.pendingTimers.delete(action.id);
    this.state = await this.store.update((state) => {
      const current = state.pending[accountKey];
      if (current) {
        current.canceled = true;
        delete state.pending[accountKey];
      }
      return state;
    });
    this.emit({ id: action.id, type: "consume", accountKey, status: "canceled", message, at: this.now() });
  }

  private async maybeNotifyExpiring(accountKey: string, snapshot: StoredResetSnapshot): Promise<void> {
    if (!this.state.settings.notificationsEnabled) return;
    const lead = expiryReminderLeadMs(this.state.settings.expiryReminder);
    if (lead === undefined) return;
    const now = this.now();
    for (const card of snapshot.cards) {
      if (card.status !== "available" || card.expiresAt === undefined || card.expiresAt <= now || card.expiresAt - now > lead) continue;
      const key = `${accountKey}:${card.id}:${this.state.settings.expiryReminder}`;
      if (this.state.reminders.some((item) => item.key === key)) continue;
      try {
        await this.onNotify?.({
          kind: "expiring",
          accountKey,
          snapshot: this.publicSnapshot(snapshot),
          message: `重置卡将在 ${formatRemaining(card.expiresAt - now)} 后到期，请及时处理。`,
        });
      } catch {
        // Native notification failure must never fail a successful sync.
      }
      this.state = await this.store.update((state) => {
        if (!state.reminders.some((item) => item.key === key)) {
          state.reminders.push({ key, accountKey, cardId: card.id, threshold: this.state.settings.expiryReminder, expiresAt: card.expiresAt, sentAt: now });
          state.reminders = state.reminders.slice(-1000);
        }
        return state;
      });
    }
  }

  private async withAccountLock<T>(accountKey: string, action: () => Promise<T>): Promise<T> {
    const previous = this.accountLocks.get(accountKey) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(action);
    this.accountLocks.set(accountKey, current);
    try {
      return await current;
    } finally {
      if (this.accountLocks.get(accountKey) === current) this.accountLocks.delete(accountKey);
    }
  }

  private restartTimer(): void {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    this.scheduleNextTick();
  }

  private scheduleNextTick(): void {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    const generation = ++this.timerGeneration;
    const interval = Math.max(1, this.state.settings.refreshIntervalMinutes) * 60_000;
    // Small bounded jitter prevents multiple environments/accounts from
    // synchronizing against the private upstream at the exact same instant.
    const jitter = Math.min(30_000, Math.max(0, Math.round(interval * 0.1)))
      ? Math.floor(Math.random() * Math.min(30_000, Math.round(interval * 0.1)))
      : 0;
    this.timer = setTimeout(() => {
      if (!this.started || generation !== this.timerGeneration) return;
      void this.refreshAll(false).finally(() => this.scheduleNextTick());
    }, interval + jitter);
    this.timer.unref?.();
  }

  private async maybeNotifyError(kind: "sync-error" | "reauth-required", accountKey: string, snapshot: ResetCardSnapshot, message: string): Promise<void> {
    const key = `${kind}:${accountKey}:${snapshot.lastErrorCode ?? "unknown"}`;
    if (this.state.reminders.some((item) => item.key === key)) return;
    try {
      await this.onNotify?.({ kind, accountKey, snapshot, message });
    } finally {
      this.state = await this.store.update((state) => {
        if (!state.reminders.some((item) => item.key === key)) {
          state.reminders.push({ key, accountKey, cardId: "system", threshold: kind, sentAt: this.now() });
          state.reminders = state.reminders.slice(-1000);
        }
        return state;
      });
    }
  }
}

// Keep this helper exported for deterministic scheduler/trigger tests.
export function nextBackoffMs(failures: number): number {
  return Math.min(60 * 60_000, Math.max(5 * 60_000, 5 * 60_000 * (2 ** Math.max(0, Math.min(3, failures)))));
}

export function describeConsumeOutcome(code: string, windowsReset: number): string {
  if (code === "reset") return windowsReset > 0 ? `${windowsReset} 个额度窗口已重置` : "重置卡已使用";
  if (code === "nothing_to_reset") return "当前没有需要重置的额度窗口，重置卡未消耗";
  if (code === "no_credit") return "账号没有可用重置卡";
  if (code === "already_redeemed" || code === "already_used") return "该重置卡已经被使用";
  return `上游返回：${code}`;
}

function formatRemaining(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes >= 60) return `${Math.ceil(minutes / 60)} 小时`;
  return `${minutes} 分钟`;
}

function mergeAccountRefs(a: CodexSubscriptionAccount, b: CodexSubscriptionAccount): CodexSubscriptionAccount {
  const references = [...(a.references ?? [accountReference(a)]), ...(b.references ?? [accountReference(b)])];
  const uniqueReferences = [...new Map(references.map((item) => [`${item.envName}/${item.accountName}`, item])).values()];
  return {
    ...a,
    references: uniqueReferences,
  };
}

function accountReference(account: CodexSubscriptionAccount) {
  return {
    accountKey: account.accountKey,
    envName: account.envName,
    accountName: account.accountName,
    authMode: account.authMode,
    ...(account.providerId ? { providerId: account.providerId } : {}),
    ...(account.preferredAuthMethod ? { preferredAuthMethod: account.preferredAuthMethod } : {}),
  };
}

function normalizeSettings(input: ResetCardSettings): ResetCardSettings {
  return {
    ...input,
    refreshIntervalMinutes: Math.max(1, Math.min(60, Math.round(input.refreshIntervalMinutes))),
    preConsumeGraceSeconds: Math.max(5, Math.min(300, Math.round(input.preConsumeGraceSeconds))),
    perAccount: { ...input.perAccount },
  };
}

function effectiveSettings(settings: ResetCardSettings, accountKey: string): { enabled: boolean; mode: AutoUseMode; preConsumeMode: ResetCardSettings["preConsumeMode"]; graceSeconds: number; expiringLeadMs: number; notifyBeforeAutoUse: boolean } {
  const override = settings.perAccount[accountKey];
  const mode = override?.autoUseMode ?? settings.autoUseMode;
  const enabled = override?.enabled ?? mode !== "off";
  const lead = expiryReminderLeadMs(settings.expiryReminder) ?? 30 * 60_000;
  return {
    enabled,
    mode: override?.enabled === false ? "off" : mode,
    preConsumeMode: override?.preConsumeMode ?? settings.preConsumeMode,
    graceSeconds: settings.preConsumeGraceSeconds,
    expiringLeadMs: lead,
    notifyBeforeAutoUse: settings.notifyBeforeAutoUse,
  };
}
