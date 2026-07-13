import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { saveEnvHistoryRetentionSettings } from "./desktop-settings.js";
import { runEnvHistoryCleanupIfDue } from "./env-history-retention.js";

async function writeHistoryEntry(root: string, envName: string, id: string, createdAt: string) {
  const directory = join(root, "history", "env-files", envName);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${id}.json`), JSON.stringify({ id, envName, createdAt }), "utf8");
}

test("daily cleanup deletes only entries older than the retention window", async () => {
  const root = await mkdtemp(join(tmpdir(), "env-history-retention-"));
  const settingsPath = join(root, "desktop-settings.json");
  await saveEnvHistoryRetentionSettings(settingsPath, { enabled: true, retentionDays: 30 });
  await writeHistoryEntry(root, "default", "old", "2026-01-01T00:00:00.000Z");
  await writeHistoryEntry(root, "default", "recent", "2026-02-20T00:00:00.000Z");
  await writeHistoryEntry(root, "test", "other-old", "2025-12-01T00:00:00.000Z");

  const result = await runEnvHistoryCleanupIfDue({
    stateDir: root,
    settingsPath,
    now: new Date("2026-03-01T00:00:00.000Z"),
  });

  assert.equal(result.ran, true);
  assert.equal(result.deleted, 2);
  await assert.rejects(() => readFile(join(root, "history", "env-files", "default", "old.json")));
  assert.match(await readFile(join(root, "history", "env-files", "default", "recent.json"), "utf8"), /recent/);
});

test("cleanup runs at most once per local date unless forced", async () => {
  const root = await mkdtemp(join(tmpdir(), "env-history-daily-"));
  const settingsPath = join(root, "desktop-settings.json");
  await saveEnvHistoryRetentionSettings(settingsPath, { enabled: true, retentionDays: 7 });
  const now = new Date(2026, 2, 1, 10, 0, 0);

  assert.equal((await runEnvHistoryCleanupIfDue({ stateDir: root, settingsPath, now })).reason, "completed");
  assert.equal((await runEnvHistoryCleanupIfDue({ stateDir: root, settingsPath, now })).reason, "already-completed");
  assert.equal((await runEnvHistoryCleanupIfDue({ stateDir: root, settingsPath, now, force: true })).reason, "completed");
});

test("disabled retention does not scan history", async () => {
  const root = await mkdtemp(join(tmpdir(), "env-history-disabled-"));
  const settingsPath = join(root, "desktop-settings.json");
  const result = await runEnvHistoryCleanupIfDue({ stateDir: root, settingsPath, now: new Date() });

  assert.deepEqual({ ran: result.ran, reason: result.reason, scanned: result.scanned }, {
    ran: false,
    reason: "disabled",
    scanned: 0,
  });
});
