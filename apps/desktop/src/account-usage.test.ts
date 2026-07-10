import test from "node:test";
import assert from "node:assert/strict";

import {
  formatUsageResetHint,
  getUsageProgressClass,
  localizeUsageMetricLabel,
  parseUsageMetric,
} from "./account-usage.js";

test("parseUsageMetric extracts percent and timestamp", () => {
  assert.deepEqual(parseUsageMetric("15% (06-18 13:30)"), {
    percent: 15,
    label: "15%",
    timestamp: "06-18 13:30",
  });
});

test("parseUsageMetric clamps values into the progress range", () => {
  assert.deepEqual(parseUsageMetric("120% (06-18 13:30)"), {
    percent: 100,
    label: "120%",
    timestamp: "06-18 13:30",
  });
});

test("parseUsageMetric keeps placeholder and unknown values readable", () => {
  assert.deepEqual(parseUsageMetric("-"), {
    percent: null,
    label: "-",
  });
  assert.deepEqual(parseUsageMetric("unknown"), {
    percent: null,
    label: "unknown",
  });
});

test("localizeUsageMetricLabel translates remote usage failure states", () => {
  assert.equal(localizeUsageMetricLabel("expired", "zh"), "已过期");
  assert.equal(localizeUsageMetricLabel("unauthorized", "zh"), "未授权");
  assert.equal(localizeUsageMetricLabel("network-failed", "en"), "network failed");
  assert.equal(localizeUsageMetricLabel("api-failed", "ja"), "API 失敗");
  assert.equal(localizeUsageMetricLabel("15%", "zh"), "15%");
});

test("getUsageProgressClass changes color as used percentage increases", () => {
  assert.match(getUsageProgressClass(0), /emerald/);
  assert.match(getUsageProgressClass(49), /emerald/);
  assert.match(getUsageProgressClass(50), /amber/);
  assert.match(getUsageProgressClass(69), /amber/);
  assert.match(getUsageProgressClass(70), /orange/);
  assert.match(getUsageProgressClass(84), /orange/);
  assert.match(getUsageProgressClass(85), /rose/);
  assert.match(getUsageProgressClass(100), /rose/);
});

test("formatUsageResetHint uses compact hours and day-hour countdowns", () => {
  const now = new Date(2026, 6, 10, 10, 0);

  assert.equal(formatUsageResetHint("07-10 14:30", "zh", now), "4h 后重置");
  assert.equal(formatUsageResetHint("07-17 09:30", "zh", now), "6d23h 后重置");
  assert.equal(formatUsageResetHint("07-10 14:30", "en", now), "Resets in 4h");
});
