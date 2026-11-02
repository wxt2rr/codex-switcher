import type { AutoUseMode, ResetCardSettings, ResetCardSnapshot } from "../src/reset-card-model.js";
import type { ResetConsumptionRecord, StoredResetSnapshot } from "./codex-subscription-state.js";

export type ResetTrigger = "weekly-exhausted" | "expiring";

export interface ResetTriggerDecision {
  trigger: ResetTrigger;
  cardId: string;
  reason: string;
  dueAt: number;
}

export function expiryReminderLeadMs(value: ResetCardSettings["expiryReminder"]): number | undefined {
  switch (value) {
    case "24h": return 24 * 60 * 60_000;
    case "12h": return 12 * 60 * 60_000;
    case "6h": return 6 * 60 * 60_000;
    case "3h": return 3 * 60 * 60_000;
    case "1h": return 60 * 60_000;
    case "30m": return 30 * 60_000;
    default: return undefined;
  }
}

export function autoUseModeAllows(mode: AutoUseMode, trigger: ResetTrigger): boolean {
  return mode === "both" || mode === trigger || mode === "weekly-exhausted" && trigger === "weekly-exhausted" || mode === "expiring" && trigger === "expiring";
}

export function evaluateAutoUse(
  snapshot: Pick<StoredResetSnapshot, "cards" | "usageWindows"> | Pick<ResetCardSnapshot, "cards" | "usageWindows">,
  input: {
    now: number;
    mode: AutoUseMode;
    expiringLeadMs: number;
    consumption: ResetConsumptionRecord[];
    accountKey: string;
  },
): ResetTriggerDecision | undefined {
  if (input.mode === "off" || snapshot.cards.length === 0) return undefined;
  const weekly = snapshot.usageWindows.find((window) => window.name === "weekly");
  const fiveHour = snapshot.usageWindows.find((window) => window.name === "five-hour");
  const available = snapshot.cards.filter((card) => card.status === "available");
  if (autoUseModeAllows(input.mode, "weekly-exhausted") && weekly?.exhausted && !hasWeeklyConsumption(input.consumption, input.accountKey, weekly.resetsAt, input.now)) {
    const card = [...available].sort(cardExpirySort)[0];
    if (card) return { trigger: "weekly-exhausted", cardId: card.id, reason: "周额度已用尽且没有其它可用账号", dueAt: input.now };
  }
  if (!autoUseModeAllows(input.mode, "expiring")) return undefined;
  const card = available.filter((item) => item.expiresAt !== undefined && item.expiresAt - input.now <= input.expiringLeadMs && item.expiresAt > input.now).sort(cardExpirySort)[0];
  if (!card || !snapshot.usageWindows.some((window) => window.used)) return undefined;
  const exhausted = snapshot.usageWindows.filter((window) => window.exhausted);
  // Unknown recovery is not proof that spending is necessary. Stay safe and
  // leave the card untouched until the upstream exposes a usable reset time.
  if (exhausted.some((window) => window.resetsAt === undefined)) return undefined;
  const normalRecoveryAt = exhausted.map((window) => window.resetsAt!).sort((a, b) => b - a)[0] ?? 0;
  if (normalRecoveryAt && card.expiresAt !== undefined && normalRecoveryAt < card.expiresAt) return undefined;
  if (fiveHour?.resetsAt && card.expiresAt !== undefined && fiveHour.resetsAt < card.expiresAt && !weekly?.exhausted) return undefined;
  return { trigger: "expiring", cardId: card.id, reason: "重置卡即将到期且当前额度窗口无法及时恢复", dueAt: input.now };
}

export function hasWeeklyConsumption(records: ResetConsumptionRecord[], accountKey: string, weeklyResetsAt: number | undefined, now: number): boolean {
  const windowStart = weeklyResetsAt !== undefined ? weeklyResetsAt - 7 * 24 * 60 * 60_000 : now - 7 * 24 * 60 * 60_000;
  return records.some((record) => record.accountKey === accountKey && record.trigger === "weekly-exhausted" && record.status === "succeeded" && record.startedAt >= windowStart && record.startedAt <= now);
}

function cardExpirySort(a: { expiresAt?: number }, b: { expiresAt?: number }): number {
  return (a.expiresAt ?? Number.POSITIVE_INFINITY) - (b.expiresAt ?? Number.POSITIVE_INFINITY);
}
