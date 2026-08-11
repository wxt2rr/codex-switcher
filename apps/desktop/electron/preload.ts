import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("codexDesktop", {
  loadOverview: () => ipcRenderer.invoke("desktop:loadOverview"),
  loadAuthMetrics: () => ipcRenderer.invoke("desktop:loadAuthMetrics"),
  getCodexToolPaths: () => ipcRenderer.invoke("desktop:getCodexToolPaths"),
  getCliAutoResumeSettings: () => ipcRenderer.invoke("desktop:getCliAutoResumeSettings"),
  getEnvHistoryRetentionSettings: () => ipcRenderer.invoke("desktop:getEnvHistoryRetentionSettings"),
  getGeneratedImageRecoverySettings: () => ipcRenderer.invoke("desktop:getGeneratedImageRecoverySettings"),
  getAppEnvironmentBadgeStatus: () => ipcRenderer.invoke("desktop:getAppEnvironmentBadgeStatus"),
  getRouterLifecycleSettings: () => ipcRenderer.invoke("desktop:getRouterLifecycleSettings"),
  getRouterPortSettings: () => ipcRenderer.invoke("desktop:getRouterPortSettings"),
  detectCodexToolPaths: () => ipcRenderer.invoke("desktop:detectCodexToolPaths"),
  setCodexToolPath: (kind: "cli" | "app", path: string) => ipcRenderer.invoke("desktop:setCodexToolPath", kind, path),
  clearCodexToolPath: (kind: "cli" | "app") => ipcRenderer.invoke("desktop:clearCodexToolPath", kind),
  setCliAutoResumeSettings: (value: { enabled: boolean; sessionNumber: number }) =>
    ipcRenderer.invoke("desktop:setCliAutoResumeSettings", value),
  setEnvHistoryRetentionSettings: (value: { enabled: boolean; retentionDays: number }) =>
    ipcRenderer.invoke("desktop:setEnvHistoryRetentionSettings", value),
  setGeneratedImageRecoverySettings: (value: { enabled: boolean }) =>
    ipcRenderer.invoke("desktop:setGeneratedImageRecoverySettings", value),
  requestAppEnvironmentBadgePermission: () => ipcRenderer.invoke("desktop:requestAppEnvironmentBadgePermission"),
  setAppEnvironmentBadgeSettings: (value: { enabled: boolean }) =>
    ipcRenderer.invoke("desktop:setAppEnvironmentBadgeSettings", value),
  setRouterLifecycleSettings: (value: { stopOnAppQuit: boolean }) =>
    ipcRenderer.invoke("desktop:setRouterLifecycleSettings", value),
  setRouterPortSettings: (value: { preferredPort: number }) =>
    ipcRenderer.invoke("desktop:setRouterPortSettings", value),
  getCliTerminalSettings: () => ipcRenderer.invoke("desktop:getCliTerminalSettings"),
  scanCliTerminalSettings: () => ipcRenderer.invoke("desktop:scanCliTerminalSettings"),
  setCliTerminalSelection: (id: string) => ipcRenderer.invoke("desktop:setCliTerminalSelection", id),
  getLanguage: () => ipcRenderer.invoke("desktop:getLanguage"),
  setLanguage: (language: "zh" | "en" | "ja") => ipcRenderer.invoke("desktop:setLanguage", language),
  writeClipboardText: (value: string) => ipcRenderer.invoke("desktop:writeClipboardText", value),
  nativeLogin: (request: {
    providerId?: "openai" | "deepseek" | "mimo";
    mode: "auth" | "apikey" | "sub2api" | "cpa";
    account: string;
    envName: string;
    target: "cli" | "app" | "both" | "none";
    relogin: boolean;
    sync?: boolean;
    apiKey?: string;
    baseUrlMode?: "default" | "custom";
    baseUrl?: string;
    credentialPayload?: string;
    sub2apiPayload?: string;
    apiProtocol?: "responses" | "chat_completions";
    compatibilityEnabled?: boolean;
    upstreamModel?: string;
    reasoningProfile?: "auto" | "standard" | "reasoning_content" | "think_tags";
    longConversationStrategy?: "safe" | "continuity";
    instructionRole?: "auto" | "system" | "developer";
    requestOverrides?: Record<string, unknown>;
  }) => ipcRenderer.invoke("desktop:nativeLogin", request),
  switchEnv: (target: "cli" | "app", envName: string) =>
    ipcRenderer.invoke("desktop:switchEnv", target, envName),
  switchAccount: (
    target: "cli" | "app",
    envName: string,
    accountName: string,
    strategy?: "replace-current" | "current-window" | "new-window" | "multi-window",
    workingDirectory?: string,
  ) => ipcRenderer.invoke("desktop:switchAccount", target, envName, accountName, strategy, workingDirectory),
  listAccountProjects: (envName: string, accountName: string) =>
    ipcRenderer.invoke("desktop:listAccountProjects", envName, accountName),
  pickDirectory: () => ipcRenderer.invoke("desktop:pickDirectory"),
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
  listCustomModels: () => ipcRenderer.invoke("desktop:listCustomModels"),
  saveCustomModel: (request: { id?: string; entry: Record<string, unknown> }) =>
    ipcRenderer.invoke("desktop:saveCustomModel", request),
  deleteCustomModel: (id: string) => ipcRenderer.invoke("desktop:deleteCustomModel", id),
  setAccountModelBindings: (accountKey: string, modelIds: string[]) =>
    ipcRenderer.invoke("desktop:setAccountModelBindings", accountKey, modelIds),
  setModelAccountBindings: (modelId: string, accountKeys: string[]) =>
    ipcRenderer.invoke("desktop:setModelAccountBindings", modelId, accountKeys),
  logoutAccount: (envName: string, accountName: string, target: "cli" | "app" | "both") =>
    ipcRenderer.invoke("desktop:logoutAccount", envName, accountName, target),
  deleteAccount: (envName: string, accountName: string) =>
    ipcRenderer.invoke("desktop:deleteAccount", envName, accountName),
  copyAccount: (sourceEnvName: string, sourceAccountName: string, targetEnvName: string) =>
    ipcRenderer.invoke("desktop:copyAccount", sourceEnvName, sourceAccountName, targetEnvName),
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
  listAccountPools: () => ipcRenderer.invoke("desktop:listAccountPools"),
  saveAccountPool: (input: unknown) => ipcRenderer.invoke("desktop:saveAccountPool", input),
  toggleAccountCompatibility: (input: {
    envName: string; accountName: string; enabled: boolean; upstreamModel?: string;
    reasoningProfile?: "auto" | "standard" | "reasoning_content" | "think_tags";
    longConversationStrategy?: "safe" | "continuity";
    instructionRole?: "auto" | "system" | "developer";
    requestOverrides?: Record<string, unknown>;
  }) => ipcRenderer.invoke("desktop:toggleAccountCompatibility", input),
  getAccountCompatibilityStatuses: (accountKeys: string[]) =>
    ipcRenderer.invoke("desktop:getAccountCompatibilityStatuses", accountKeys),
  checkAccountCompatibility: (envName: string, accountName: string) =>
    ipcRenderer.invoke("desktop:checkAccountCompatibility", envName, accountName),
  loadUsageSnapshot: (filter: unknown) => ipcRenderer.invoke("desktop:loadUsageSnapshot", filter),
  loadUsageRequests: (query: unknown) => ipcRenderer.invoke("desktop:loadUsageRequests", query),
  listUsagePricing: () => ipcRenderer.invoke("desktop:listUsagePricing"),
  saveUsagePricing: (profile: unknown) => ipcRenderer.invoke("desktop:saveUsagePricing", profile),
  getSkillSnapshot: (request?: unknown) => ipcRenderer.invoke("desktop:getSkillSnapshot", request),
  installSkill: (input: unknown) => ipcRenderer.invoke("desktop:installSkill", input),
  checkSkillUpdates: (envName: string) => ipcRenderer.invoke("desktop:checkSkillUpdates", envName),
  updateSkill: (input: unknown) => ipcRenderer.invoke("desktop:updateSkill", input),
  uninstallSkill: (envName: string, skillId: string) => ipcRenderer.invoke("desktop:uninstallSkill", envName, skillId),
  setSkillProviderBinding: (input: unknown) => ipcRenderer.invoke("desktop:setSkillProviderBinding", input),
  createSkillProvider: (input: unknown) => ipcRenderer.invoke("desktop:createSkillProvider", input),
  deleteSkillProvider: (providerId: string) => ipcRenderer.invoke("desktop:deleteSkillProvider", providerId),
  repairSkillProvider: (providerId: string) => ipcRenderer.invoke("desktop:repairSkillProvider", providerId),
});
