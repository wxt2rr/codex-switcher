import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("codexDesktop", {
  loadOverview: () => ipcRenderer.invoke("desktop:loadOverview"),
  loadAuthMetrics: () => ipcRenderer.invoke("desktop:loadAuthMetrics"),
  getLanguage: () => ipcRenderer.invoke("desktop:getLanguage"),
  setLanguage: (language: "zh" | "en" | "ja") => ipcRenderer.invoke("desktop:setLanguage", language),
  nativeLogin: (request: {
    mode: "auth" | "apikey" | "sub2api";
    account: string;
    envName: string;
    target: "cli" | "app" | "both";
    relogin: boolean;
    sync?: boolean;
    apiKey?: string;
    baseUrlMode?: "default" | "custom";
    baseUrl?: string;
    sub2apiPayload?: string;
  }) => ipcRenderer.invoke("desktop:nativeLogin", request),
  switchEnv: (target: "cli" | "app", envName: string) =>
    ipcRenderer.invoke("desktop:switchEnv", target, envName),
  switchAccount: (
    target: "cli" | "app",
    envName: string,
    accountName: string,
    strategy?: "replace-current" | "current-window" | "new-window",
  ) => ipcRenderer.invoke("desktop:switchAccount", target, envName, accountName, strategy),
  createEnv: (request: {
    envName: string;
    source: {
      kind: "empty" | "default" | "env";
      envName?: string;
    };
  }) => ipcRenderer.invoke("desktop:createEnv", request),
  deleteEnv: (envName: string) => ipcRenderer.invoke("desktop:deleteEnv", envName),
  updateEnv: (envName: string, nextEnvName: string, homePath: string) =>
    ipcRenderer.invoke("desktop:updateEnv", envName, nextEnvName, homePath),
  readEnvConfig: (envName: string) => ipcRenderer.invoke("desktop:readEnvConfig", envName),
  readEnvFiles: (envName: string) => ipcRenderer.invoke("desktop:readEnvFiles", envName),
  updateEnvConfig: (envName: string, content: string) =>
    ipcRenderer.invoke("desktop:updateEnvConfig", envName, content),
  updateEnvFiles: (envName: string, files: { configToml: string; authJson: string }) =>
    ipcRenderer.invoke("desktop:updateEnvFiles", envName, files),
  listEnvFileHistory: (envName: string) => ipcRenderer.invoke("desktop:listEnvFileHistory", envName),
  restoreEnvFileHistory: (envName: string, entryId: string) =>
    ipcRenderer.invoke("desktop:restoreEnvFileHistory", envName, entryId),
  deleteEnvFileHistory: (envName: string, entryIds: string[]) =>
    ipcRenderer.invoke("desktop:deleteEnvFileHistory", envName, entryIds),
  updateRuntime: (envName: string, accountName: string, baseUrl: string) =>
    ipcRenderer.invoke("desktop:updateRuntime", envName, accountName, baseUrl),
  updateIndependentModel: (request: {
    envName: string;
    accountName: string;
    enabled: boolean;
    providerId?: string;
    apiKey?: string;
    baseUrl?: string;
  }) => ipcRenderer.invoke("desktop:updateIndependentModel", request),
  logoutAccount: (envName: string, accountName: string, target: "cli" | "app" | "both") =>
    ipcRenderer.invoke("desktop:logoutAccount", envName, accountName, target),
  deleteAccount: (envName: string, accountName: string) =>
    ipcRenderer.invoke("desktop:deleteAccount", envName, accountName),
  showProxy: () => ipcRenderer.invoke("desktop:showProxy"),
  setProxy: (value: string) => ipcRenderer.invoke("desktop:setProxy", value),
  disableProxy: () => ipcRenderer.invoke("desktop:disableProxy"),
  testProxy: () => ipcRenderer.invoke("desktop:testProxy"),
  startTokenRefresh: () => ipcRenderer.invoke("desktop:startTokenRefresh"),
  stopTokenRefresh: () => ipcRenderer.invoke("desktop:stopTokenRefresh"),
  readTokenRefreshStatus: () => ipcRenderer.invoke("desktop:readTokenRefreshStatus"),
  runTokenRefreshOnce: () => ipcRenderer.invoke("desktop:runTokenRefreshOnce"),
  listOperations: () => ipcRenderer.invoke("desktop:listOperations"),
  importDefaultEnv: (envName: string, options?: { withAuth?: boolean; force?: boolean }) =>
    ipcRenderer.invoke("desktop:importDefaultEnv", envName, options),
  launchCliInTerminal: () => ipcRenderer.invoke("desktop:launchCliInTerminal"),
  readAppStatus: () => ipcRenderer.invoke("desktop:readAppStatus"),
  logoutApp: (accountName?: string) => ipcRenderer.invoke("desktop:logoutApp", accountName),
  stopManagedApp: () => ipcRenderer.invoke("desktop:stopManagedApp"),
  runDoctor: () => ipcRenderer.invoke("desktop:runDoctor"),
  runRecover: () => ipcRenderer.invoke("desktop:runRecover"),
  readSwitcherLog: () => ipcRenderer.invoke("desktop:readSwitcherLog"),
  readTokenRefreshLog: () => ipcRenderer.invoke("desktop:readTokenRefreshLog"),
  getEnvironmentRouteStatuses: () => ipcRenderer.invoke("desktop:getEnvironmentRouteStatuses"),
  toggleEnvironmentRoute: (envName: string, enabled: boolean) =>
    ipcRenderer.invoke("desktop:toggleEnvironmentRoute", envName, enabled),
  loadUsageSnapshot: (filter: unknown) => ipcRenderer.invoke("desktop:loadUsageSnapshot", filter),
  listUsagePricing: () => ipcRenderer.invoke("desktop:listUsagePricing"),
  saveUsagePricing: (profile: unknown) => ipcRenderer.invoke("desktop:saveUsagePricing", profile),
});
