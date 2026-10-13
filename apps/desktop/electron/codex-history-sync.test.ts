import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import assert from "node:assert/strict";

import initSqlJs from "sql.js";

import { syncCodexProviderHistory } from "./codex-history-sync.js";

test("provider history sync rewrites session metadata and thread index with a backup", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-history-sync-"));
  const home = join(root, "home");
  const state = join(root, "state");
  const sessions = join(home, "sessions", "2026", "10", "13");
  const sessionPath = join(sessions, "old.jsonl");
  const untouchedPath = join(sessions, "untouched.jsonl");
  const dbPath = join(home, "state_5.sqlite");
  try {
    await mkdir(sessions, { recursive: true });
    await writeFile(sessionPath, [
      JSON.stringify({ type: "session_meta", payload: { id: "old", model_provider: "custom" } }),
      JSON.stringify({ type: "message", payload: { text: "keep this body" } }),
      "",
    ].join("\n"), "utf8");
    await writeFile(untouchedPath, `${JSON.stringify({ type: "session_meta", payload: { id: "new", model_provider: "codex_switcher_router" } })}\n`, "utf8");

    const resolveFromWorkspace = createRequire(join(process.cwd(), "package.json"));
    const SQL = await initSqlJs({ locateFile: () => resolveFromWorkspace.resolve("sql.js/dist/sql-wasm.wasm") });
    const db = new SQL.Database();
    db.run("CREATE TABLE threads (id TEXT PRIMARY KEY, model_provider TEXT)");
    db.run("INSERT INTO threads VALUES ('old', 'custom'), ('new', 'codex_switcher_router'), ('native', 'openai')");
    await mkdir(home, { recursive: true });
    await writeFile(dbPath, Buffer.from(db.export()));
    db.close();

    const result = await syncCodexProviderHistory({ envName: "test", homePath: home, stateDir: state });
    assert.equal(result.sessionsScanned, 2);
    assert.equal(result.sessionsUpdated, 1);
    assert.equal(result.threadsUpdated, 2);
    assert.ok(result.backupPath);

    const rewritten = await readFile(sessionPath, "utf8");
    assert.match(rewritten, /"model_provider":"codex_switcher_router"/);
    assert.match(rewritten, /keep this body/);
    const backup = await readFile(join(result.backupPath!, "sessions", "2026", "10", "13", "old.jsonl"), "utf8");
    assert.match(backup, /"model_provider":"custom"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("provider history sync refuses a running environment", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-history-sync-running-"));
  try {
    await assert.rejects(
      syncCodexProviderHistory({
        envName: "test",
        homePath: join(root, "home"),
        stateDir: join(root, "state"),
        isRunning: async () => true,
      }),
      /while Codex is running/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
