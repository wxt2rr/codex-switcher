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

test("Gateway operations exposes structured provider, credential, model, route-group, and agent editing", async () => {
  const source = await readFile(sourcePath("./operations-page.tsx"), "utf8");
  const editor = await readFile(sourcePath("./gateway-admin-editor.tsx"), "utf8");
  assert.match(source, /GatewayAdminStructuredEditor/);
  assert.match(source, /结构化表单/);
  for (const field of ["providers", "credentials", "models", "routeGroups", "agentBindings"]) {
    assert.match(editor, new RegExp(field));
  }
  assert.match(editor, /plaintext secrets are never exposed|不会暴露或保存明文密钥/);
  assert.match(source, /已漂移|Drifted/);
  assert.match(source, /配置缺失|Missing/);
});

test("Provider plugin operations exposes a signed, explicit-source market", async () => {
  const source = await readFile(sourcePath("./operations-page.tsx"), "utf8");
  assert.match(source, /Provider 插件市场/);
  assert.match(source, /refreshProviderPluginMarket/);
  assert.match(source, /local\/npm\/git/);
  assert.match(source, /签名条目在未配置受信校验器时会被拒绝/);
});

test("settings page exposes login-at-startup control without adding intent routing", async () => {
  const source = await readFile(sourcePath("./operations-page.tsx"), "utf8");
  const app = await readFile(sourcePath("../react-app.tsx"), "utf8");
  assert.match(source, /登录启动/);
  assert.match(source, /launchAtLogin.supported/);
  assert.match(app, /setLaunchAtLoginSettings/);
  assert.doesNotMatch(source, /intent classifier|prompt intent/i);
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
