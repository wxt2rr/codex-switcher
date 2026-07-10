import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUsageFilter,
  getPostMutationRefreshPlan,
  normalizeRefreshSeconds,
  normalizeAuthMetricsRefreshSeconds,
  shouldScheduleAuthMetricsRefresh,
  shouldScheduleUsageRefresh,
} from "./refresh-policy";

test("overview-only mutations skip auth metrics refresh", () => {
  assert.deepEqual(getPostMutationRefreshPlan("overview-only"), {
    refreshOverview: true,
    refreshMetrics: false,
  });
});

test("overview-and-metrics mutations refresh both datasets", () => {
  assert.deepEqual(getPostMutationRefreshPlan("overview-and-metrics"), {
    refreshOverview: true,
    refreshMetrics: true,
  });
});

test("none returns no refresh work", () => {
  assert.deepEqual(getPostMutationRefreshPlan("none"), {
    refreshOverview: false,
    refreshMetrics: false,
  });
});

test("auth metrics refresh seconds are whole numbers clamped to the supported range", () => {
  assert.equal(normalizeAuthMetricsRefreshSeconds(0), 1);
  assert.equal(normalizeAuthMetricsRefreshSeconds(4.8), 5);
  assert.equal(normalizeAuthMetricsRefreshSeconds(7200), 3600);
  assert.equal(normalizeAuthMetricsRefreshSeconds(Number.NaN), 5);
});

test("auth metrics polling runs only for a visible accounts page without an in-flight request", () => {
  assert.equal(shouldScheduleAuthMetricsRefresh("accounts", "visible", false, true), true);
  assert.equal(shouldScheduleAuthMetricsRefresh("operations", "visible", false, true), false);
  assert.equal(shouldScheduleAuthMetricsRefresh("accounts", "hidden", false, true), false);
  assert.equal(shouldScheduleAuthMetricsRefresh("accounts", "visible", true, true), false);
  assert.equal(shouldScheduleAuthMetricsRefresh("accounts", "visible", false, false), false);
});

test("usage filters advance their time window on every refresh", () => {
  const input = { range: "24h" as const, envName: "all", accountName: "key", baseUrl: "all", model: "gpt-5" };
  const first = buildUsageFilter(input, 1_000_000_000);
  const second = buildUsageFilter(input, 1_000_005_000);
  assert.equal(second.to - first.to, 5_000);
  assert.equal(second.from - first.from, 5_000);
  assert.equal(second.envName, undefined);
  assert.equal(second.accountName, "key");
  assert.equal(second.model, "gpt-5");
});

test("shared refresh seconds clamp custom values and usage polling avoids hidden or overlapping requests", () => {
  assert.equal(normalizeRefreshSeconds(0), 1);
  assert.equal(normalizeRefreshSeconds(4.8), 5);
  assert.equal(normalizeRefreshSeconds(7200), 3600);
  assert.equal(normalizeRefreshSeconds(Number.NaN), 5);
  assert.equal(shouldScheduleUsageRefresh("visible", false), true);
  assert.equal(shouldScheduleUsageRefresh("hidden", false), false);
  assert.equal(shouldScheduleUsageRefresh("visible", true), false);
});
