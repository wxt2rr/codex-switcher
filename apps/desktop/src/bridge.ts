export interface DesktopActionResult {
  message: string;
  output?: string;
}
export interface CodexToolStatus { kind: "cli" | "app"; path: string; detectedPath: string; manualPath: string; source: "manual" | "environment" | "path" | "candidate" | "missing"; available: boolean; }
export interface CliAutoResumeSettings { enabled: boolean; sessionNumber: number; }
export interface RouterLifecycleSettings { stopOnAppQuit: boolean; }
export interface RouterPortSettings { preferredPort: number; }
export interface EnvHistoryRetentionSettings { enabled: boolean; retentionDays: number; }
export type CliTerminalId = "iterm" | "terminal" | "warp" | "ghostty" | "windows-terminal" | "powershell7" | "windows-powershell" | "command-prompt";
export interface CliTerminalOption { id: CliTerminalId; label: string; supportsCurrentWindow: boolean; iconUrl?: string; }
export interface CliTerminalSettings { selectedId: CliTerminalId; terminals: CliTerminalOption[]; }

export interface DesktopLogResult {
  kind: "switcher" | "token-refresh";
  content: string;
}

export interface DesktopEnvEditableFiles {
  configToml: string;
  authJson: string;
}

export interface DesktopEnvFileHistoryEntry {
  id: string;
  envName: string;
  fileType: "config.toml" | "auth.json";
  source: "manual" | "switch-cli" | "switch-app" | "restore";
  createdAt: string;
  content: string;
}

export interface DesktopCreateEnvRequest {
  envName: string;
  source: {
    kind: "empty" | "default" | "env";
    envName?: string;
  };
}

export interface DesktopNativeLoginRequest {
  mode: "auth" | "apikey" | "sub2api";
  account: string;
  envName: string;
  target: "cli" | "app" | "both" | "none";
  relogin: boolean;
  sync?: boolean;
  apiKey?: string;
  baseUrlMode?: "default" | "custom";
  baseUrl?: string;
  sub2apiPayload?: string;
  apiProtocol?: "responses" | "chat_completions";
  compatibilityEnabled?: boolean;
  upstreamModel?: string;
  reasoningProfile?: "auto" | "standard" | "reasoning_content" | "think_tags";
  longConversationStrategy?: "safe" | "continuity";
  instructionRole?: "auto" | "system" | "developer";
  requestOverrides?: Record<string, unknown>;
}

export type DesktopLaunchStrategy = "replace-current" | "current-window" | "new-window";
export interface CodexProject { path: string; name: string; lastUsedAt?: string; }

