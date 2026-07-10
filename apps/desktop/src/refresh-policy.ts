export type PostMutationRefreshMode = "overview-only" | "overview-and-metrics" | "none";
import type { UsageFilter } from "./desktop-model";

export const REFRESH_INTERVAL_PRESETS = [1, 3, 5, 10] as const;
export const AUTH_METRICS_REFRESH_PRESETS = REFRESH_INTERVAL_PRESETS;

export function normalizeRefreshSeconds(value: number) {
  if (!Number.isFinite(value)) return 5;
  return Math.min(Math.max(Math.round(value), 1), 3600);
}

export const normalizeAuthMetricsRefreshSeconds = normalizeRefreshSeconds;

export type UsageRange = "1h" | "24h" | "7d" | "30d";

export function buildUsageFilter(input: {
  range: UsageRange;
  envName: string;
  accountName: string;
  baseUrl: string;
  model: string;
}, now = Date.now()): UsageFilter {
  const hours = input.range === "1h" ? 1 : input.range === "7d" ? 168 : input.range === "30d" ? 720 : 24;
  return {
    from: now - hours * 3_600_000,
    to: now,
    envName: input.envName === "all" ? undefined : input.envName,
    accountName: input.accountName === "all" ? undefined : input.accountName,
    baseUrl: input.baseUrl === "all" ? undefined : input.baseUrl,
    model: input.model === "all" ? undefined : input.model,
  };
}

export function shouldScheduleUsageRefresh(visibilityState: string, requestInFlight: boolean) {
  return visibilityState === "visible" && !requestInFlight;
}

export function shouldScheduleAuthMetricsRefresh(
  view: string,
  visibilityState: string,
  requestInFlight: boolean,
  hasOverview: boolean,
) {
  return view === "accounts" && visibilityState === "visible" && !requestInFlight && hasOverview;
}

export function getPostMutationRefreshPlan(mode: PostMutationRefreshMode) {
  if (mode === "overview-and-metrics") {
    return {
      refreshOverview: true,
      refreshMetrics: true,
    };
  }

  if (mode === "overview-only") {
    return {
      refreshOverview: true,
      refreshMetrics: false,
    };
  }

  return {
    refreshOverview: false,
    refreshMetrics: false,
  };
}
