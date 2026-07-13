import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readCliAutoResumeSettings,
  readEnvHistoryRetentionSettings,
  readRouterLifecycleSettings,
  readRouterPortSettings,
  saveCliAutoResumeSettings,
  saveEnvHistoryRetentionSettings,
  saveRouterLifecycleSettings,
  saveRouterPortSettings,
} from "./desktop-settings.js";

test("CLI auto resume settings default to disabled and session one", async () => {
  const root = await mkdtemp(join(tmpdir(), "desktop-settings-"));
  assert.deepEqual(await readCliAutoResumeSettings(join(root, "settings.json")), { enabled: false, sessionNumber: 1 });
});

test("CLI auto resume settings persist without removing tool paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "desktop-settings-save-"));
  const path = join(root, "settings.json");
  await writeFile(path, JSON.stringify({ cliPath: "/bin/codex" }));
  assert.deepEqual(await saveCliAutoResumeSettings(path, { enabled: true, sessionNumber: 3 }), { enabled: true, sessionNumber: 3 });
  assert.equal(JSON.parse(await readFile(path, "utf8")).cliPath, "/bin/codex");
});

test("router lifecycle defaults to keeping the proxy alive and persists independently", async () => {
  const root = await mkdtemp(join(tmpdir(), "desktop-router-lifecycle-"));
  const path = join(root, "settings.json");
  assert.deepEqual(await readRouterLifecycleSettings(path), { stopOnAppQuit: false });

  await saveCliAutoResumeSettings(path, { enabled: true, sessionNumber: 3 });
  assert.deepEqual(await saveRouterLifecycleSettings(path, { stopOnAppQuit: true }), { stopOnAppQuit: true });
  assert.deepEqual(await readRouterLifecycleSettings(path), { stopOnAppQuit: true });
  assert.deepEqual(await readCliAutoResumeSettings(path), { enabled: true, sessionNumber: 3 });
});

test("router port defaults to 17832, persists, and rejects invalid values", async () => {
  const root = await mkdtemp(join(tmpdir(), "desktop-router-port-"));
  const path = join(root, "settings.json");
  assert.deepEqual(await readRouterPortSettings(path), { preferredPort: 17832 });
  assert.deepEqual(await saveRouterPortSettings(path, { preferredPort: 19090 }), { preferredPort: 19090 });
  assert.deepEqual(await readRouterPortSettings(path), { preferredPort: 19090 });
  assert.deepEqual(await saveRouterPortSettings(path, { preferredPort: 70000 }), { preferredPort: 17832 });
});

test("environment history retention defaults safely and clamps to 1-365 days", async () => {
  const root = await mkdtemp(join(tmpdir(), "desktop-history-retention-"));
  const path = join(root, "settings.json");
  assert.deepEqual(await readEnvHistoryRetentionSettings(path), { enabled: false, retentionDays: 30 });

  assert.deepEqual(await saveEnvHistoryRetentionSettings(path, { enabled: true, retentionDays: 999 }), {
    enabled: true,
    retentionDays: 365,
  });
  assert.deepEqual(await readEnvHistoryRetentionSettings(path), { enabled: true, retentionDays: 365 });
  assert.deepEqual(await saveEnvHistoryRetentionSettings(path, { enabled: true, retentionDays: 0 }), {
    enabled: true,
    retentionDays: 1,
  });
});
