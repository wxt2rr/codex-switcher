import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { CodexSubscriptionAccount } from "./codex-reset-card-utils.js";
import { SubscriptionQuotaManager, type CodexSubscriptionClientLike } from "./subscription-quota-manager.js";
import { CodexSubscriptionError } from "./codex-subscription-client.js";

function account(): CodexSubscriptionAccount {
  return {
    accountKey: "codex-subscription:acct-1",
    envName: "default",
    accountName: "plus",
    authMode: "auth",
    preferredAuthMethod: "chatgpt",
    authFile: "/tmp/auth.json",
    homePath: "/tmp/codex",
    accessToken: "token",
    accountId: "acct-1",
  };
}

function readResult(now: () => number) {
  return {
    accountId: "acct-1",
    usageWindows: [{ name: "weekly" as const, usedPercent: 100, used: true, exhausted: true, resetsAt: now() + 86_400_000 }],
    cards: [{ id: "card-safe", creditId: "credit-private", type: "weekly" as const, status: "available" as const }],
    observedAt: now(),
  };
}

test("manager deduplicates concurrent refreshes and retains canonical snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-reset-manager-"));
  let nowValue = 1_800_000_000_000;
  let reads = 0;
  const client: CodexSubscriptionClientLike = {
    async readAccount() {
      reads += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return readResult(() => nowValue);
    },
    async consume() { return { code: "reset", windowsReset: 1 }; },
  };
  const manager = new SubscriptionQuotaManager({ stateDir: dir, now: () => nowValue, client, discoverAccounts: async () => [account()] });
  await manager.start();
  assert.equal(reads, 1);
  const [first, second] = await Promise.all([
    manager.refreshAccount(account().accountKey, true),
    manager.refreshAccount(account().accountKey, true),
  ]);
  assert.equal(reads, 2);
  assert.deepEqual(first.snapshot.cards.map((card) => card.id), ["card-safe"]);
  assert.deepEqual(second.snapshot.cards.map((card) => card.id), ["card-safe"]);
  await manager.stop();
});

test("manager consumes a card with a unique request and refreshes after success", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-reset-manager-consume-"));
  let nowValue = 1_800_000_000_000;
  const requests: string[] = [];
  let available = true;
  const client: CodexSubscriptionClientLike = {
    async readAccount() {
      return { ...readResult(() => nowValue), cards: available ? readResult(() => nowValue).cards : [] };
    },
    async consume(_account, _creditId, requestId) {
      requests.push(requestId);
      available = false;
      return { code: "reset", windowsReset: 1 };
    },
  };
  const manager = new SubscriptionQuotaManager({ stateDir: dir, now: () => nowValue, client, discoverAccounts: async () => [account()] });
  await manager.start();
  await assert.rejects(manager.consume(account().accountKey, "card-safe"), /explicit confirmation/);
  const result = await manager.consume(account().accountKey, "card-safe", "manual", undefined, true);
  assert.equal(result.outcome.code, "reset");
  assert.equal(requests.length, 1);
  assert.match(requests[0]!, /^[0-9a-f-]{36}$/);
  const snapshots = await manager.getSnapshots();
  assert.equal(snapshots[0]?.count, 0);
  await manager.stop();
});

test("manager keeps the last good snapshot and honors retry-after backoff", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-reset-manager-backoff-"));
  let nowValue = 1_800_000_000_000;
  let reads = 0;
  const client: CodexSubscriptionClientLike = {
    async readAccount() {
      reads += 1;
      if (reads > 1) throw new CodexSubscriptionError("rate-limited", "rate limited", { retryAfterMs: 10 * 60_000 });
      return readResult(() => nowValue);
    },
    async consume() { return { code: "reset", windowsReset: 1 }; },
  };
  const manager = new SubscriptionQuotaManager({ stateDir: dir, now: () => nowValue, client, discoverAccounts: async () => [account()] });
  await manager.start();
  nowValue += 31_000;
  await assert.rejects(manager.refreshAccount(account().accountKey));
  const snapshot = (await manager.getSnapshots())[0]!;
  assert.equal(snapshot.status, "stale");
  assert.equal(snapshot.count, 1);
  const readsAfterFailure = reads;
  nowValue += 5 * 60_000;
  const cached = await manager.refreshAccount(account().accountKey);
  assert.equal(reads, readsAfterFailure);
  assert.equal(cached.snapshot.isStale, true);
  await manager.stop();
});

test("manager deduplicates the same subscription across environments", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-reset-manager-refs-"));
  let reads = 0;
  const second = { ...account(), envName: "wangxt", accountName: "plus-copy" };
  const client: CodexSubscriptionClientLike = {
    async readAccount() { reads += 1; return readResult(() => 1_800_000_000_000); },
    async consume() { return { code: "reset", windowsReset: 1 }; },
  };
  const manager = new SubscriptionQuotaManager({ stateDir: dir, client, discoverAccounts: async () => [account(), second] });
  await manager.start();
  assert.equal(reads, 1);
  const snapshots = await manager.getSnapshots();
  assert.deepEqual(snapshots[0]?.envNames.sort(), ["default", "wangxt"]);
  assert.deepEqual(snapshots[0]?.accountNames.sort(), ["plus", "plus-copy"]);
  await manager.stop();
});

