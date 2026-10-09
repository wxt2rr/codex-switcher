import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const sourcePath = (file: string) => new URL(file, import.meta.url);

test("settings page exposes the opt-in environment badge flow", async () => {
  const source = await readFile(sourcePath("./operations-page.tsx"), "utf8");
  assert.match(source, /Codex App 环境标识/);
  assert.match(source, /需要辅助功能权限/);
  assert.match(source, /不会自动重启/);
  assert.match(source, /bg-\[#34C759\]/);
});

test("permission flow rechecks after returning from System Settings", async () => {
  const source = await readFile(sourcePath("../react-app.tsx"), "utf8");
  assert.match(source, /appEnvironmentBadgePermissionPending/);
  assert.match(source, /window\.addEventListener\("focus", scheduleRecheck\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
  assert.match(source, /window\.setInterval\(\(\) => \{ void recheckPermission\(\); \}, 750\)/);
  assert.match(source, /void recheckPermission\(\)/);
  assert.match(source, /返回此窗口，环境标识会自动继续开启/);
  assert.doesNotMatch(source, /未获得辅助功能权限，环境标识尚未开启/);
});

test("settings page does not render gateway or provider runtime panels", async () => {
  const source = await readFile(sourcePath("./operations-page.tsx"), "utf8");
  assert.doesNotMatch(source, /Gateway 运营视图|Gateway operations/);
  assert.doesNotMatch(source, /Provider 插件运行时|Provider plugin runtime/);
  assert.doesNotMatch(source, /gatewayAdminSnapshot|providerPlugins|providerPluginMarket/);
});

test("settings page exposes login-at-startup control without adding intent routing", async () => {
  const source = await readFile(sourcePath("./operations-page.tsx"), "utf8");
  const app = await readFile(sourcePath("../react-app.tsx"), "utf8");
  assert.match(source, /登录启动/);
  assert.match(source, /launchAtLogin.supported/);
  assert.match(app, /setLaunchAtLoginSettings/);
  assert.doesNotMatch(source, /intent classifier|prompt intent/i);
});

test("settings page exposes independent menu bar and Dock visibility controls", async () => {
  const source = await readFile(sourcePath("./operations-page.tsx"), "utf8");
  const app = await readFile(sourcePath("../react-app.tsx"), "utf8");
  assert.match(source, /应用图标显示/);
  assert.match(source, /菜单栏图标/);
  assert.match(source, /Dock 图标/);
  assert.match(source, /至少保留菜单栏图标或 Dock 图标中的一个/);
  assert.match(source, /isLastVisibleIcon/);
  assert.match(app, /getAppPresenceSettings/);
  assert.match(app, /setAppPresenceSettings/);
});

test("settings page renders and refreshes the selected runtime log", async () => {
  const source = await readFile(sourcePath("./operations-page.tsx"), "utf8");
  const app = await readFile(sourcePath("../react-app.tsx"), "utf8");
  assert.match(source, /logContent/);
  assert.match(source, /whitespace-pre-wrap/);
  assert.match(app, /readTokenRefreshLog\(\)/);
  assert.match(app, /readSwitcherLog\(\)/);
  assert.match(app, /setInterval\(\(\) => \{ void loadLog\(\); \}, 1_500\)/);
});
