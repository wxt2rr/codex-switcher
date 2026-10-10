import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, net, shell, Tray, type IpcMainInvokeEvent } from "electron";
import { execFile, spawn } from "node:child_process";
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
  importProviderCredential,
  refreshProviderCredential,
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
  restoreProxyAutoDetect,
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
  getAppEnvironmentBadgeStatus,
  getRouterLifecycleSettings,
  getRouterPortSettings,
  getLaunchAtLoginSettings,
  getAppPresenceSettings,
  detectCodexToolPaths,
  setCodexToolPath,
  setCliAutoResumeSettings,
  setEnvHistoryRetentionSettings,
  setGeneratedImageRecoverySettings,
  requestAppEnvironmentBadgePermission,
  setAppEnvironmentBadgeSettings,
  synchronizeAppEnvironmentBadges,
  setRouterLifecycleSettings,
  setRouterPortSettings,
  setLaunchAtLoginSettings,
  setAppPresenceSettings,
  clearCodexToolPath,
  toggleEnvironmentRoute,
  toggleEnvironmentGateway,
  listAccountPools,
  saveAccountPool,
  loadUsageSnapshot,
  loadUsageRequests,
  loadUsageTrace,
  loadGatewayAdminSnapshot,
  loadGatewayAdminConfiguration,
  saveGatewayAdminConfiguration,
  discoverGatewayAdminModels,
  loadProviderPluginSnapshot,
  loadProviderPluginMarket,
  refreshProviderPluginMarket,
  installProviderPlugin,
  installProviderPluginFromMarket,
  deactivateProviderPluginById,
  rollbackProviderPluginById,
  removeProviderPluginById,
  getAutoUpdateStatus,
  checkForAutoUpdate,
  installDownloadedUpdate,
  registerAutoUpdateController,
  listUsagePricing,
  saveUsagePricing,
  getCliTerminalSettings,
  scanCliTerminalSettings,
  setCliTerminalSelection,
  listCustomModels,
  discoverAccountModels,
  refreshAllAccountModels,
  listProviderCatalog,
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
  createSkillProvider,
  deleteSkillProvider,
  repairSkillProvider,
  repairLegacyEnvironmentConfigs,
} from "./bridge.js";
import { closeProviderPluginRuntime } from "./provider-plugin-runtime.js";
import { createDesktopAutoUpdateController, restartAfterRollback, type AutoUpdaterLike } from "./auto-update.js";
import { createLinuxAppImageInstallScript, createUpdateHelperPath, createWindowsInstallScript, resolveUpdateInstallMode, type UpdateInstallResult } from "./update-installer.js";
import { buildDesktopTrayActions } from "./tray-menu.js";
import { createUpdateRollbackJournal, resolveUpdateJournalPath, validateUpdateManifest, type DesktopUpdateManifest } from "./update-security.js";
import { copyInstallForRollback, restoreInstallFromRollback } from "./update-rollback.js";
import type { AppPresenceStatus } from "./bridge.js";

const currentDir = __dirname;
const execFileAsync = promisify(execFile);
const appDir = dirname(currentDir);
process.env.CODEX_SWITCHER_DESKTOP_RESOURCES_PATH = process.resourcesPath;
let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;

function readConfiguredUpdateManifest(): DesktopUpdateManifest | undefined {
  const raw = process.env.CODEX_SWITCHER_UPDATE_MANIFEST_JSON?.trim();
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (validateUpdateManifest(value)) return value;
    console.warn("Ignoring malformed CODEX_SWITCHER_UPDATE_MANIFEST_JSON");
    return undefined;
  } catch {
    console.warn("Ignoring invalid CODEX_SWITCHER_UPDATE_MANIFEST_JSON");
    return undefined;
  }
}

function resolveUpdatePlatform(): string {
  if (process.platform === "darwin") return `darwin-${process.arch === "arm64" ? "arm64" : "x64"}`;
  if (process.platform === "win32") return `win32-${process.arch === "arm64" ? "arm64" : "x64"}`;
  if (process.platform === "linux") return `linux-${process.arch === "arm64" ? "arm64" : "x64"}`;
  return `${process.platform}-${process.arch}`;
}

