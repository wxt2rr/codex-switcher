import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./claude-code-connection-panel.tsx", import.meta.url), "utf8");

test("Claude Code connection panel exposes config history and rollback actions", () => {
  assert.match(source, /listClaudeCodeConfigHistory/);
  assert.match(source, /restoreClaudeCodeConfigHistory/);
  assert.match(source, /deleteClaudeCodeConfigHistory/);
  assert.match(source, /配置历史/);
  assert.match(source, /回滚到此版本/);
  assert.match(source, /密钥值在历史预览中已脱敏/);
});

test("Claude Code connection panel surfaces authorization conflicts before connect", () => {
  assert.match(source, /authorization\?\.hasConflict/);
  assert.match(source, /备份并清理冲突授权/);
  assert.match(source, /cleanupAuthorization: true/);
  assert.match(source, /detectedAuthSources/);
  assert.match(source, /检测到的地址/);
});

test("Claude Code connection panel blocks connect when a shell token cannot be cleaned up", () => {
  assert.match(source, /hasConflict && !connection\.authorization\.canCleanup/);
  assert.match(source, /当前授权来自外部终端环境/);
  assert.match(source, /nonRemovableAuthorization/);
});
