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
  const codexProjectsPath = join(desktopRoot, "electron-dist", "electron", "codex-projects.cjs");
  const desktopSettingsPath = join(desktopRoot, "electron-dist", "electron", "desktop-settings.cjs");
  const generatedImageRecoverySkillPath = join(desktopRoot, "electron-dist", "electron", "generated-image-recovery-skill.cjs");
  const envHistoryRetentionPath = join(desktopRoot, "electron-dist", "electron", "env-history-retention.cjs");
  const cliTerminalSettingsPath = join(desktopRoot, "electron-dist", "electron", "cli-terminal-settings.cjs");
  const modelCatalogStorePath = join(desktopRoot, "electron-dist", "electron", "model-catalog-store.cjs");
  const accountModelCatalogPath = join(desktopRoot, "electron-dist", "electron", "account-model-catalog.cjs");
  const compatibilityHandlerPath = join(desktopRoot, "electron-dist", "electron", "openai-chat-compat", "compatibility-handler.js");
  const electronModuleBoundaryPath = join(desktopRoot, "electron-dist", "electron", "package.json");

  await access(mainPath, constants.F_OK);
  await access(preloadPath, constants.F_OK);
  await access(runtimePathsPath, constants.F_OK);
  await access(codexToolPathsPath, constants.F_OK);
  await access(codexProjectsPath, constants.F_OK);
  await access(desktopSettingsPath, constants.F_OK);
  await access(generatedImageRecoverySkillPath, constants.F_OK);
  await access(envHistoryRetentionPath, constants.F_OK);
  await access(cliTerminalSettingsPath, constants.F_OK);
  await access(modelCatalogStorePath, constants.F_OK);
  await access(accountModelCatalogPath, constants.F_OK);
  await access(compatibilityHandlerPath, constants.F_OK);
  await access(electronModuleBoundaryPath, constants.F_OK);

  const mainSource = await readFile(mainPath, "utf8");
  assert.match(mainSource, /BrowserWindow/);
  assert.match(mainSource, /preload\.cjs/);
  assert.match(mainSource, /dist", "index\.html"/);
  assert.match(mainSource, /"\.\."/);
  assert.match(mainSource, /autoHideMenuBar/);
  assert.match(mainSource, /setMenuBarVisibility\(false\)/);
  assert.match(mainSource, /setMenu\(null\)/);
  assert.match(mainSource, /setApplicationMenu\(null\)/);
  assert.match(mainSource, /logo-win\.png/);
  assert.match(mainSource, /await createWindow\(\);\s*startEnvHistoryCleanupSchedule\(\)/);
  assert.match(mainSource, /void \(0, \w+\.runEnvHistoryRetentionCleanup\)\(\)\.catch/);
  assert.doesNotMatch(mainSource, /await \(0, \w+\.runEnvHistoryRetentionCleanup\)/);

  const runtimePathsSource = await readFile(runtimePathsPath, "utf8");
  assert.match(runtimePathsSource, /CODEX_SWITCHER_DESKTOP_RESOURCES_PATH/);

  const bridgeSource = await readFile(join(desktopRoot, "electron-dist", "electron", "bridge.cjs"), "utf8");
  assert.match(bridgeSource, /require\("\.\/codex-projects\.cjs"\)/);
  assert.doesNotMatch(bridgeSource, /require\("\.\/codex-projects\.js"\)/);
  assert.match(bridgeSource, /require\("\.\/desktop-settings\.cjs"\)/);
  assert.match(bridgeSource, /require\("\.\/generated-image-recovery-skill\.cjs"\)/);
  assert.match(bridgeSource, /require\("\.\/env-history-retention\.cjs"\)/);
  assert.doesNotMatch(bridgeSource, /require\("\.\/desktop-settings\.js"\)/);
  assert.match(bridgeSource, /require\("\.\/cli-terminal-settings\.cjs"\)/);
  assert.match(bridgeSource, /require\("\.\/model-catalog-store\.cjs"\)/);
  assert.doesNotMatch(bridgeSource, /require\("\.\/model-catalog-store\.js"\)/);
  assert.match(bridgeSource, /require\("\.\/account-model-catalog\.cjs"\)/);
  assert.doesNotMatch(bridgeSource, /require\("\.\/account-model-catalog\.js"\)/);

  const accountModelCatalogSource = await readFile(accountModelCatalogPath, "utf8");
  assert.match(accountModelCatalogSource, /require\("\.\/model-catalog-store\.cjs"\)/);
  assert.deepEqual(JSON.parse(await readFile(electronModuleBoundaryPath, "utf8")), { type: "commonjs" });
  const compatibilitySource = await readFile(compatibilityHandlerPath, "utf8");
  assert.match(compatibilitySource, /handleChatCompatibilityRequest/);
  assert.doesNotMatch(compatibilitySource, /CLIProxyAPI|cc-switch|child_process/);

  const htmlSource = await readFile(join(desktopRoot, "dist", "index.html"), "utf8");
  assert.doesNotMatch(htmlSource, /src="\/assets\//);
  assert.doesNotMatch(htmlSource, /href="\/assets\//);
});

test("desktop package defines packaged artifact verification script", async () => {
  const verifyScriptPath = join(desktopRoot, "scripts", "verify-package-artifact.mjs");
  const windowsIconPath = join(desktopRoot, "build", "icon.ico");
  const windowsRuntimeIconPath = join(desktopRoot, "public", "logo-win.png");

  await access(verifyScriptPath, constants.F_OK);
  await access(windowsIconPath, constants.F_OK);
  await access(windowsRuntimeIconPath, constants.F_OK);

  const verifySource = await readFile(verifyScriptPath, "utf8");
  assert.match(verifySource, /CFBundleDisplayName/);
  assert.match(verifySource, /icon\.icns/);
});
