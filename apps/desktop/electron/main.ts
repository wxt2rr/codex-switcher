import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, type IpcMainInvokeEvent } from "electron";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

import {
  createEnv,
  copyAccount,
  deleteAccount,
  deleteEnv,
  getLanguage,
  launchCliInTerminal,
  loadAuthMetrics,
  loadOverview,
  logoutAccount,
  logoutApp,
  importDefaultEnv,
  listOperations,
  listAccountProjects,
  nativeLogin,
  readAppStatus,
  readSwitcherLog,
  readTokenRefreshLog,
  readEnvConfig,
  readEnvFiles,
  readTokenRefreshStatus,
  runDoctor,
  runRecover,
  runTokenRefreshOnce,
  setProxy,
  setLanguage,
  showProxy,
  disableProxy,
  stopManagedApp,
  switchAccount,
  switchEnv,
  startTokenRefresh,
  stopTokenRefresh,
  testProxy,
  updateEnv,
  updateEnvConfig,
  updateEnvFiles,
  listEnvFileHistory,
  restoreEnvFileHistory,
  deleteEnvFileHistory,
  updateIndependentModel,
  enableAccountCompatibility,
  disableAccountCompatibility,
  getAccountCompatibilityStatuses,
  checkAccountCompatibility,
  updateRuntime,
  getEnvironmentRouteStatuses,
  getCodexToolPaths,
  getCliAutoResumeSettings,
  getEnvHistoryRetentionSettings,
  getGeneratedImageRecoverySettings,
  getRouterLifecycleSettings,
  getRouterPortSettings,
  detectCodexToolPaths,
  setCodexToolPath,
  setCliAutoResumeSettings,
  setEnvHistoryRetentionSettings,
  setGeneratedImageRecoverySettings,
  setRouterLifecycleSettings,
  setRouterPortSettings,
  clearCodexToolPath,
  toggleEnvironmentRoute,
  listAccountPools,
  saveAccountPool,
  loadUsageSnapshot,
  loadUsageRequests,
  listUsagePricing,
  saveUsagePricing,
  getCliTerminalSettings,
  scanCliTerminalSettings,
  setCliTerminalSelection,
  listCustomModels,
  saveCustomModel,
  deleteCustomModel,
  setAccountModelBindings,
  setModelAccountBindings,
  stopUsageRouter,
  runEnvHistoryRetentionCleanup,
  getSkillSnapshot,
  installSkill,
  checkSkillUpdates,
  updateSkill,
  uninstallSkill,
  setSkillProviderBinding,
  repairSkillProvider,
} from "./bridge.js";

const currentDir = __dirname;
const execFileAsync = promisify(execFile);
const appDir = dirname(currentDir);
process.env.CODEX_SWITCHER_DESKTOP_RESOURCES_PATH = process.resourcesPath;

function resolveDesktopLogoPath() {
  const fileName = process.platform === "win32" ? "logo-win.png" : "logo.png";
  const candidatePaths = [
    join(appDir, "..", "dist", fileName),
    join(app.getAppPath(), "dist", fileName),
    join(process.cwd(), "apps", "desktop", "public", fileName),
    join(appDir, "..", "dist", "logo.png"),
    join(app.getAppPath(), "dist", "logo.png"),
    join(process.cwd(), "apps", "desktop", "public", "logo.png"),
  ];
  return candidatePaths.find((candidate) => existsSync(candidate));
}

