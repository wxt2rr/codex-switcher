import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateAutoUse, expiryReminderLeadMs } from "./codex-reset-policy.js";

const now = 1_800_000_000_000;

test("auto-use selects the earliest available card for exhausted weekly quota", () => {
  const decision = evaluateAutoUse({
    cards: [
      { id: "late", type: "weekly", status: "available", expiresAt: now + 20_000 },
      { id: "soon", type: "weekly", status: "available", expiresAt: now + 10_000 },
    ],
    usageWindows: [{ name: "weekly", used: true, exhausted: true, resetsAt: now + 100_000 }],
  }, { now, mode: "weekly-exhausted", expiringLeadMs: 30_000, consumption: [], accountKey: "a" });
  assert.equal(decision?.cardId, "soon");
  assert.equal(decision?.trigger, "weekly-exhausted");
});

test("expiring cards are not spent when a normal window recovers first", () => {
  const decision = evaluateAutoUse({
    cards: [{ id: "card", type: "weekly", status: "available", expiresAt: now + 60_000 }],
    usageWindows: [{ name: "five-hour", used: true, exhausted: true, resetsAt: now + 10_000 }],
  }, { now, mode: "expiring", expiringLeadMs: 120_000, consumption: [], accountKey: "a" });
  assert.equal(decision, undefined);
});

test("expiring automation stays safe when recovery time is unknown", () => {
  const decision = evaluateAutoUse({
    cards: [{ id: "card", type: "weekly", status: "available", expiresAt: now + 60_000 }],
    usageWindows: [{ name: "five-hour", used: true, exhausted: true }],
  }, { now, mode: "expiring", expiringLeadMs: 120_000, consumption: [], accountKey: "a" });
  assert.equal(decision, undefined);
});

test("reminder lead values are explicit", () => {
  assert.equal(expiryReminderLeadMs("3h"), 3 * 60 * 60_000);
  assert.equal(expiryReminderLeadMs("off"), undefined);
});
