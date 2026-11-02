import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createCodexSubscriptionStateStore, DEFAULT_RESET_CARD_SETTINGS } from "./codex-subscription-state.js";

test("subscription state store persists atomically without credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-reset-state-"));
  const store = createCodexSubscriptionStateStore(dir);
  await store.update((state) => {
    state.snapshots["codex:acct"] = {
      accountKey: "codex:acct",
      envNames: ["default"],
      accountNames: ["plus"],
      status: "fresh",
      cards: [{ id: "card-safe", creditId: "credit-private", type: "weekly", status: "available", expiresAt: 1_800_000_000_000 }],
      count: 1,
      usageWindows: [],
      observedAt: Date.now(),
      isStale: false,
    };
    return state;
  });
  const raw = await readFile(join(dir, "codex-subscription-state.json"), "utf8");
  assert.match(raw, /credit-private/);
  assert.doesNotMatch(raw, /access_token|refresh_token|Bearer/);
  const restored = await createCodexSubscriptionStateStore(dir).load();
  assert.equal(restored.snapshots["codex:acct"]?.cards[0]?.creditId, "credit-private");
  assert.deepEqual(restored.settings, DEFAULT_RESET_CARD_SETTINGS);
});

test("corrupt state is backed up and reset to safe defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-reset-state-corrupt-"));
  const path = join(dir, "codex-subscription-state.json");
  await writeFile(path, "{not-json", "utf8");
  const restored = await createCodexSubscriptionStateStore(dir).load();
  assert.deepEqual(restored.snapshots, {});
  assert.equal(restored.settings.autoUseMode, "off");
  const files = await (await import("node:fs/promises")).readdir(dir);
  assert.ok(files.some((file) => file.startsWith("codex-subscription-state.json.corrupt-")));
  assert.equal(restored.settings.version, 1);
});

test("state diagnostics expose recovery without exposing file contents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-reset-state-diagnostics-"));
  await writeFile(join(dir, "codex-subscription-state.json"), JSON.stringify({ version: 99, access_token: "secret" }), "utf8");
  const store = createCodexSubscriptionStateStore(dir);
  await store.load();
  const diagnostics = store.getDiagnostics();
  assert.equal(diagnostics.recoveredFromCorruption, true);
  assert.doesNotMatch(diagnostics.lastError ?? "", /secret/);
  assert.equal(typeof diagnostics.backupPath, "string");
});

test("multiple state store instances serialize atomic updates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-reset-state-lock-"));
  const first = createCodexSubscriptionStateStore(dir);
  const second = createCodexSubscriptionStateStore(dir);
  await Promise.all([
    first.update((state) => { state.reminders.push({ key: "one", accountKey: "a", cardId: "c1", threshold: "3h", sentAt: 1 }); }),
    second.update((state) => { state.reminders.push({ key: "two", accountKey: "a", cardId: "c2", threshold: "3h", sentAt: 2 }); }),
  ]);
  const restored = await createCodexSubscriptionStateStore(dir).load();
  assert.deepEqual(restored.reminders.map((item) => item.key).sort(), ["one", "two"]);
});

test("state migration clamps settings and preserves independent account overrides", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-reset-state-migration-"));
  await writeFile(join(dir, "codex-subscription-state.json"), JSON.stringify({
    version: 0,
    settings: {
      refreshIntervalMinutes: 999,
      preConsumeGraceSeconds: 1,
      autoUseMode: "both",
      perAccount: {
        "codex:a": { enabled: true, autoUseMode: "weekly-exhausted" },
        "codex:b": { enabled: false, autoUseMode: "expiring", preConsumeMode: "confirm" },
        invalid: { autoUseMode: "not-real" },
      },
    },
  }), "utf8");
  const state = await createCodexSubscriptionStateStore(dir).load();
  assert.equal(state.version, 1);
  assert.equal(state.settings.refreshIntervalMinutes, 60);
  assert.equal(state.settings.preConsumeGraceSeconds, 5);
  assert.equal(state.settings.perAccount["codex:a"]?.autoUseMode, "weekly-exhausted");
  assert.equal(state.settings.perAccount["codex:b"]?.enabled, false);
  assert.equal(state.settings.perAccount.invalid, undefined);
});