async function createWindow() {
  const iconPath = resolveDesktopLogoPath();
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 780,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#f2f2f7",
    icon: iconPath,
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: join(currentDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  if (process.platform !== "darwin") {
    window.setMenuBarVisibility(false);
    window.setMenu(null);
  }

  const devServerUrl = process.env.CODEX_SWITCHER_DESKTOP_DEV_SERVER_URL;
  if (devServerUrl) {
    await window.loadURL(devServerUrl);
    window.webContents.openDevTools({ mode: "detach" });
    return;
  }

  await window.loadFile(join(appDir, "..", "dist", "index.html"));
}

app.whenReady().then(async () => {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
  }
  registerHandlers();
  await createWindow();
  startEnvHistoryCleanupSchedule();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

let envHistoryCleanupTimer: NodeJS.Timeout | undefined;

function startEnvHistoryCleanupSchedule() {
  if (envHistoryCleanupTimer) return;
  void runEnvHistoryRetentionCleanup().catch(() => undefined);
  envHistoryCleanupTimer = setInterval(() => {
    void runEnvHistoryRetentionCleanup().catch(() => undefined);
  }, 60 * 60 * 1_000);
  envHistoryCleanupTimer.unref();
}

let quitCleanupStarted = false;
let quitCleanupFinished = false;
app.on("before-quit", (event) => {
  if (quitCleanupFinished) return;
  event.preventDefault();
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;
  void getRouterLifecycleSettings()
    .then(async (settings) => {
      if (settings.stopOnAppQuit) await stopUsageRouter();
    })
    .catch(() => undefined)
    .finally(() => {
      quitCleanupFinished = true;
      app.quit();
    });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function registerHandlers() {
  async function readTerminalIcon(iconPath?: string) {
    if (!iconPath) return undefined;
    if (process.platform === "darwin" && iconPath.endsWith(".app")) {
      const plist = await readFile(join(iconPath, "Contents", "Info.plist"), "utf8").catch(() => "");
      const iconName = plist.match(/<key>CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/)?.[1]?.trim();
      const icnsPath = iconName ? join(iconPath, "Contents", "Resources", iconName.endsWith(".icns") ? iconName : `${iconName}.icns`) : "";
      if (icnsPath && existsSync(icnsPath)) {
        const pngPath = join(tmpdir(), `codex-switcher-${basename(iconPath, ".app").replace(/[^a-z0-9-]/gi, "-").toLowerCase()}-icon.png`);
        await execFileAsync("/usr/bin/sips", ["-s", "format", "png", icnsPath, "--out", pngPath]);
        const png = await readFile(pngPath).catch(() => undefined);
        if (png?.length) return `data:image/png;base64,${png.toString("base64")}`;
      }
    }
    return app.getFileIcon(iconPath, { size: "small" }).then((icon) => icon.toDataURL()).catch(() => undefined);
  }
  async function withTerminalIcons(settings: Awaited<ReturnType<typeof getCliTerminalSettings>>) {
    return {
      selectedId: settings.selectedId,
      terminals: await Promise.all(settings.terminals.map(async ({ iconPath, ...terminal }) => ({
        ...terminal,
        iconUrl: await readTerminalIcon(iconPath),
      }))),
    };
  }
  ipcMain.handle("desktop:loadOverview", () => loadOverview());
  ipcMain.handle("desktop:loadAuthMetrics", () => loadAuthMetrics());
  ipcMain.handle("desktop:getCodexToolPaths", () => getCodexToolPaths());
  ipcMain.handle("desktop:getCliAutoResumeSettings", () => getCliAutoResumeSettings());
  ipcMain.handle("desktop:getEnvHistoryRetentionSettings", () => getEnvHistoryRetentionSettings());
  ipcMain.handle("desktop:getGeneratedImageRecoverySettings", () => getGeneratedImageRecoverySettings());
  ipcMain.handle("desktop:getRouterLifecycleSettings", () => getRouterLifecycleSettings());
  ipcMain.handle("desktop:getRouterPortSettings", () => getRouterPortSettings());
  ipcMain.handle("desktop:detectCodexToolPaths", () => detectCodexToolPaths());
  ipcMain.handle("desktop:setCodexToolPath", (_event, kind, path) => setCodexToolPath(kind, path));
  ipcMain.handle("desktop:clearCodexToolPath", (_event, kind) => clearCodexToolPath(kind));
  ipcMain.handle("desktop:setCliAutoResumeSettings", (_event, value) => setCliAutoResumeSettings(value));
  ipcMain.handle("desktop:setEnvHistoryRetentionSettings", (_event, value) => setEnvHistoryRetentionSettings(value));
  ipcMain.handle("desktop:setGeneratedImageRecoverySettings", (_event, value) => setGeneratedImageRecoverySettings(value));
  ipcMain.handle("desktop:setRouterLifecycleSettings", (_event, value) => setRouterLifecycleSettings(value));
  ipcMain.handle("desktop:setRouterPortSettings", (_event, value) => setRouterPortSettings(value));
  ipcMain.handle("desktop:getCliTerminalSettings", async () => withTerminalIcons(await getCliTerminalSettings()));
  ipcMain.handle("desktop:scanCliTerminalSettings", async () => withTerminalIcons(await scanCliTerminalSettings()));
  ipcMain.handle("desktop:setCliTerminalSelection", async (_event, id) => withTerminalIcons(await setCliTerminalSelection(id)));
  ipcMain.handle("desktop:getLanguage", () => getLanguage());
  ipcMain.handle("desktop:setLanguage", (_event: IpcMainInvokeEvent, language: string) => setLanguage(language));
  ipcMain.handle("desktop:writeClipboardText", (_event: IpcMainInvokeEvent, value: string) => {
    clipboard.writeText(value);
  });
  ipcMain.handle("desktop:nativeLogin", (_event: IpcMainInvokeEvent, request) => nativeLogin(request));
  ipcMain.handle("desktop:switchEnv", (_event: IpcMainInvokeEvent, target: "cli" | "app", envName: string) =>
    switchEnv(target, envName)
  );
  ipcMain.handle(
    "desktop:switchAccount",
    (
      _event: IpcMainInvokeEvent,
      target: "cli" | "app",
      envName: string,
      accountName: string,
      strategy?: "replace-current" | "current-window" | "new-window" | "multi-window",
      workingDirectory?: string,
    ) => switchAccount(target, envName, accountName, strategy, workingDirectory)
  );
  ipcMain.handle("desktop:listAccountProjects", (_event, envName: string, accountName: string) =>
    listAccountProjects(envName, accountName)
  );
  ipcMain.handle("desktop:pickDirectory", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? "" : result.filePaths[0] ?? "";
  });
  ipcMain.handle("desktop:createEnv", (_event: IpcMainInvokeEvent, request) => createEnv(request));
  ipcMain.handle("desktop:deleteEnv", (_event: IpcMainInvokeEvent, envName: string) => deleteEnv(envName));
  ipcMain.handle(
    "desktop:updateEnv",
    (_event: IpcMainInvokeEvent, envName: string, nextEnvName: string, homePath: string) =>
      updateEnv(envName, nextEnvName, homePath)
  );
  ipcMain.handle("desktop:readEnvConfig", (_event: IpcMainInvokeEvent, envName: string) =>
    readEnvConfig(envName)
  );
  ipcMain.handle("desktop:readEnvFiles", (_event: IpcMainInvokeEvent, envName: string) =>
    readEnvFiles(envName)
  );
  ipcMain.handle("desktop:updateEnvConfig", (_event: IpcMainInvokeEvent, envName: string, content: string) =>
    updateEnvConfig(envName, content)
  );
  ipcMain.handle("desktop:updateEnvFiles", (_event: IpcMainInvokeEvent, envName: string, files) =>
    updateEnvFiles(envName, files)
  );
  ipcMain.handle("desktop:listEnvFileHistory", (_event: IpcMainInvokeEvent, envName: string) =>
    listEnvFileHistory(envName)
  );
  ipcMain.handle("desktop:restoreEnvFileHistory", (_event: IpcMainInvokeEvent, envName: string, entryId: string) =>
    restoreEnvFileHistory(envName, entryId)
  );
  ipcMain.handle("desktop:deleteEnvFileHistory", (_event: IpcMainInvokeEvent, envName: string, entryIds: string[]) =>
    deleteEnvFileHistory(envName, entryIds)
  );
  ipcMain.handle(
    "desktop:updateRuntime",
    (_event: IpcMainInvokeEvent, envName: string, accountName: string, baseUrl: string) =>
      updateRuntime(envName, accountName, baseUrl)
  );
  ipcMain.handle("desktop:updateIndependentModel", (_event: IpcMainInvokeEvent, request) =>
    updateIndependentModel(request)
  );
  ipcMain.handle("desktop:listCustomModels", () => listCustomModels());
  ipcMain.handle("desktop:saveCustomModel", (_event: IpcMainInvokeEvent, request) =>
    saveCustomModel(request)
  );
  ipcMain.handle("desktop:deleteCustomModel", (_event: IpcMainInvokeEvent, id: string) =>
    deleteCustomModel(id)
  );
  ipcMain.handle(
    "desktop:setAccountModelBindings",
    (_event: IpcMainInvokeEvent, accountKey: string, modelIds: string[]) =>
      setAccountModelBindings(accountKey, modelIds),
  );
  ipcMain.handle(
    "desktop:setModelAccountBindings",
    (_event: IpcMainInvokeEvent, modelId: string, accountKeys: string[]) =>
      setModelAccountBindings(modelId, accountKeys),
  );
  ipcMain.handle("desktop:logoutAccount", (_event: IpcMainInvokeEvent, envName: string, accountName: string, target: "cli" | "app" | "both") =>
    logoutAccount(envName, accountName, target)
  );
  ipcMain.handle("desktop:deleteAccount", (_event: IpcMainInvokeEvent, envName: string, accountName: string) =>
    deleteAccount(envName, accountName)
  );
  ipcMain.handle(
    "desktop:copyAccount",
    (_event: IpcMainInvokeEvent, sourceEnvName: string, sourceAccountName: string, targetEnvName: string) =>
      copyAccount(sourceEnvName, sourceAccountName, targetEnvName),
  );
  ipcMain.handle("desktop:showProxy", () => showProxy());
  ipcMain.handle("desktop:setProxy", (_event: IpcMainInvokeEvent, value: string) => setProxy(value));
  ipcMain.handle("desktop:disableProxy", () => disableProxy());
  ipcMain.handle("desktop:testProxy", () => testProxy());
  ipcMain.handle("desktop:startTokenRefresh", () => startTokenRefresh());
  ipcMain.handle("desktop:stopTokenRefresh", () => stopTokenRefresh());
  ipcMain.handle("desktop:readTokenRefreshStatus", () => readTokenRefreshStatus());
  ipcMain.handle("desktop:runTokenRefreshOnce", () => runTokenRefreshOnce());
  ipcMain.handle("desktop:listOperations", () => listOperations());
  ipcMain.handle(
    "desktop:importDefaultEnv",
    (_event: IpcMainInvokeEvent, envName: string, options?: { withAuth?: boolean; force?: boolean }) =>
      importDefaultEnv(envName, options)
  );
  ipcMain.handle("desktop:launchCliInTerminal", () => launchCliInTerminal());
  ipcMain.handle("desktop:readAppStatus", () => readAppStatus());
  ipcMain.handle("desktop:logoutApp", (_event: IpcMainInvokeEvent, accountName?: string) => logoutApp(accountName));
  ipcMain.handle("desktop:stopManagedApp", () => stopManagedApp());
  ipcMain.handle("desktop:runDoctor", () => runDoctor());
  ipcMain.handle("desktop:runRecover", () => runRecover());
  ipcMain.handle("desktop:readSwitcherLog", () => readSwitcherLog());
  ipcMain.handle("desktop:readTokenRefreshLog", () => readTokenRefreshLog());
  ipcMain.handle("desktop:getEnvironmentRouteStatuses", () => getEnvironmentRouteStatuses());
  ipcMain.handle("desktop:toggleEnvironmentRoute", (_event: IpcMainInvokeEvent, envName: string, enabled: boolean) =>
    toggleEnvironmentRoute(envName, enabled));
  ipcMain.handle("desktop:listAccountPools", () => listAccountPools());
  ipcMain.handle("desktop:saveAccountPool", (_event: IpcMainInvokeEvent, input) => saveAccountPool(input));
  ipcMain.handle("desktop:toggleAccountCompatibility", (_event: IpcMainInvokeEvent, input) =>
    input.enabled ? enableAccountCompatibility(input) : disableAccountCompatibility(input.envName, input.accountName));
  ipcMain.handle("desktop:getAccountCompatibilityStatuses", (_event: IpcMainInvokeEvent, accountKeys: string[]) =>
    getAccountCompatibilityStatuses(accountKeys));
  ipcMain.handle("desktop:checkAccountCompatibility", (_event: IpcMainInvokeEvent, envName: string, accountName: string) =>
    checkAccountCompatibility(envName, accountName));
  ipcMain.handle("desktop:loadUsageSnapshot", (_event: IpcMainInvokeEvent, filter) => loadUsageSnapshot(filter));
  ipcMain.handle("desktop:loadUsageRequests", (_event: IpcMainInvokeEvent, query) => loadUsageRequests(query));
  ipcMain.handle("desktop:listUsagePricing", () => listUsagePricing());
  ipcMain.handle("desktop:saveUsagePricing", (_event: IpcMainInvokeEvent, profile) => saveUsagePricing(profile));
  ipcMain.handle("desktop:getSkillSnapshot", (_event: IpcMainInvokeEvent, refreshMarketplace?: boolean) =>
    getSkillSnapshot(Boolean(refreshMarketplace)));
  ipcMain.handle("desktop:installSkill", (_event: IpcMainInvokeEvent, input) => installSkill(input));
  ipcMain.handle("desktop:checkSkillUpdates", (_event: IpcMainInvokeEvent, envName: string) => checkSkillUpdates(envName));
  ipcMain.handle("desktop:updateSkill", (_event: IpcMainInvokeEvent, input) => updateSkill(input));
  ipcMain.handle("desktop:uninstallSkill", (_event: IpcMainInvokeEvent, envName: string, skillId: string) =>
    uninstallSkill(envName, skillId));
  ipcMain.handle("desktop:setSkillProviderBinding", (_event: IpcMainInvokeEvent, input) => setSkillProviderBinding(input));
  ipcMain.handle("desktop:repairSkillProvider", (_event: IpcMainInvokeEvent, providerId) => repairSkillProvider(providerId));
}
