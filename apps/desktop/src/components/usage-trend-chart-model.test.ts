import test from "node:test";
import assert from "node:assert/strict";

import type { UsageTrendPoint } from "../desktop-model.js";
import { buildUsageTrendChartOption, formatUsageTrendTooltip } from "./usage-trend-chart-model.js";

const point: UsageTrendPoint = {
  bucket: Date.UTC(2026, 6, 10, 8),
  requests: 3,
  inputTokens: 1200,
  outputTokens: 80,
  cacheCreationTokens: 50,
  cacheReadTokens: 900,
  totalTokens: 1280,
  actualCost: 1.25,
  standardCost: null,
  requestsWithoutUsage: 0,
  cacheHitRate: 0.75,
};

test("usage trend option exposes token series and cache hit rate on dual axes", () => {
  const option = buildUsageTrendChartOption([point], "en-US") as {
    xAxis: { type: string };
    yAxis: Array<{ name: string; max?: number }>;
    series: Array<{ name: string; yAxisIndex?: number; data: Array<[number, number | null]>; connectNulls?: boolean }>;
  };

  assert.equal(option.xAxis.type, "time");
  assert.deepEqual(option.yAxis.map((axis) => axis.name), ["Token", "Cache Hit Rate"]);
  assert.equal(option.yAxis[1]?.max, 100);
  assert.deepEqual(option.series.map((series) => series.name), [
    "Input", "Output", "Cache Creation", "Cache Read", "Cache Hit Rate",
  ]);
  assert.deepEqual(option.series[0]?.data, [[point.bucket, 1200]]);
  assert.deepEqual(option.series[4]?.data, [[point.bucket, 75]]);
  assert.equal(option.series[4]?.yAxisIndex, 1);
  assert.equal(option.series[4]?.connectNulls, true);
  assert.equal((option as { animation?: boolean }).animation, true);
  assert.equal((option as { animationDuration?: number }).animationDuration, 720);
  assert.equal((option as { animationDurationUpdate?: number }).animationDurationUpdate, 220);
});

test("cache hit rate renders buckets without cache samples as zero", () => {
  const option = buildUsageTrendChartOption([
    point,
    { ...point, bucket: point.bucket + 60_000, cacheHitRate: null },
    { ...point, bucket: point.bucket + 120_000, cacheHitRate: 0.8 },
  ], "en-US") as {
    series: Array<{ name: string; data: Array<[number, number | null]>; connectNulls?: boolean }>;
  };
  const cacheHitRate = option.series.find((series) => series.name === "Cache Hit Rate");

  assert.deepEqual(cacheHitRate?.data.map((item) => item[1]), [75, 0, 80]);
  assert.equal(cacheHitRate?.connectNulls, true);
});

test("usage trend disables motion when reduced motion is requested", () => {
  const option = buildUsageTrendChartOption([point], "en-US", false) as {
    animation?: boolean;
    animationDuration?: number;
    animationDurationUpdate?: number;
  };
  assert.equal(option.animation, false);
  assert.equal(option.animationDuration, 0);
  assert.equal(option.animationDurationUpdate, 0);
});

test("usage trend tooltip contains the complete bucket detail", () => {
  const tooltip = formatUsageTrendTooltip(point, "en-US");
  assert.match(tooltip, /Input/);
  assert.match(tooltip, /1,200/);
  assert.match(tooltip, /Output/);
  assert.match(tooltip, /Cache Creation/);
  assert.match(tooltip, /Cache Read/);
  assert.match(tooltip, /75%/);
  assert.match(tooltip, /Actual: \$1\.25/);
  assert.match(tooltip, /Standard: -/);
});

test("usage trend tooltip renders a missing cache hit rate as zero", () => {
  const tooltip = formatUsageTrendTooltip({ ...point, cacheHitRate: null }, "en-US");
  assert.match(tooltip, /Cache Hit Rate[\s\S]*<strong>0%<\/strong>/);
});
