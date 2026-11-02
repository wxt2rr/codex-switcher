import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CodexSubscriptionClient } from "./codex-subscription-client.js";
import type { CodexSubscriptionAccount } from "./codex-reset-card-utils.js";
import { SubscriptionQuotaManager } from "./subscription-quota-manager.js";

test("subscription quota production flow syncs, notifies, confirms, consumes, and re-reads a fake upstream", async () => {
  let consumed = false;
  let consumeRequests = 0;
  const rawCreditId = "credit-private-e2e";
  const upstream = createServer(async (request, response) => {
    if (request.url === "/wham/usage") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ plan_type: "plus", rate_limit: {
        primary_window: { window_minutes: 300, used_percent: consumed ? 0 : 20, resets_at: Date.now() + 3_600_000 },
        secondary_window: { window_minutes: 10_080, used_percent: consumed ? 0 : 100, resets_at: Date.now() + 86_400_000 },
      } }));
      return;
    }
    if (request.url === "/wham/rate-limit-reset-credits" && request.method === "GET") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ account_id: "acct-e2e", credits: consumed ? [] : [{ id: rawCreditId, reset_type: "weekly", expires_at: new Date(Date.now() + 3_600_000).toISOString(), status: "available" }] }));
      return;
    }
    if (request.url === "/wham/rate-limit-reset-credits/consume" && request.method === "POST") {
      consumeRequests += 1;
      for await (const _chunk of request) { /* drain */ }
      consumed = true;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ code: "reset", windows_reset: 1 }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  assert(address && typeof address !== "string");
  const account: CodexSubscriptionAccount = {
    accountKey: "codex-subscription:acct-e2e",
    envName: "default",
    accountName: "plus",
    authMode: "auth",
    preferredAuthMethod: "chatgpt",
    authFile: "/tmp/auth.json",
    homePath: "/tmp/codex",
    accessToken: "e2e-token",
    accountId: "acct-e2e",
  };
  const notifications: Array<{ kind: string; message: string }> = [];
  const stateDir = await mkdtemp(join(tmpdir(), "codex-subscription-e2e-"));
  const manager = new SubscriptionQuotaManager({
    stateDir,
    client: new CodexSubscriptionClient({ baseUrl: `http://127.0.0.1:${address.port}`, timeoutMs: 2_000 }),
    discoverAccounts: async () => [account],
    onNotify: (event) => {
      notifications.push({ kind: event.kind, message: event.message });
    },
  });
  try {
    await manager.setSettings({ notificationsEnabled: true, expiryReminder: "24h", autoUseMode: "expiring", preConsumeMode: "confirm" });
    await manager.start();
    const first = (await manager.getSnapshots())[0]!;
    assert.equal(first.count, 1);
    assert.equal(first.cards[0]?.id.startsWith("card-"), true);
    assert.equal(JSON.stringify(first).includes(rawCreditId), false);
    const pending = await manager.getPendingActions();
    assert.equal(pending.length, 1);
    assert.deepEqual(notifications.map((item) => item.kind), ["expiring", "pre-consume"]);
    await manager.confirmPendingAction(account.accountKey, pending[0]!.id);
    const after = (await manager.getSnapshots())[0]!;
    assert.equal(consumeRequests, 1);
    assert.equal(after.count, 0);
    assert.ok(notifications.some((item) => item.kind === "consumed"));
    assert.equal(JSON.stringify(notifications).includes(rawCreditId), false);
  } finally {
    await manager.stop();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});
