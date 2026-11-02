import type { ResetCardSnapshot } from "../src/reset-card-model.js";

export type ResetNotificationKind = "expiring" | "pre-consume" | "consumed" | "failed" | "sync-error" | "reauth-required";

export interface ResetNotificationEvent {
  kind: ResetNotificationKind;
  title: string;
  message: string;
  accountKey: string;
  envName?: string;
  accountName?: string;
  dedupeKey: string;
}

/** Build safe, localized notification copy without including raw credentials or credit ids. */
export function buildResetNotificationEvent(input: {
  kind: ResetNotificationKind;
  accountKey: string;
  snapshot?: ResetCardSnapshot;
  message: string;
  language?: "zh" | "en";
}): ResetNotificationEvent {
  const language = input.language ?? "zh";
  const title = language === "en"
    ? ({ expiring: "Codex reset card expiring", "pre-consume": "Codex reset card will be used", consumed: "Codex reset card used", failed: "Codex reset card failed", "sync-error": "Codex subscription sync warning", "reauth-required": "Codex account needs re-authentication" } as const)[input.kind]
    : ({ expiring: "Codex 重置卡即将到期", "pre-consume": "即将使用 Codex 重置卡", consumed: "Codex 重置卡已使用", failed: "Codex 重置卡使用失败", "sync-error": "Codex 订阅同步提醒", "reauth-required": "Codex 账号需要重新登录" } as const)[input.kind];
  const safeMessage = input.message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:access_token|refresh_token|credit_id|redeem_request_id)\s*[=:]\s*\S+/gi, "[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-token]")
    .slice(0, 500);
  const cardThreshold = input.snapshot?.cards.map((card) => `${card.id}:${card.expiresAt ?? "unknown"}`).join(",") ?? "none";
  return {
    kind: input.kind,
    title,
    message: safeMessage,
    accountKey: input.accountKey,
    envName: input.snapshot?.envNames[0],
    accountName: input.snapshot?.accountNames[0],
    dedupeKey: `${input.kind}:${input.accountKey}:${cardThreshold}:${safeMessage}`,
  };
}
