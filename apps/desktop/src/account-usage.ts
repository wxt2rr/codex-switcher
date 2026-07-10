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

  const match = timestamp.match(/^(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) {
    return language === "zh" ? `${timestamp} 重置` : language === "ja" ? `${timestamp} リセット` : `Resets ${timestamp}`;
  }

  const [, monthText, dayText, hourText, minuteText] = match;
  const currentYear = now.getFullYear();
  let resetAt = new Date(
    currentYear,
    Number.parseInt(monthText ?? "1", 10) - 1,
    Number.parseInt(dayText ?? "1", 10),
    Number.parseInt(hourText ?? "0", 10),
    Number.parseInt(minuteText ?? "0", 10),
  );

  if (resetAt.getTime() <= now.getTime()) {
    resetAt = new Date(
      currentYear + 1,
      Number.parseInt(monthText ?? "1", 10) - 1,
      Number.parseInt(dayText ?? "1", 10),
      Number.parseInt(hourText ?? "0", 10),
      Number.parseInt(minuteText ?? "0", 10),
    );
  }

  const totalHours = Math.max(Math.floor((resetAt.getTime() - now.getTime()) / (1000 * 60 * 60)), 1);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const countdown = days > 0 ? `${days}d${hours}h` : `${totalHours}h`;

  if (language === "zh") return `${countdown} 后重置`;
  if (language === "ja") return `${countdown} 後にリセット`;
  return `Resets in ${countdown}`;
}