test("manager refreshes after an account mutation and forwards normalized usage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-reset-manager-mutation-"));
  let reads = 0;
  const usage: string[] = [];
  const client: CodexSubscriptionClientLike = {
    async readAccount() { reads += 1; return readResult(() => 1_800_000_000_000 + reads); },
    async consume() { return { code: "reset", windowsReset: 1 }; },
  };
  const manager = new SubscriptionQuotaManager({ stateDir: dir, client, onUsageSnapshot: async (_key, windows) => { usage.push(String(windows.length)); }, discoverAccounts: async () => [account()] });
  await manager.start();
  await manager.notifyAccountsChanged();
  assert.equal(reads, 2);
  assert.deepEqual(usage, ["1", "1"]);
  await manager.stop();
});

test("automatic consumption creates a confirmable pending action and disabling cancels it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-reset-manager-pending-"));
  const client: CodexSubscriptionClientLike = {
    async readAccount() { return readResult(() => 1_800_000_000_000); },
    async consume() { return { code: "reset", windowsReset: 1 }; },
  };
  const events: string[] = [];
  const manager = new SubscriptionQuotaManager({ stateDir: dir, client, onOperation: (event) => events.push(event.status), discoverAccounts: async () => [account()] });
  await manager.start();
  await manager.setSettings({ autoUseMode: "weekly-exhausted", preConsumeMode: "confirm" });
  await manager.notifyAccountsChanged();
  const pending = await manager.getPendingActions();
  assert.equal(pending.length, 1);
  await manager.setSettings({ autoUseMode: "off" });
  assert.deepEqual(await manager.getPendingActions(), []);
  assert.ok(events.includes("canceled"));
  await manager.stop();
});

test("unauthorized refresh exposes reauthentication and cancels pending automation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-reset-manager-reauth-"));
  let reads = 0;
  const client: CodexSubscriptionClientLike = {
    async readAccount() {
      reads += 1;
      if (reads > 2) throw new CodexSubscriptionError("unauthorized", "credentials expired", { status: 401 });
      return readResult(() => 1_800_000_000_000);
    },
    async consume() { return { code: "reset", windowsReset: 1 }; },
  };
  const manager = new SubscriptionQuotaManager({ stateDir: dir, client, discoverAccounts: async () => [account()] });
  await manager.start();
  await manager.setSettings({ autoUseMode: "weekly-exhausted", preConsumeMode: "confirm" });
  await manager.notifyAccountsChanged();
  assert.equal((await manager.getPendingActions()).length, 1);
  await assert.rejects(manager.refreshAccount(account().accountKey, true), /credentials expired/);
  const snapshot = (await manager.getSnapshots())[0]!;
  assert.equal(snapshot.status, "unauthorized");
  assert.equal(snapshot.count, 1);
  assert.deepEqual(await manager.getPendingActions(), []);
  await manager.stop();
});

test("per-account consumption lock prevents a second destructive request", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-reset-manager-lock-"));
  let consumed = 0;
  let available = true;
  const client: CodexSubscriptionClientLike = {
    async readAccount() { return { ...readResult(() => 1_800_000_000_000), cards: available ? readResult(() => 1_800_000_000_000).cards : [] }; },
    async consume() { consumed += 1; available = false; await new Promise((resolve) => setTimeout(resolve, 5)); return { code: "reset", windowsReset: 1 }; },
  };
  const manager = new SubscriptionQuotaManager({ stateDir: dir, client, discoverAccounts: async () => [account()] });
  await manager.start();
  const results = await Promise.allSettled([
    manager.consume(account().accountKey, "card-safe", "manual", undefined, true),
    manager.consume(account().accountKey, "card-safe", "manual", undefined, true),
  ]);
  assert.equal(consumed, 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  await manager.stop();
});

test("gateway admission refuses fallback and generic 429, and creates confirmation when eligible", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-reset-manager-gateway-"));
  let consumed = 0;
  const client: CodexSubscriptionClientLike = {
    async readAccount() { return readResult(() => 1_800_000_000_000); },
    async consume() { consumed += 1; return { code: "reset", windowsReset: 1 }; },
  };
  const manager = new SubscriptionQuotaManager({ stateDir: dir, client, discoverAccounts: async () => [account()] });
  await manager.start();
  await manager.setSettings({ autoUseMode: "weekly-exhausted", preConsumeMode: "confirm" });
  assert.equal(await manager.consumeForGateway({ accountKey: account().accountKey, poolEnabled: true, viableFallback: true }), undefined);
  assert.equal(await manager.consumeForGateway({ accountKey: account().accountKey, poolEnabled: true, viableFallback: false, failureStatus: 429 }), undefined);
  assert.equal(await manager.consumeForGateway({ accountKey: account().accountKey, poolEnabled: true, viableFallback: false }), undefined);
  assert.equal(consumed, 0);
  assert.equal((await manager.getPendingActions()).length, 1);
  await manager.stop();
});
