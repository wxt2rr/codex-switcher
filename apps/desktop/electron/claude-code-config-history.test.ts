import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  appendClaudeCodeConfigHistoryEntry,
  deleteClaudeCodeConfigHistoryEntries,
  listClaudeCodeConfigHistoryEntries,
  redactConfigContent,
  toClaudeCodeConfigHistoryPreview,
} from "./claude-code-config-history.js";

test("Claude Code config history stores restricted snapshots and returns redacted previews", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "claude-code-history-"));
  const content = JSON.stringify({ env: { ANTHROPIC_API_KEY: "secret-api-key", ANTHROPIC_MODEL: "model" } }, null, 2);
  const entry = await appendClaudeCodeConfigHistoryEntry({
    stateDir,
    configPath: "/tmp/.claude/settings.json",
    source: "connect",
    content,
  });

  const entries = await listClaudeCodeConfigHistoryEntries(stateDir);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.content, content);
  assert.equal((await stat(join(stateDir, "history", "agent-files", "claude-code"))).mode & 0o777, 0o700);
  assert.equal((await stat(join(stateDir, "history", "agent-files", "claude-code", `${entry.id}.json`))).mode & 0o777, 0o600);
  const preview = toClaudeCodeConfigHistoryPreview(entry);
  assert.match(preview.contentPreview, /ANTHROPIC_API_KEY/);
  assert.doesNotMatch(preview.contentPreview, /secret-api-key/);
  assert.match(preview.contentPreview, /••••/);
});

test("Claude Code config history can delete selected entries without accepting path traversal", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "claude-code-history-delete-"));
  const entry = await appendClaudeCodeConfigHistoryEntry({ stateDir, configPath: "/tmp/settings.json", source: "restore", content: "{}\n" });
  assert.equal(await deleteClaudeCodeConfigHistoryEntries(stateDir, ["../outside", entry.id]), 1);
  assert.deepEqual(await listClaudeCodeConfigHistoryEntries(stateDir), []);
  assert.equal(redactConfigContent('{"token":"value"}'), '{"token":"••••"}');
});
