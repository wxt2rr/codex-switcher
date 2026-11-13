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

test("Claude Code connection panel supports a default model and a multi-select model picker", () => {
  assert.match(source, /selectedOfficialModelIds/);
  assert.match(source, /modelOverrides/);
  assert.match(source, /modelIds: selectedOfficialModelIds/);
  assert.match(source, /Claude 官方模型/);
  assert.match(source, /实际调用模型/);
  assert.match(source, /默认模型/);
  assert.match(source, /模型列表/);
  assert.match(source, /在 Claude Code 的 \/model 中显示/);
  assert.match(source, /type="checkbox"/);
  assert.match(source, /claude-sonnet-4-6/);
});

test("Claude Code connection panel can inspect and edit settings.json", () => {
  assert.match(source, /readClaudeCodeConfig/);
  assert.match(source, /updateClaudeCodeConfig/);
  assert.match(source, /openConfig/);
  assert.match(source, /保存前会自动备份当前内容/);
  assert.match(source, /手动修改前备份/);
  const statusCard = source.slice(source.indexOf("title={connection.configPath}"), source.indexOf("{connection.authorization?.hasConflict"));
  assert.match(statusCard, /openConfig/);
  assert.match(statusCard, /openHistory/);
});

test("Claude Code settings editor keeps actions fixed and scrolls only the JSON editor", () => {
  assert.match(source, /scrollable=\{!configOpen\}/);
  assert.match(source, /surfaceClassName="max-w-\[600px\]"/);
  assert.match(source, /min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg/);
  assert.match(source, /overflow-x-hidden overflow-y-auto rounded-lg/);
  assert.match(source, /保存配置/);
  assert.match(source, /取消/);
});
