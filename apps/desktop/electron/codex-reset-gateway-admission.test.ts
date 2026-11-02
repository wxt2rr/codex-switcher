import assert from "node:assert/strict";
import { test } from "node:test";

import { decideResetGatewayAdmission } from "./codex-reset-gateway-admission.js";

const base = {
  subscriptionAccount: true,
  weeklyExhausted: true,
  poolEnabled: true,
  viableFallback: false,
  alreadyRetried: false,
};

test("gateway admission allows one weekly reset only after candidate evaluation", () => {
  assert.deepEqual(decideResetGatewayAdmission(base), { allowed: true, reason: "eligible" });
  assert.deepEqual(decideResetGatewayAdmission({ ...base, viableFallback: true }), { allowed: false, reason: "fallback-available" });
  assert.deepEqual(decideResetGatewayAdmission({ ...base, alreadyRetried: true }), { allowed: false, reason: "already-retried" });
});

test("gateway admission never consumes on generic rate limits or non-subscription routes", () => {
  assert.equal(decideResetGatewayAdmission({ ...base, failureStatus: 429 }).allowed, false);
  assert.equal(decideResetGatewayAdmission({ ...base, failureReason: "generic_429" }).reason, "generic-rate-limit");
  assert.equal(decideResetGatewayAdmission({ ...base, subscriptionAccount: false }).reason, "not-subscription");
});
