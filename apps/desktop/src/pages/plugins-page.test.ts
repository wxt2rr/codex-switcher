import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./plugins-page.tsx", import.meta.url), "utf8");

test("plugin market derives install state from the installed plugin version", () => {
  assert.match(source, /const installedById = useMemo\(/);
  assert.match(source, /new Map\(installed\.map\(\(plugin\) => \[plugin\.id, plugin\]\)\)/);
  assert.match(source, /installed=\{installedById\.get\(plugin\.id\)\}/);
  assert.match(source, /comparePluginVersions\(plugin\.version, installed\.version\) > 0/);
});

test("plugin market uses explicit installed, upgrade, and install actions", () => {
  assert.match(source, /label=\{state === "upgrade" \? \(zh \? "可升级" : "Upgrade available"\) : \(zh \? "已安装" : "Installed"\)\}/);
  assert.match(source, /state === "upgrade" \? \(zh \? "升级" : "Upgrade"\) : state === "installed" \? \(zh \? "已安装" : "Installed"\) : \(zh \? "安装" : "Install"\)/);
  assert.match(source, /const canInstall = state !== "installed" && Boolean\(plugin\.source\)/);
  assert.match(source, /disabled=\{busy \|\| !canInstall\}/);
  assert.match(source, /getMarketPluginState\(pendingInstall, installedById\.get\(pendingInstall\.id\)\) === "upgrade"/);
});

test("plugin configuration entry points live on plugin cards", () => {
  assert.doesNotMatch(source, /配置 Claude Code/);
  assert.match(source, /onConfigure=\{hasPluginConfiguration\(plugin\)/);
  assert.match(source, /plugin\.id === "claude-code" \? setClaudeCodeOpen\(true\) : setSelected\(plugin\)/);
  assert.match(source, /function hasPluginConfiguration\(plugin/);
  assert.match(source, /onConfigure \? <Button/);
});
