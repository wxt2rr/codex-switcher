import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getCliTerminalSettings, saveCliTerminalSelection } from "./cli-terminal-settings.js";

test("macOS terminal discovery follows the agreed priority and persists the fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminal-settings-mac-"));
  const settingsPath = join(root, "settings.json");
  const result = await getCliTerminalSettings({
    settingsPath,
    platform: "darwin",
    pathExists: async (path) => path === "/Applications/iTerm.app" || path === "/System/Applications/Utilities/Terminal.app",
  });
  assert.deepEqual(result.terminals.map((item) => item.id), ["iterm", "terminal"]);
  assert.equal(result.terminals[0]?.iconPath, "/Applications/iTerm.app");
  assert.equal(result.selectedId, "iterm");
  assert.equal(JSON.parse(await readFile(settingsPath, "utf8")).cliTerminalId, "iterm");
});

test("Windows discovery keeps installed terminals and system fallbacks", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminal-settings-win-"));
  const result = await getCliTerminalSettings({
    settingsPath: join(root, "settings.json"),
    platform: "win32",
    commandExists: async (command) => command === "wt.exe" || command === "pwsh.exe",
  });
  assert.deepEqual(result.terminals.map((item) => item.id), ["windows-terminal", "powershell7", "windows-powershell", "command-prompt"]);
  assert.equal(result.selectedId, "windows-terminal");
});

test("saving rejects a terminal that is not currently available", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminal-settings-save-"));
  await assert.rejects(() => saveCliTerminalSelection(join(root, "settings.json"), "warp", [{ id: "terminal", label: "Terminal", supportsCurrentWindow: true }]), /not available/);
});