function resolveUpdateRollbackTarget(): string {
  return process.platform === "linux" && process.env.APPIMAGE ? process.env.APPIMAGE : app.getAppPath();
}

function installDownloadedUpdatePackage(downloaded: import("./github-update.js").DownloadedUpdate): UpdateInstallResult {
  const mode = resolveUpdateInstallMode(downloaded.candidate.artifact.kind, process.platform);
  if (mode === "manual") {
    void shell.openPath(downloaded.path);
    const message = downloaded.candidate.artifact.kind === "mac-dmg"
      ? "已打开 DMG，请将新版本拖入 Applications 替换旧版本"
      : "更新包已下载，请打开安装包完成更新";
    return { mode, message };
  }
  if (mode === "unsupported") {
    if (downloaded.candidate.index.releaseUrl) void shell.openExternal(downloaded.candidate.index.releaseUrl);
    return { mode, message: "当前平台不支持自动安装，已打开发布页面" };
  }
  if (process.platform === "win32") {
    const scriptPath = createUpdateHelperPath("cmd");
    createWindowsInstallScript({
      artifactKind: downloaded.candidate.artifact.kind,
      downloadedPath: downloaded.path,
      currentPid: process.pid,
      executablePath: process.execPath,
      releaseUrl: downloaded.candidate.index.releaseUrl,
    }, scriptPath);
    spawn(process.env.ComSpec || "cmd.exe", ["/d", "/c", scriptPath], { detached: true, stdio: "ignore" }).unref();
    app.quit();
    return { mode, message: "更新即将安装，应用将自动重启" };
  }
  if (process.platform === "linux" && process.env.APPIMAGE) {
    const scriptPath = createUpdateHelperPath("sh");
    createLinuxAppImageInstallScript({
      artifactKind: downloaded.candidate.artifact.kind,
      downloadedPath: downloaded.path,
      currentPid: process.pid,
      executablePath: process.execPath,
      appImagePath: process.env.APPIMAGE,
      releaseUrl: downloaded.candidate.index.releaseUrl,
    }, scriptPath);
    spawn("/bin/sh", [scriptPath], { detached: true, stdio: "ignore" }).unref();
    app.quit();
    return { mode, message: "更新即将安装，应用将自动重启" };
  }
  if (downloaded.candidate.index.releaseUrl) void shell.openExternal(downloaded.candidate.index.releaseUrl);
  return { mode: "unsupported", message: "当前安装方式不支持自动安装，已打开发布页面" };
}

let desktopUpdateScheduleTimer: NodeJS.Timeout | undefined;

function startDesktopUpdateSchedule(controller: ReturnType<typeof createDesktopAutoUpdateController>): void {
  if (desktopUpdateScheduleTimer || !controller.getStatus().enabled) return;
  const check = () => {
    void controller.check().then((status) => {
      if (status.state === "error") console.warn(`Desktop update check failed: ${status.message ?? "unknown error"}`);
    }).catch((error) => {
      console.warn("Desktop update check failed", error);
    });
  };
  const initialCheckTimer = setTimeout(check, 5000);
  initialCheckTimer.unref?.();
  desktopUpdateScheduleTimer = setInterval(check, 6 * 60 * 60 * 1000);
  desktopUpdateScheduleTimer.unref?.();
}

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

