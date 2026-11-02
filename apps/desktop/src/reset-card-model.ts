export type ResetCardSupportStatus =
  | "fresh"
  | "stale"
  | "syncing"
  | "empty"
  | "unsupported"
  | "unauthorized"
  | "rate-limited"
  | "network-error"
  | "api-error"
  | "parse-error";

export type ResetCardType = "five-hour" | "weekly" | "unknown";
export type AutoUseMode = "off" | "weekly-exhausted" | "expiring" | "both";
export type PreConsumeMode = "grace" | "confirm";

export interface ResetCardDetail {
  /** Safe, stable display id. The upstream credit id is never sent to the renderer. */
  id: string;
  type: ResetCardType;
  grantedAt?: number;
  expiresAt?: number;
  /** True when the vendor explicitly says the card does not expire. */
  nonExpiring?: boolean;
  status: "available" | "consumed" | "expired" | "unknown";
}

export interface SubscriptionUsageWindow {
  name: "five-hour" | "weekly" | "other";
  usedPercent?: number;
  resetsAt?: number;
  used: boolean;
  exhausted: boolean;
}

export interface ResetCardSnapshot {
  accountKey: string;
  envNames: string[];
  accountNames: string[];
  accountId?: string;
  workspaceId?: string;
  plan?: string;
  status: ResetCardSupportStatus;
  cards: ResetCardDetail[];
  count: number;
  usageWindows: SubscriptionUsageWindow[];
  observedAt?: number;
  nextRefreshAt?: number;
  lastError?: string;
  lastErrorCode?: string;
  isStale: boolean;
}

export interface ResetCardAccountReference {
  accountKey: string;
  envName: string;
  accountName: string;
  authMode: string;
  providerId?: string;
  preferredAuthMethod?: string;
}

export interface ResetCardSettings {
  version: 1;
  refreshIntervalMinutes: number;
  expiryReminder: "off" | "24h" | "12h" | "6h" | "3h" | "1h" | "30m";
  notificationsEnabled: boolean;
  autoUseMode: AutoUseMode;
  preConsumeMode: PreConsumeMode;
  preConsumeGraceSeconds: number;
  notifyBeforeAutoUse: boolean;
  perAccount: Record<string, {
    autoUseMode?: AutoUseMode;
    preConsumeMode?: PreConsumeMode;
    enabled?: boolean;
  }>;
}

export interface ResetCardNotificationStatus {
  supported: boolean;
  permission: "granted" | "denied" | "not-determined" | "not-required" | "unsupported";
  enabled: boolean;
  message?: string;
}

export interface ResetCardRefreshResult {
  snapshot: ResetCardSnapshot;
  refreshedAt: number;
}

export interface ResetCardConsumeResult {
  accountKey: string;
  cardId?: string;
  code: "reset" | "nothing_to_reset" | "no_credit" | "already_redeemed" | "ambiguous" | "failed";
  windowsReset: number;
  message: string;
  consumedAt?: number;
  requestId?: string;
}

export interface ResetCardOperationEvent {
  id: string;
  type: "sync" | "consume" | "notification";
  accountKey?: string;
  envName?: string;
  accountName?: string;
  status: "started" | "waiting" | "succeeded" | "failed" | "canceled" | "ambiguous";
  message: string;
  at: number;
}

export interface ResetCardPendingAction {
  id: string;
  accountKey: string;
  cardId: string;
  trigger: "weekly-exhausted" | "expiring";
  dueAt: number;
  requiresConfirmation: boolean;
}
