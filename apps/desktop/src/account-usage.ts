import { getTranslations, type UiLanguage } from "./i18n";

export interface ParsedUsageMetric {
  percent: number | null;
  label: string;
  timestamp?: string;
}

const PERCENT_PATTERN = /^(\d{1,3})%\s*(?:\(([^)]+)\))?/;

export function parseUsageMetric(raw: string | undefined): ParsedUsageMetric {
  const value = raw?.trim() ?? "";
  if (!value || value === "-") {
    return {
      percent: null,
      label: "-",
    };
  }

  const match = value.match(PERCENT_PATTERN);
  if (!match) {
    return {
      percent: null,
      label: value,
    };
  }

  const percent = Number.parseInt(match[1] ?? "", 10);
  return {
    percent: Number.isFinite(percent) ? Math.min(Math.max(percent, 0), 100) : null,
    label: `${match[1]}%`,
    timestamp: match[2]?.trim() || undefined,
  };
}

export function localizeUsageMetricLabel(raw: string, language: UiLanguage): string {
  const value = raw.trim();
  const text = getTranslations(language);

  if (value === "expired") {
    return text.labels.usageExpired;
  }
  if (value === "unauthorized") {
    return text.labels.usageUnauthorized;
  }
  if (value === "network-failed") {
    return text.labels.usageNetworkFailed;
  }
  if (value === "api-failed") {
    return text.labels.usageApiFailed;
  }
  return value;
}

export function getUsageProgressClass(percent: number): string {
  if (percent >= 85) return "bg-rose-500";
  if (percent >= 70) return "bg-orange-500";
  if (percent >= 50) return "bg-amber-500";
  return "bg-emerald-500";
}

export function formatUsageResetHint(
  timestamp: string | undefined,
  language: UiLanguage,
  now = new Date(),
): string {
  if (!timestamp) {
    return language === "zh" ? "待刷新" : language === "ja" ? "更新待ち" : "Pending refresh";
  }

  const resetAt = resolveUsageResetDate(timestamp, now);
  if (!resetAt) {
    return language === "zh" ? `${timestamp} 重置` : language === "ja" ? `${timestamp} リセット` : `Resets ${timestamp}`;
  }

  const totalHours = Math.max(Math.floor((resetAt.getTime() - now.getTime()) / (1000 * 60 * 60)), 1);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const countdown = days > 0 ? `${days}d${hours}h` : `${totalHours}h`;

  if (language === "zh") return `${countdown} 后重置`;
  if (language === "ja") return `${countdown} 後にリセット`;
  return `Resets in ${countdown}`;
}

function resolveUsageResetDate(timestamp: string, now: Date): Date | null {
  const match = timestamp.match(/^(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;

  const month = Number.parseInt(match[1] ?? "", 10);
  const day = Number.parseInt(match[2] ?? "", 10);
  const hour = Number.parseInt(match[3] ?? "", 10);
  const minute = Number.parseInt(match[4] ?? "", 10);
  if (!Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(hour) || !Number.isInteger(minute)) return null;

  const currentYear = now.getFullYear();
  let resetAt = new Date(currentYear, month - 1, day, hour, minute, 0, 0);
  if (
    resetAt.getFullYear() !== currentYear
    || resetAt.getMonth() !== month - 1
    || resetAt.getDate() !== day
    || resetAt.getHours() !== hour
    || resetAt.getMinutes() !== minute
  ) {
    return null;
  }

  if (resetAt.getTime() <= now.getTime()) {
    resetAt = new Date(currentYear + 1, month - 1, day, hour, minute, 0, 0);
  }
  return resetAt;
}

/**
 * Formats the exact local reset date for the usage tooltip.
 * Usage APIs only return month/day/time, so the year is resolved in the same
 * way as the countdown: the next occurrence is used when this year's time has passed.
 */
export function formatUsageResetTime(
  timestamp: string | undefined,
  language: UiLanguage,
  now = new Date(),
): string | undefined {
  if (!timestamp) return undefined;

  const resetAt = resolveUsageResetDate(timestamp, now);
  if (!resetAt) return timestamp;

  const year = resetAt.getFullYear();
  const month = resetAt.getMonth() + 1;
  const day = resetAt.getDate();
  const hour = resetAt.getHours();
  const minute = String(resetAt.getMinutes()).padStart(2, "0");

  if (language === "zh" || language === "ja") {
    return `${year}年${month}月${day}日 ${String(hour).padStart(2, "0")}:${minute}`;
  }

  const monthLabel = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1] ?? String(month);
  const meridiem = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${monthLabel} ${day}, ${year}, ${hour12}:${minute} ${meridiem}`;
}