export interface DesktopIndependentModelRequest {
  envName: string;
  accountName: string;
  enabled: boolean;
  providerId?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface AccountCompatibilityRequest {
  envName: string;
  accountName: string;
  enabled: boolean;
  upstreamModel?: string;
  reasoningProfile?: "auto" | "standard" | "reasoning_content" | "think_tags";
  longConversationStrategy?: "safe" | "continuity";
  instructionRole?: "auto" | "system" | "developer";
  requestOverrides?: Record<string, unknown>;
}
export interface AccountCompatibilityStatus {
  envName: string;
  accountName: string;
  enabled: boolean;
  state: "disabled" | "ready" | "degraded";
  routeId?: string;
  localBaseUrl?: string;
  message?: string;
}
export interface CompatibilityCheckResult {
  ok: boolean; status: number; message: string; state?: "ready" | "degraded" | "failed"; checkedAt?: number;
  probes?: Array<{ stage: string; required: boolean; ok: boolean; message: string }>;
  capabilities?: { text: boolean; streaming: boolean; sequentialTools: boolean; parallelTools: boolean; reasoning: boolean };
}

export type ModelCatalogEntry = Record<string, unknown> & {
  slug: string;
  display_name: string;
  description?: string;
};
export interface CustomModelRecord {
  id: string;
  entry: ModelCatalogEntry;
  createdAt: string;
  updatedAt: string;
}
export interface ModelCatalogSnapshot {
  version: 1;
  models: CustomModelRecord[];
  accountBindings: Record<string, string[]>;
}
export interface SaveCustomModelRequest { id?: string; entry: Record<string, unknown>; }

import type {
  EnvironmentRouteStatus,
  UsageFilter,
  UsagePricingProfile,
  UsageRequestPage,
  UsageRequestQuery,
  UsageSnapshot,
} from "./desktop-model";

export interface DesktopElectronApi {
  loadOverview(): Promise<string>;
  loadAuthMetrics(): Promise<string>;
  getCodexToolPaths(): Promise<CodexToolStatus[]>;
  getCliAutoResumeSettings(): Promise<CliAutoResumeSettings>;
  getEnvHistoryRetentionSettings(): Promise<EnvHistoryRetentionSettings>;
  getRouterLifecycleSettings(): Promise<RouterLifecycleSettings>;
  getRouterPortSettings(): Promise<RouterPortSettings>;
  detectCodexToolPaths(): Promise<CodexToolStatus[]>;
  setCodexToolPath(kind: "cli" | "app", path: string): Promise<CodexToolStatus>;
  clearCodexToolPath(kind: "cli" | "app"): Promise<CodexToolStatus>;
  setCliAutoResumeSettings(value: CliAutoResumeSettings): Promise<CliAutoResumeSettings>;
  setEnvHistoryRetentionSettings(value: EnvHistoryRetentionSettings): Promise<EnvHistoryRetentionSettings>;
  setRouterLifecycleSettings(value: RouterLifecycleSettings): Promise<RouterLifecycleSettings>;
  setRouterPortSettings(value: RouterPortSettings): Promise<RouterPortSettings>;
  getCliTerminalSettings(): Promise<CliTerminalSettings>;
  scanCliTerminalSettings(): Promise<CliTerminalSettings>;
  setCliTerminalSelection(id: CliTerminalId): Promise<CliTerminalSettings>;
  getLanguage(): Promise<"zh" | "en" | "ja">;
  setLanguage(language: "zh" | "en" | "ja"): Promise<"zh" | "en" | "ja">;
  writeClipboardText(value: string): Promise<void>;
  nativeLogin(request: DesktopNativeLoginRequest): Promise<DesktopActionResult>;
  switchEnv(target: "cli" | "app", envName: string): Promise<DesktopActionResult>;
  switchAccount(
    target: "cli" | "app",
    envName: string,
    accountName: string,
    strategy?: DesktopLaunchStrategy,
    workingDirectory?: string,
  ): Promise<DesktopActionResult>;
  listAccountProjects(envName: string, accountName: string): Promise<CodexProject[]>;
  pickDirectory(): Promise<string>;
  createEnv(request: DesktopCreateEnvRequest): Promise<DesktopActionResult>;
  deleteEnv(envName: string): Promise<DesktopActionResult>;
  updateEnv(envName: string, nextEnvName: string, homePath: string): Promise<DesktopActionResult>;
  readEnvConfig(envName: string): Promise<string>;
  readEnvFiles(envName: string): Promise<string>;
  updateEnvConfig(envName: string, content: string): Promise<DesktopActionResult>;
  updateEnvFiles(envName: string, files: DesktopEnvEditableFiles): Promise<DesktopActionResult>;
  listEnvFileHistory(envName: string): Promise<string>;
  restoreEnvFileHistory(envName: string, entryId: string): Promise<DesktopActionResult>;
  deleteEnvFileHistory(envName: string, entryIds: string[]): Promise<DesktopActionResult>;
  updateRuntime(envName: string, accountName: string, baseUrl: string): Promise<DesktopActionResult>;
  updateIndependentModel(request: DesktopIndependentModelRequest): Promise<DesktopActionResult>;
  listCustomModels(): Promise<ModelCatalogSnapshot>;
  saveCustomModel(request: SaveCustomModelRequest): Promise<ModelCatalogSnapshot>;
  deleteCustomModel(id: string): Promise<ModelCatalogSnapshot>;
  setAccountModelBindings(accountKey: string, modelIds: string[]): Promise<ModelCatalogSnapshot>;
  setModelAccountBindings(modelId: string, accountKeys: string[]): Promise<ModelCatalogSnapshot>;
  logoutAccount(envName: string, accountName: string, target: "cli" | "app" | "both"): Promise<DesktopActionResult>;
  deleteAccount(envName: string, accountName: string): Promise<DesktopActionResult>;
  copyAccount(sourceEnvName: string, sourceAccountName: string, targetEnvName: string): Promise<DesktopActionResult>;
  showProxy(): Promise<DesktopActionResult>;
  setProxy(value: string): Promise<DesktopActionResult>;
  disableProxy(): Promise<DesktopActionResult>;
  testProxy(): Promise<DesktopActionResult>;
  startTokenRefresh(): Promise<DesktopActionResult>;
  stopTokenRefresh(): Promise<DesktopActionResult>;
  readTokenRefreshStatus(): Promise<DesktopActionResult>;
  runTokenRefreshOnce(): Promise<DesktopActionResult>;
  listOperations(): Promise<DesktopActionResult>;
  importDefaultEnv(envName: string, options?: { withAuth?: boolean; force?: boolean }): Promise<DesktopActionResult>;
  launchCliInTerminal(): Promise<DesktopActionResult>;
  readAppStatus(): Promise<DesktopActionResult>;
  logoutApp(accountName?: string): Promise<DesktopActionResult>;
  stopManagedApp(): Promise<DesktopActionResult>;
  runDoctor(): Promise<DesktopActionResult>;
  runRecover(): Promise<DesktopActionResult>;
  readSwitcherLog(): Promise<DesktopLogResult>;
  readTokenRefreshLog(): Promise<DesktopLogResult>;
  getEnvironmentRouteStatuses(): Promise<EnvironmentRouteStatus[]>;
  toggleEnvironmentRoute(envName: string, enabled: boolean): Promise<EnvironmentRouteStatus>;
  toggleAccountCompatibility(input: AccountCompatibilityRequest): Promise<AccountCompatibilityStatus>;
  getAccountCompatibilityStatuses(accountKeys: string[]): Promise<AccountCompatibilityStatus[]>;
  checkAccountCompatibility(envName: string, accountName: string): Promise<CompatibilityCheckResult>;
  loadUsageSnapshot(filter: UsageFilter): Promise<UsageSnapshot>;
  loadUsageRequests(query: UsageRequestQuery): Promise<UsageRequestPage>;
  listUsagePricing(): Promise<UsagePricingProfile[]>;
  saveUsagePricing(profile: UsagePricingProfile): Promise<void>;
}

export interface DesktopBridge {
  loadOverview(): Promise<string>;
  loadAuthMetrics(): Promise<string>;
  getCodexToolPaths(): Promise<CodexToolStatus[]>;
  getCliAutoResumeSettings(): Promise<CliAutoResumeSettings>;
  getEnvHistoryRetentionSettings(): Promise<EnvHistoryRetentionSettings>;
  getRouterLifecycleSettings(): Promise<RouterLifecycleSettings>;
  getRouterPortSettings(): Promise<RouterPortSettings>;
  detectCodexToolPaths(): Promise<CodexToolStatus[]>;
  setCodexToolPath(kind: "cli" | "app", path: string): Promise<CodexToolStatus>;
  clearCodexToolPath(kind: "cli" | "app"): Promise<CodexToolStatus>;
  setCliAutoResumeSettings(value: CliAutoResumeSettings): Promise<CliAutoResumeSettings>;
  setEnvHistoryRetentionSettings(value: EnvHistoryRetentionSettings): Promise<EnvHistoryRetentionSettings>;
  setRouterLifecycleSettings(value: RouterLifecycleSettings): Promise<RouterLifecycleSettings>;
  setRouterPortSettings(value: RouterPortSettings): Promise<RouterPortSettings>;
  getCliTerminalSettings(): Promise<CliTerminalSettings>;
  scanCliTerminalSettings(): Promise<CliTerminalSettings>;
  setCliTerminalSelection(id: CliTerminalId): Promise<CliTerminalSettings>;
  getLanguage(): Promise<"zh" | "en" | "ja">;
  setLanguage(language: "zh" | "en" | "ja"): Promise<"zh" | "en" | "ja">;
  writeClipboardText(value: string): Promise<void>;
  nativeLogin(request: DesktopNativeLoginRequest): Promise<DesktopActionResult>;
  switchEnv(target: "cli" | "app", envName: string): Promise<DesktopActionResult>;
  switchAccount(
    target: "cli" | "app",
    envName: string,
    accountName: string,
    strategy?: DesktopLaunchStrategy,
    workingDirectory?: string,
  ): Promise<DesktopActionResult>;
  listAccountProjects(envName: string, accountName: string): Promise<CodexProject[]>;
  pickDirectory(): Promise<string>;
  createEnv(request: DesktopCreateEnvRequest): Promise<DesktopActionResult>;
  deleteEnv(envName: string): Promise<DesktopActionResult>;
  updateEnv(envName: string, nextEnvName: string, homePath: string): Promise<DesktopActionResult>;
  readEnvConfig(envName: string): Promise<string>;
  readEnvFiles(envName: string): Promise<string>;
  updateEnvConfig(envName: string, content: string): Promise<DesktopActionResult>;
  updateEnvFiles(envName: string, files: DesktopEnvEditableFiles): Promise<DesktopActionResult>;
  listEnvFileHistory(envName: string): Promise<string>;
  restoreEnvFileHistory(envName: string, entryId: string): Promise<DesktopActionResult>;
  deleteEnvFileHistory(envName: string, entryIds: string[]): Promise<DesktopActionResult>;
  updateRuntime(envName: string, accountName: string, baseUrl: string): Promise<DesktopActionResult>;
  updateIndependentModel(request: DesktopIndependentModelRequest): Promise<DesktopActionResult>;
  listCustomModels(): Promise<ModelCatalogSnapshot>;
  saveCustomModel(request: SaveCustomModelRequest): Promise<ModelCatalogSnapshot>;
  deleteCustomModel(id: string): Promise<ModelCatalogSnapshot>;
  setAccountModelBindings(accountKey: string, modelIds: string[]): Promise<ModelCatalogSnapshot>;
  setModelAccountBindings(modelId: string, accountKeys: string[]): Promise<ModelCatalogSnapshot>;
  logoutAccount(envName: string, accountName: string, target: "cli" | "app" | "both"): Promise<DesktopActionResult>;
  deleteAccount(envName: string, accountName: string): Promise<DesktopActionResult>;
  copyAccount(sourceEnvName: string, sourceAccountName: string, targetEnvName: string): Promise<DesktopActionResult>;
  showProxy(): Promise<DesktopActionResult>;
  setProxy(value: string): Promise<DesktopActionResult>;
  disableProxy(): Promise<DesktopActionResult>;
  testProxy(): Promise<DesktopActionResult>;
  startTokenRefresh(): Promise<DesktopActionResult>;
  stopTokenRefresh(): Promise<DesktopActionResult>;
  readTokenRefreshStatus(): Promise<DesktopActionResult>;
  runTokenRefreshOnce(): Promise<DesktopActionResult>;
  listOperations(): Promise<DesktopActionResult>;
  importDefaultEnv(envName: string, options?: { withAuth?: boolean; force?: boolean }): Promise<DesktopActionResult>;
  launchCliInTerminal(): Promise<DesktopActionResult>;
  readAppStatus(): Promise<DesktopActionResult>;
  logoutApp(accountName?: string): Promise<DesktopActionResult>;
  stopManagedApp(): Promise<DesktopActionResult>;
  runDoctor(): Promise<DesktopActionResult>;
  runRecover(): Promise<DesktopActionResult>;
  readSwitcherLog(): Promise<DesktopLogResult>;
  readTokenRefreshLog(): Promise<DesktopLogResult>;
  getEnvironmentRouteStatuses(): Promise<EnvironmentRouteStatus[]>;
  toggleEnvironmentRoute(envName: string, enabled: boolean): Promise<EnvironmentRouteStatus>;
  toggleAccountCompatibility(input: AccountCompatibilityRequest): Promise<AccountCompatibilityStatus>;
  getAccountCompatibilityStatuses(accountKeys: string[]): Promise<AccountCompatibilityStatus[]>;
  checkAccountCompatibility(envName: string, accountName: string): Promise<CompatibilityCheckResult>;
  loadUsageSnapshot(filter: UsageFilter): Promise<UsageSnapshot>;
  loadUsageRequests(query: UsageRequestQuery): Promise<UsageRequestPage>;
  listUsagePricing(): Promise<UsagePricingProfile[]>;
  saveUsagePricing(profile: UsagePricingProfile): Promise<void>;
}

export function createDesktopBridge(api: DesktopElectronApi | undefined): DesktopBridge {
  if (!api) {
    return {
      loadOverview: unavailable,
      loadAuthMetrics: unavailable,
      getCodexToolPaths: unavailable,
      getCliAutoResumeSettings: unavailable,
      getEnvHistoryRetentionSettings: unavailable,
      getRouterLifecycleSettings: unavailable,
      getRouterPortSettings: unavailable,
      detectCodexToolPaths: unavailable,
      setCodexToolPath: unavailable,
      clearCodexToolPath: unavailable,
      setCliAutoResumeSettings: unavailable,
      setEnvHistoryRetentionSettings: unavailable,
      setRouterLifecycleSettings: unavailable,
      setRouterPortSettings: unavailable,
      getCliTerminalSettings: unavailable,
      scanCliTerminalSettings: unavailable,
      setCliTerminalSelection: unavailable,
      getLanguage: unavailable,
      setLanguage: unavailable,
      writeClipboardText: unavailable,
      nativeLogin: unavailable,
      switchEnv: unavailable,
      switchAccount: unavailable,
      listAccountProjects: unavailable,
      pickDirectory: unavailable,
      createEnv: unavailable,
      deleteEnv: unavailable,
      updateEnv: unavailable,
      readEnvConfig: unavailable,
      readEnvFiles: unavailable,
      updateEnvConfig: unavailable,
      updateEnvFiles: unavailable,
      listEnvFileHistory: unavailable,
      restoreEnvFileHistory: unavailable,
      deleteEnvFileHistory: unavailable,
      updateRuntime: unavailable,
      updateIndependentModel: unavailable,
      listCustomModels: unavailable,
      saveCustomModel: unavailable,
      deleteCustomModel: unavailable,
      setAccountModelBindings: unavailable,
      setModelAccountBindings: unavailable,
      logoutAccount: unavailable,
      deleteAccount: unavailable,
      copyAccount: unavailable,
      showProxy: unavailable,
      setProxy: unavailable,
      disableProxy: unavailable,
      testProxy: unavailable,
      startTokenRefresh: unavailable,
      stopTokenRefresh: unavailable,
      readTokenRefreshStatus: unavailable,
      runTokenRefreshOnce: unavailable,
      listOperations: unavailable,
      importDefaultEnv: unavailable,
      launchCliInTerminal: unavailable,
      readAppStatus: unavailable,
      logoutApp: unavailable,
      stopManagedApp: unavailable,
      runDoctor: unavailable,
      runRecover: unavailable,
      readSwitcherLog: unavailable,
      readTokenRefreshLog: unavailable,
      getEnvironmentRouteStatuses: unavailable,
      toggleEnvironmentRoute: unavailable,
      toggleAccountCompatibility: unavailable,
      getAccountCompatibilityStatuses: unavailable,
      checkAccountCompatibility: unavailable,
      loadUsageSnapshot: unavailable,
      loadUsageRequests: unavailable,
      listUsagePricing: unavailable,
      saveUsagePricing: unavailable,
    };
  }

  return api;
}

export function resolveDesktopBridge(): DesktopBridge {
  if (window.codexDesktop) {
    return createDesktopBridge(window.codexDesktop);
  }
  if (shouldUseBrowserPreviewBridge()) {
    return createBrowserPreviewBridge();
  }
  return createDesktopBridge(undefined);
}

async function unavailable(): Promise<never> {
  throw new Error("desktop bridge unavailable");
}

function shouldUseBrowserPreviewBridge() {
  return typeof window !== "undefined" && /^(http|https):$/.test(window.location.protocol);
}

async function browserPreviewLoadOverview() {
  const { fallbackOverview } = await import("./desktop-model");
  return `${JSON.stringify(fallbackOverview, null, 2)}\n`;
}

async function browserPreviewLoadAuthMetrics() {
  const { fallbackOverview } = await import("./desktop-model");
  const accounts = Object.fromEntries(
    fallbackOverview.accounts
      .filter((account) => account.authProfile)
      .map((account) => [`${account.envName}/${account.name}`, account.authProfile]),
  );

  return `${JSON.stringify(
    {
      accounts,
      status: {
        cli: {
          email: fallbackOverview.status.cli.email ?? "wangxt@example.com",
          usage5h: fallbackOverview.status.cli.usage5h ?? "45% (07-07 18:20)",
          usageWeekly: fallbackOverview.status.cli.usageWeekly ?? "72% (07-07 09:15)",
        },
        app: {
          email: fallbackOverview.status.app.email ?? "default@example.com",
          usage5h: fallbackOverview.status.app.usage5h ?? "15% (07-07 18:20)",
          usageWeekly: fallbackOverview.status.app.usageWeekly ?? "35% (07-07 09:15)",
        },
      },
    },
    null,
    2,
  )}\n`;
}

async function browserPreviewLanguage() {
  return "zh" as const;
}

async function browserPreviewSetLanguage(language: "zh" | "en" | "ja") {
  return language;
}

async function browserPreviewAction(message = "Preview mode only"): Promise<DesktopActionResult> {
  return { message };
}

async function browserPreviewReadEnvConfig() {
  return "{}\n";
}

async function browserPreviewReadEnvFiles() {
  return `${JSON.stringify({ configToml: "", authJson: "" }, null, 2)}\n`;
}

async function browserPreviewReadLog(kind: "switcher" | "token-refresh"): Promise<DesktopLogResult> {
  return {
    kind,
    content: "[preview] Browser preview bridge active.\n",
  };
}

function createBrowserPreviewBridge(): DesktopBridge {
  return {
    loadOverview: browserPreviewLoadOverview,
    loadAuthMetrics: browserPreviewLoadAuthMetrics,
    getCodexToolPaths: async () => [],
    getCliAutoResumeSettings: async () => ({ enabled: false, sessionNumber: 1 }),
    getEnvHistoryRetentionSettings: async () => ({ enabled: false, retentionDays: 30 }),
    getRouterLifecycleSettings: async () => ({ stopOnAppQuit: false }),
    getRouterPortSettings: async () => ({ preferredPort: 17832 }),
    detectCodexToolPaths: async () => [],
    setCodexToolPath: async (kind, path) => ({ kind, path, detectedPath: "", manualPath: path, source: "manual", available: true }),
    clearCodexToolPath: async (kind) => ({ kind, path: "", detectedPath: "", manualPath: "", source: "missing", available: false }),
    setCliAutoResumeSettings: async (value) => value,
    setEnvHistoryRetentionSettings: async (value) => value,
    setRouterLifecycleSettings: async (value) => value,
    setRouterPortSettings: async (value) => value,
    getCliTerminalSettings: async () => ({ selectedId: "terminal", terminals: [{ id: "terminal", label: "Terminal", supportsCurrentWindow: true }] }),
    scanCliTerminalSettings: async () => ({ selectedId: "terminal", terminals: [{ id: "terminal", label: "Terminal", supportsCurrentWindow: true }] }),
    setCliTerminalSelection: async (id) => ({ selectedId: id, terminals: [{ id, label: id, supportsCurrentWindow: false }] }),
    getLanguage: browserPreviewLanguage,
    setLanguage: browserPreviewSetLanguage,
    writeClipboardText: async () => undefined,
    nativeLogin: () => browserPreviewAction(),
    switchEnv: () => browserPreviewAction(),
    switchAccount: () => browserPreviewAction(),
    listAccountProjects: async () => [],
    pickDirectory: async () => "",
    createEnv: () => browserPreviewAction(),
    deleteEnv: () => browserPreviewAction(),
    updateEnv: () => browserPreviewAction(),
    readEnvConfig: browserPreviewReadEnvConfig,
    readEnvFiles: browserPreviewReadEnvFiles,
    updateEnvConfig: () => browserPreviewAction(),
    updateEnvFiles: () => browserPreviewAction(),
    listEnvFileHistory: async () => "[]\n",
    restoreEnvFileHistory: () => browserPreviewAction(),
    deleteEnvFileHistory: () => browserPreviewAction(),
    updateRuntime: () => browserPreviewAction(),
    updateIndependentModel: () => browserPreviewAction(),
    listCustomModels: async () => ({ version: 1, models: [], accountBindings: {} }),
    saveCustomModel: async () => ({ version: 1, models: [], accountBindings: {} }),
    deleteCustomModel: async () => ({ version: 1, models: [], accountBindings: {} }),
    setAccountModelBindings: async () => ({ version: 1, models: [], accountBindings: {} }),
    setModelAccountBindings: async () => ({ version: 1, models: [], accountBindings: {} }),
    logoutAccount: () => browserPreviewAction(),
    deleteAccount: () => browserPreviewAction(),
    copyAccount: () => browserPreviewAction(),
    showProxy: () => browserPreviewAction(),
    setProxy: () => browserPreviewAction(),
    disableProxy: () => browserPreviewAction(),
    testProxy: () => browserPreviewAction(),
    startTokenRefresh: () => browserPreviewAction(),
    stopTokenRefresh: () => browserPreviewAction(),
    readTokenRefreshStatus: () => browserPreviewAction("preview"),
    runTokenRefreshOnce: () => browserPreviewAction(),
    listOperations: () => browserPreviewAction("[]"),
    importDefaultEnv: () => browserPreviewAction(),
    launchCliInTerminal: () => browserPreviewAction(),
    readAppStatus: () => browserPreviewAction("preview"),
    logoutApp: () => browserPreviewAction(),
    stopManagedApp: () => browserPreviewAction(),
    runDoctor: () => browserPreviewAction(),
    runRecover: () => browserPreviewAction(),
    readSwitcherLog: () => browserPreviewReadLog("switcher"),
    readTokenRefreshLog: () => browserPreviewReadLog("token-refresh"),
    getEnvironmentRouteStatuses: async () => [
      { envName: "default", enabled: false, routedAccounts: 0, port: null },
      { envName: "wangxt", enabled: true, routedAccounts: 2, port: 17832 },
    ],
    toggleEnvironmentRoute: async (envName, enabled) => ({
      envName, enabled, routedAccounts: enabled ? 2 : 0, port: enabled ? 17832 : null,
    }),
    toggleAccountCompatibility: async (input) => ({ envName: input.envName, accountName: input.accountName,
      enabled: input.enabled, state: input.enabled ? "ready" : "disabled" }),
    getAccountCompatibilityStatuses: async (keys) => keys.map((key) => {
      const [envName, ...rest] = key.split("/"); return { envName, accountName: rest.join("/"), enabled: false, state: "disabled" as const };
    }),
    checkAccountCompatibility: async () => ({ ok: true, status: 200, message: "Compatibility check passed" }),
    loadUsageSnapshot: async () => ({
      generatedAt: Date.now(),
      summary: { requests: 267, inputTokens: 1_450_000, outputTokens: 60_490,
        cacheCreationTokens: 0, cacheReadTokens: 15_380_000, totalTokens: 16_890_490,
        actualCost: null, standardCost: 8.34, requestsWithoutUsage: 0, cacheHitRate: 0.914 },
      models: [
        { key: "gpt-5.4", model: "gpt-5.4", requests: 265, inputTokens: 1_440_000,
          outputTokens: 60_000, cacheCreationTokens: 0, cacheReadTokens: 15_360_000,
          totalTokens: 16_860_000, actualCost: null, standardCost: 8.32 },
        { key: "gpt-5.4-mini", model: "gpt-5.4-mini", requests: 2, inputTokens: 10_000,
          outputTokens: 490, cacheCreationTokens: 0, cacheReadTokens: 20_000,
          totalTokens: 30_490, actualCost: null, standardCost: 0.02 },
      ],
      baseUrls: [{ key: "https://api.example.com/v1", baseUrl: "https://api.example.com/v1",
        requests: 267, inputTokens: 1_450_000, outputTokens: 60_490, cacheCreationTokens: 0,
        cacheReadTokens: 15_380_000, totalTokens: 16_890_490, actualCost: null, standardCost: 8.34 }],
      trend: [
        { bucket: Date.now() - 3_600_000, requests: 120, inputTokens: 700_000, outputTokens: 25_000,
          cacheCreationTokens: 0, cacheReadTokens: 7_800_000, totalTokens: 8_525_000,
          actualCost: null, standardCost: 4.1, requestsWithoutUsage: 0, cacheHitRate: 0.91 },
        { bucket: Date.now(), requests: 147, inputTokens: 750_000, outputTokens: 35_490,
          cacheCreationTokens: 0, cacheReadTokens: 7_580_000, totalTokens: 8_365_490,
          actualCost: null, standardCost: 4.24, requestsWithoutUsage: 0, cacheHitRate: 0.918 },
      ],
    }),
    loadUsageRequests: async (query) => ({
      generatedAt: Date.now(), total: 2, page: query.page, pageSize: query.pageSize, totalPages: 1,
      facets: { envNames: ["wangxt"], accountNames: ["demo"], models: ["gpt-5.4"], endpoints: ["/responses"] },
      items: [
        { requestId: "req-preview-1", routeId: "route-preview", startedAt: Date.now() - 1250,
          completedAt: Date.now(), envName: "wangxt", accountName: "demo",
          upstreamBaseUrl: query.baseUrl ?? "https://api.example.com/v1", endpoint: "/responses",
          model: "gpt-5.4", inputTokens: 4429, outputTokens: 540, cacheCreationTokens: 0,
          cacheReadTokens: 77600, totalTokens: 82569, httpStatus: 200, latencyMs: 1250,
          actualCost: null, standardCost: 0.002314 },
        { requestId: "req-preview-2", routeId: "route-preview", startedAt: Date.now() - 3200,
          completedAt: Date.now() - 15_000, envName: "wangxt", accountName: "demo",
          upstreamBaseUrl: query.baseUrl ?? "https://api.example.com/v1", endpoint: "/responses",
          model: "gpt-5.4", inputTokens: 5378, outputTokens: 1075, cacheCreationTokens: 0,
          cacheReadTokens: 75500, totalTokens: 81953, httpStatus: 200, latencyMs: 3200,
          actualCost: null, standardCost: 0.002907 },
      ],
    }),
    listUsagePricing: async () => [],
    saveUsagePricing: async () => undefined,
  };
}

declare global {
  interface Window {
    codexDesktop?: DesktopElectronApi;
  }
}
