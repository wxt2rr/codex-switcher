import assert from "node:assert/strict";
import { test } from "node:test";

import { buildResetNotificationEvent } from "./codex-reset-notifications.js";

test("notification builder redacts credentials and uses stable safe dedupe keys", () => {
  const event = buildResetNotificationEvent({
    kind: "sync-error",
    accountKey: "codex-subscription:acct",
    message: "Bearer very-secret access_token=abc123",
    snapshot: { accountKey: "codex-subscription:acct", envNames: ["default"], accountNames: ["plus"], status: "stale", cards: [{ id: "card-safe", type: "weekly", status: "available", expiresAt: 1_800_000_000_000 }], count: 1, usageWindows: [], isStale: true },
  });
  assert.equal(event.title, "Codex 订阅同步提醒");
  assert.doesNotMatch(event.message, /very-secret|abc123/);
  assert.match(event.dedupeKey, /^sync-error:codex-subscription:acct:/);
  assert.equal(event.accountName, "plus");
});
