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
    series: Array<{ name: string; yAxisIndex?: number; data: Array<[number, number | null]> }>;
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
