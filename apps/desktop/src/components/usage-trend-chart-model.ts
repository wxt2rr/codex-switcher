import type { EChartsCoreOption } from "echarts/core";

import type { UsageTrendPoint } from "../desktop-model";

const trendColors = {
  input: "#3b82f6",
  output: "#10b981",
  cacheCreation: "#f59e0b",
  cacheRead: "#06b6d4",
  cacheHitRate: "#8b5cf6",
};

const tooltipRows = [
  ["Input", trendColors.input, "inputTokens"],
  ["Output", trendColors.output, "outputTokens"],
  ["Cache Creation", trendColors.cacheCreation, "cacheCreationTokens"],
  ["Cache Read", trendColors.cacheRead, "cacheReadTokens"],
] as const;

function formatTimestamp(timestamp: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function formatTokens(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

function formatCost(value: number | null, locale?: string): string {
  if (value === null) return "-";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value);
}

export function formatUsageTrendTooltip(point: UsageTrendPoint, locale?: string): string {
  const rows = tooltipRows.map(([label, color, key]) => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;margin-top:6px">
      <span style="display:flex;align-items:center;gap:7px"><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${color}"></i>${label}</span>
      <strong>${formatTokens(point[key], locale)}</strong>
    </div>`).join("");
  const hitRate = `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format((point.cacheHitRate ?? 0) * 100)}%`;
  return `<div style="min-width:230px;color:#f8fafc;font-size:12px;line-height:1.35">
    <div style="font-size:13px;font-weight:700;margin-bottom:8px">${formatTimestamp(point.bucket, locale)}</div>
    ${rows}
    <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;margin-top:6px">
      <span style="display:flex;align-items:center;gap:7px"><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${trendColors.cacheHitRate}"></i>Cache Hit Rate</span>
      <strong>${hitRate}</strong>
    </div>
    <div style="border-top:1px solid rgba(255,255,255,.18);margin-top:9px;padding-top:8px;font-weight:700">
      Actual: ${formatCost(point.actualCost, locale)} &nbsp;|&nbsp; Standard: ${formatCost(point.standardCost, locale)}
    </div>
  </div>`;
}

function bucketFromTooltipParams(params: unknown): number | null {
  const first = Array.isArray(params) ? params[0] : params;
  if (!first || typeof first !== "object") return null;
  const value = (first as { value?: unknown }).value;
  if (!Array.isArray(value)) return null;
  const bucket = Number(value[0]);
  return Number.isFinite(bucket) ? bucket : null;
}

export function buildUsageTrendChartOption(trend: UsageTrendPoint[], locale?: string, motion = true): EChartsCoreOption {
  const pointsByBucket = new Map(trend.map((point) => [point.bucket, point]));
  const tokenSeries = [
    ["Input", trendColors.input, "inputTokens"],
    ["Output", trendColors.output, "outputTokens"],
    ["Cache Creation", trendColors.cacheCreation, "cacheCreationTokens"],
    ["Cache Read", trendColors.cacheRead, "cacheReadTokens"],
  ] as const;

  return {
    animation: motion,
    animationDuration: motion ? 720 : 0,
    animationDurationUpdate: motion ? 220 : 0,
    animationEasing: "cubicOut",
    animationEasingUpdate: "cubicOut",
    color: Object.values(trendColors),
    grid: { left: 58, right: 58, top: 48, bottom: 40, containLabel: false },
    legend: {
      top: 0,
      left: "center",
      itemWidth: 9,
      itemHeight: 9,
      icon: "circle",
      textStyle: { color: "#64748b", fontSize: 12 },
    },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: "rgba(23, 28, 35, .94)",
      borderWidth: 0,
      padding: [10, 12],
      textStyle: { color: "#f8fafc" },
      axisPointer: { type: "line", lineStyle: { color: "#94a3b8", type: "dashed" } },
      formatter: (params: unknown) => {
        const bucket = bucketFromTooltipParams(params);
        const point = bucket === null ? undefined : pointsByBucket.get(bucket);
        return point ? formatUsageTrendTooltip(point, locale) : "";
      },
    },
    xAxis: {
      type: "time",
      boundaryGap: false,
      axisLine: { lineStyle: { color: "#dbe3ec" } },
      axisTick: { show: false },
      axisLabel: {
        color: "#94a3b8",
        fontSize: 11,
        hideOverlap: true,
        formatter: (value: number) => new Intl.DateTimeFormat(locale, {
          month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
        }).format(value),
      },
      splitLine: { show: false },
    },
    yAxis: [
      {
        type: "value",
        name: "Token",
        min: 0,
        nameTextStyle: { color: "#94a3b8", fontSize: 11 },
        axisLabel: { color: "#94a3b8", fontSize: 11, formatter: (value: number) => formatTokens(value, locale) },
        splitLine: { lineStyle: { color: "#e8edf3" } },
      },
      {
        type: "value",
        name: "Cache Hit Rate",
        min: 0,
        max: 100,
        interval: 20,
        nameTextStyle: { color: "#8b5cf6", fontSize: 11 },
        axisLabel: { color: "#8b5cf6", fontSize: 11, formatter: "{value}%" },
        splitLine: { show: false },
      },
    ],
    series: [
      ...tokenSeries.map(([name, color, key]) => ({
        name,
        type: "line" as const,
        data: trend.map((point) => [point.bucket, point[key]]),
        showSymbol: false,
        symbol: "circle",
        symbolSize: 7,
        smooth: 0.25,
        lineStyle: { color, width: 2.5 },
        itemStyle: { color },
        emphasis: { focus: "series" as const },
      })),
      {
        name: "Cache Hit Rate",
        type: "line",
        yAxisIndex: 1,
        data: trend.map((point) => [point.bucket, (point.cacheHitRate ?? 0) * 100]),
        connectNulls: true,
        showSymbol: false,
        symbol: "circle",
        symbolSize: 7,
        smooth: 0.25,
        lineStyle: { color: trendColors.cacheHitRate, width: 2.5, type: "dashed" },
        itemStyle: { color: trendColors.cacheHitRate },
        emphasis: { focus: "series" },
      },
    ],
  };
}
