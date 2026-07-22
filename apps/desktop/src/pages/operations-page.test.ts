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
