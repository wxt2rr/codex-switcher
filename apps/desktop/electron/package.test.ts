import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { join } from "node:path";

const desktopRoot = existsSync(join(process.cwd(), "apps", "desktop", "package.json"))
  ? join(process.cwd(), "apps", "desktop")
  : process.cwd();

test("desktop build emits electron main entry and preload bundle", async () => {
  const mainPath = join(desktopRoot, "electron-dist", "electron", "main.cjs");
  const preloadPath = join(desktopRoot, "electron-dist", "electron", "preload.cjs");
  const runtimePathsPath = join(desktopRoot, "electron-dist", "electron", "runtime-paths.cjs");
  const codexToolPathsPath = join(desktopRoot, "electron-dist", "electron", "codex-tool-paths.cjs");

  await access(mainPath, constants.F_OK);
  await access(preloadPath, constants.F_OK);
  await access(runtimePathsPath, constants.F_OK);
  await access(codexToolPathsPath, constants.F_OK);

  const mainSource = await readFile(mainPath, "utf8");
  assert.match(mainSource, /BrowserWindow/);
  assert.match(mainSource, /preload\.cjs/);
  assert.match(mainSource, /dist", "index\.html"/);
  assert.match(mainSource, /"\.\."/);
  assert.match(mainSource, /autoHideMenuBar/);
  assert.match(mainSource, /setMenuBarVisibility\(false\)/);
  assert.match(mainSource, /setMenu\(null\)/);

  const runtimePathsSource = await readFile(runtimePathsPath, "utf8");
  assert.match(runtimePathsSource, /CODEX_SWITCHER_DESKTOP_RESOURCES_PATH/);

  const htmlSource = await readFile(join(desktopRoot, "dist", "index.html"), "utf8");
  assert.doesNotMatch(htmlSource, /src="\/assets\//);
  assert.doesNotMatch(htmlSource, /href="\/assets\//);
});

test("desktop package defines packaged artifact verification script", async () => {
  const verifyScriptPath = join(desktopRoot, "scripts", "verify-package-artifact.mjs");

  await access(verifyScriptPath, constants.F_OK);

  const verifySource = await readFile(verifyScriptPath, "utf8");
  assert.match(verifySource, /CFBundleDisplayName/);
  assert.match(verifySource, /icon\.icns/);
});