function resolveDesktopTrayTemplatePath() {
  const candidatePaths = [
    join(appDir, "..", "dist", "tray-template.png"),
    join(app.getAppPath(), "dist", "tray-template.png"),
    join(process.cwd(), "apps", "desktop", "public", "tray-template.png"),
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
  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
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

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function applyLaunchAtLoginSettings(settings: { enabled: boolean; supported: boolean }): void {
  if (settings.supported) app.setLoginItemSettings({ openAtLogin: settings.enabled });
}

async function refreshTrayMenu() {
  if (!tray) return;
  const states = await loadGatewayAdminSnapshot().catch(() => []);
  const actions = buildDesktopTrayActions(states);
  tray.setContextMenu(Menu.buildFromTemplate(actions.map((action) => action.id === "separator"
    ? { type: "separator" as const }
    : {
      label: action.label,
      enabled: action.enabled,
      click: () => {
        if (action.id === "open") showMainWindow();
        if (action.id === "refresh") void refreshTrayMenu();
        if (action.id === "quit") app.quit();
      },
    })));
}

async function ensureTray() {
  if (tray) return;
  const iconPath = process.platform === "darwin"
    ? resolveDesktopTrayTemplatePath()
    : resolveDesktopLogoPath();
  const icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  if (process.platform === "darwin") icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Codex Switcher");
  tray.on("click", showMainWindow);
  await refreshTrayMenu();
}

function destroyTray() {
  if (!tray) return;
  tray.destroy();
  tray = undefined;
}

async function applyAppPresenceSettings(settings: AppPresenceStatus): Promise<void> {
  if (process.platform !== "darwin") {
    await ensureTray();
    return;
  }
  if (settings.dock) {
    await app.dock.show();
  } else {
    app.dock.hide();
  }
  if (settings.menuBar) {
    await ensureTray();
  } else {
    destroyTray();
  }
}

app.whenReady().then(async () => {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
  }
  registerHandlers();
  const updateFeedUrl = process.env.CODEX_SWITCHER_UPDATE_FEED_URL?.trim();
  const githubUpdateEnabled = app.isPackaged || process.env.CODEX_SWITCHER_ENABLE_GITHUB_UPDATES === "1";
  const githubUpdate = githubUpdateEnabled ? {
    owner: process.env.CODEX_SWITCHER_UPDATE_GITHUB_OWNER?.trim() || "wxt2rr",
    repo: process.env.CODEX_SWITCHER_UPDATE_GITHUB_REPO?.trim() || "codex-switcher",
    platform: resolveUpdatePlatform(),
    channel: (process.env.CODEX_SWITCHER_UPDATE_CHANNEL?.trim() as "stable" | "beta" | "nightly" | "all" | undefined) || "all",
    downloadDirectory: join(app.getPath("userData"), "updates", "downloads"),
    trustedPublicKeyPem: process.env.CODEX_SWITCHER_UPDATE_TRUSTED_PUBLIC_KEY,
    requireSignedIndex: process.env.CODEX_SWITCHER_UPDATE_REQUIRE_SIGNATURE === "1",
    fetchImpl: net.fetch.bind(net) as typeof fetch,
    installDownloadedUpdate: installDownloadedUpdatePackage,
  } : undefined;
  const updateBackupPath = process.env.CODEX_SWITCHER_UPDATE_BACKUP_PATH?.trim() || join(app.getPath("userData"), "updates", "app-backup");
  const updateSource: AutoUpdaterLike = updateFeedUrl
    ? (await import("electron")).autoUpdater
    : {
      setFeedURL: () => undefined,
      checkForUpdates: () => undefined,
      quitAndInstall: () => undefined,
      on: () => undefined,
    };
  const autoUpdateController = createDesktopAutoUpdateController(updateSource, {
    feedUrl: updateFeedUrl,
    github: githubUpdate,
    manifest: readConfiguredUpdateManifest(),
    trustedPublicKeyPem: process.env.CODEX_SWITCHER_UPDATE_TRUSTED_PUBLIC_KEY,
    requireSignedManifest: process.env.CODEX_SWITCHER_UPDATE_REQUIRE_SIGNATURE === "1",
    ...(updateFeedUrl || githubUpdate ? {
      rollbackJournal: createUpdateRollbackJournal(resolveUpdateJournalPath(app.getPath("userData"))),
      currentVersion: app.getVersion(),
      backupPath: updateBackupPath,
      prepareRollbackBackup: (backupPath: string) => copyInstallForRollback(resolveUpdateRollbackTarget(), backupPath),
      restoreRollbackBackup: (backupPath: string) => restoreInstallFromRollback(resolveUpdateRollbackTarget(), backupPath),
    } : {}),
  });
  applyLaunchAtLoginSettings(await getLaunchAtLoginSettings());
  const rollbackBoot = autoUpdateController.beginBoot();
  if (restartAfterRollback(rollbackBoot, app)) return;
  registerAutoUpdateController(autoUpdateController);
  await repairLegacyEnvironmentConfigs().catch((error) => {
    console.warn("Codex legacy config migration failed", error);
  });
  await createWindow();
  await applyAppPresenceSettings(await getAppPresenceSettings());
  autoUpdateController.markHealthy();
  startDesktopUpdateSchedule(autoUpdateController);
  startEnvHistoryCleanupSchedule();
  void synchronizeAppEnvironmentBadges().catch(() => undefined);

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
    void synchronizeAppEnvironmentBadges().catch(() => undefined);
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
      void closeProviderPluginRuntime().catch(() => undefined).finally(() => {
        quitCleanupFinished = true;
        app.quit();
      });
    });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !tray) {
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
  ipcMain.handle("desktop:getAppEnvironmentBadgeStatus", () => getAppEnvironmentBadgeStatus());
  ipcMain.handle("desktop:getRouterLifecycleSettings", () => getRouterLifecycleSettings());
  ipcMain.handle("desktop:getRouterPortSettings", () => getRouterPortSettings());
  ipcMain.handle("desktop:getLaunchAtLoginSettings", () => getLaunchAtLoginSettings());
  ipcMain.handle("desktop:getAppPresenceSettings", () => getAppPresenceSettings());
  ipcMain.handle("desktop:detectCodexToolPaths", () => detectCodexToolPaths());
  ipcMain.handle("desktop:setCodexToolPath", (_event, kind, path) => setCodexToolPath(kind, path));
  ipcMain.handle("desktop:clearCodexToolPath", (_event, kind) => clearCodexToolPath(kind));
  ipcMain.handle("desktop:setCliAutoResumeSettings", (_event, value) => setCliAutoResumeSettings(value));
  ipcMain.handle("desktop:setEnvHistoryRetentionSettings", (_event, value) => setEnvHistoryRetentionSettings(value));
  ipcMain.handle("desktop:setGeneratedImageRecoverySettings", (_event, value) => setGeneratedImageRecoverySettings(value));
  ipcMain.handle("desktop:requestAppEnvironmentBadgePermission", () => requestAppEnvironmentBadgePermission());
  ipcMain.handle("desktop:setAppEnvironmentBadgeSettings", (_event, value) => setAppEnvironmentBadgeSettings(value));
  ipcMain.handle("desktop:setRouterLifecycleSettings", (_event, value) => setRouterLifecycleSettings(value));
  ipcMain.handle("desktop:setRouterPortSettings", (_event, value) => setRouterPortSettings(value));
  ipcMain.handle("desktop:setLaunchAtLoginSettings", async (_event, value) => {
    const settings = await setLaunchAtLoginSettings(value);
    applyLaunchAtLoginSettings(settings);
    return settings;
  });
  ipcMain.handle("desktop:setAppPresenceSettings", async (_event, value) => {
    const settings = await setAppPresenceSettings(value);
    await applyAppPresenceSettings(settings);
    return settings;
  });
  ipcMain.handle("desktop:getCliTerminalSettings", async () => withTerminalIcons(await getCliTerminalSettings()));
  ipcMain.handle("desktop:scanCliTerminalSettings", async () => withTerminalIcons(await scanCliTerminalSettings()));
  ipcMain.handle("desktop:setCliTerminalSelection", async (_event, id) => withTerminalIcons(await setCliTerminalSelection(id)));
  ipcMain.handle("desktop:getLanguage", () => getLanguage());
  ipcMain.handle("desktop:setLanguage", (_event: IpcMainInvokeEvent, language: string) => setLanguage(language));
  ipcMain.handle("desktop:writeClipboardText", (_event: IpcMainInvokeEvent, value: string) => {
    clipboard.writeText(value);
  });
  ipcMain.handle("desktop:nativeLogin", (_event: IpcMainInvokeEvent, request) => nativeLogin(request));
  ipcMain.handle("desktop:importProviderCredential", (_event: IpcMainInvokeEvent, request) => importProviderCredential(request));
  ipcMain.handle("desktop:refreshProviderCredential", (_event: IpcMainInvokeEvent, envName: string, account: string) => refreshProviderCredential({ envName, account }));
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
  ipcMain.handle("desktop:discoverAccountModels", (_event: IpcMainInvokeEvent, envName: string, accountName: string) =>
    discoverAccountModels(envName, accountName));
  ipcMain.handle("desktop:refreshAllAccountModels", () => refreshAllAccountModels());
  ipcMain.handle("desktop:listProviderCatalog", () => listProviderCatalog());
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
    (_event: IpcMainInvokeEvent, modelId: string, accountKeys: string[], optionsByAccount) =>
      setModelAccountBindings(modelId, accountKeys, optionsByAccount),
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
  ipcMain.handle("desktop:restoreProxyAutoDetect", () => restoreProxyAutoDetect());
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
  ipcMain.handle("desktop:toggleEnvironmentGateway", (_event: IpcMainInvokeEvent, envName: string, enabled: boolean) =>
    toggleEnvironmentGateway(envName, enabled));
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
  ipcMain.handle("desktop:loadUsageTrace", (_event: IpcMainInvokeEvent, query) => loadUsageTrace(query));
  ipcMain.handle("desktop:loadGatewayAdminSnapshot", () => loadGatewayAdminSnapshot());
  ipcMain.handle("desktop:loadGatewayAdminConfiguration", (_event: IpcMainInvokeEvent, envName: string) => loadGatewayAdminConfiguration(envName));
  ipcMain.handle("desktop:saveGatewayAdminConfiguration", (_event: IpcMainInvokeEvent, request) => saveGatewayAdminConfiguration(request));
  ipcMain.handle("desktop:discoverGatewayAdminModels", (_event: IpcMainInvokeEvent, request) => discoverGatewayAdminModels(request));
  ipcMain.handle("desktop:loadProviderPluginSnapshot", () => loadProviderPluginSnapshot());
  ipcMain.handle("desktop:loadProviderPluginMarket", () => loadProviderPluginMarket());
  ipcMain.handle("desktop:refreshProviderPluginMarket", (_event: IpcMainInvokeEvent, url: string) => refreshProviderPluginMarket(url));
  ipcMain.handle("desktop:installProviderPlugin", (_event: IpcMainInvokeEvent, request) => installProviderPlugin(request));
  ipcMain.handle("desktop:installProviderPluginFromMarket", (_event: IpcMainInvokeEvent, input) => installProviderPluginFromMarket(input));
  ipcMain.handle("desktop:deactivateProviderPlugin", (_event: IpcMainInvokeEvent, id: string) => deactivateProviderPluginById(id));
  ipcMain.handle("desktop:rollbackProviderPlugin", (_event: IpcMainInvokeEvent, id: string) => rollbackProviderPluginById(id));
  ipcMain.handle("desktop:removeProviderPlugin", (_event: IpcMainInvokeEvent, id: string) => removeProviderPluginById(id));
  ipcMain.handle("desktop:getAutoUpdateStatus", () => getAutoUpdateStatus());
  ipcMain.handle("desktop:checkForAutoUpdate", () => checkForAutoUpdate());
  ipcMain.handle("desktop:installDownloadedUpdate", () => installDownloadedUpdate());
  ipcMain.handle("desktop:listUsagePricing", () => listUsagePricing());
  ipcMain.handle("desktop:saveUsagePricing", (_event: IpcMainInvokeEvent, profile) => saveUsagePricing(profile));
  ipcMain.handle("desktop:getSkillSnapshot", (_event: IpcMainInvokeEvent, request) =>
    getSkillSnapshot(request));
  ipcMain.handle("desktop:installSkill", (_event: IpcMainInvokeEvent, input) => installSkill(input));
  ipcMain.handle("desktop:checkSkillUpdates", (_event: IpcMainInvokeEvent, envName: string) => checkSkillUpdates(envName));
  ipcMain.handle("desktop:updateSkill", (_event: IpcMainInvokeEvent, input) => updateSkill(input));
  ipcMain.handle("desktop:uninstallSkill", (_event: IpcMainInvokeEvent, envName: string, skillId: string) =>
    uninstallSkill(envName, skillId));
  ipcMain.handle("desktop:setSkillProviderBinding", (_event: IpcMainInvokeEvent, input) => setSkillProviderBinding(input));
  ipcMain.handle("desktop:createSkillProvider", (_event: IpcMainInvokeEvent, input) => createSkillProvider(input));
  ipcMain.handle("desktop:deleteSkillProvider", (_event: IpcMainInvokeEvent, providerId) => deleteSkillProvider(providerId));
  ipcMain.handle("desktop:repairSkillProvider", (_event: IpcMainInvokeEvent, providerId) => repairSkillProvider(providerId));
}
