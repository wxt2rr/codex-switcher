export interface DesktopActionResult {
  message: string;
  output?: string;
}
export interface CodexToolStatus { kind: "cli" | "app"; path: string; detectedPath: string; manualPath: string; source: "manual" | "environment" | "path" | "candidate" | "missing"; available: boolean; }
export interface CliAutoResumeSettings { enabled: boolean; sessionNumber: number; }
export interface RouterLifecycleSettings { stopOnAppQuit: boolean; }
export interface RouterPortSettings { preferredPort: number; }
export interface EnvHistoryRetentionSettings { enabled: boolean; retentionDays: number; }
export interface GeneratedImageRecoveryStatus {
  enabled: boolean; installedEnvironments: number; totalEnvironments: number; conflicts: string[];
}
export interface AppEnvironmentBadgeStatus {
  enabled: boolean; supported: boolean; platform: "macos" | "windows" | "unsupported";
  permission: "granted" | "denied" | "not-required" | "unsupported";
  applied: number; unresolved: number; message?: string;
}
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
}

export type DesktopLaunchStrategy = "replace-current" | "current-window" | "new-window" | "multi-window";
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
export interface AccountPoolMemberInput { accountName: string; enabled?: boolean; weight?: number; priority?: number; }
export interface AccountPoolInput {
  envName: string; enabled: boolean; protocol: "responses" | "chat_completions";
  members: AccountPoolMemberInput[]; sessionTtlMinutes?: number; maxFailoverAttempts?: number; maxSameAccountFailures?: number;
}
export interface AccountPoolMemberStatus {
  accountName: string; state: "healthy" | "degraded" | "cooldown" | "exhausted" | "unauthorized" | "disabled";
  consecutiveFailures: number; cooldownUntil: number | null; lastSuccessAt: number | null;
  lastFailureAt: number | null; lastFailureReason: string | null; lastFailureStatus: number | null;
}
export interface AccountPoolStatus {
  poolId: string; envName: string; protocol: "responses" | "chat_completions"; enabled: boolean;
  sessionTtlMinutes: number; maxFailoverAttempts: number; maxSameAccountFailures: number;
  members: Array<{ accountName: string; enabled: boolean; weight: number; priority: number }>;
  health: AccountPoolMemberStatus[]; readyMembers: number; localBaseUrl?: string;
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

export type SkillProviderId = string;
export interface MarketplaceSkill {
  id: string; slug: string; name: string; source: string; installs?: number;
  installUrl: string; url: string; description?: string;
}
export interface MarketplaceSnapshot {
  items: MarketplaceSkill[]; status: "live" | "cached" | "link-only" | "error";
  fetchedAt?: string; message?: string; externalUrl: string;
}
export interface InstalledSkill {
  id: string; name: string; description: string; path: string; scopeId: string;
  managed: boolean; linked: boolean; linkedFrom?: string; sourceUrl?: string;
  sourcePath?: string; requestedRef?: string; revision?: string; installedAt?: string;
  state: "healthy" | "modified" | "missing" | "conflict";
}
export interface SkillScope {
  id: string; kind: "marketplace" | "codex" | "provider"; name: string; path?: string;
  envName?: string; providerId?: SkillProviderId; sourceEnv?: string; skills: InstalledSkill[];
}
export interface ProviderBinding {
  providerId: SkillProviderId; name: string; custom: boolean; enabled: boolean; sourceEnv?: string; targetPath: string;
  status: "disabled" | "healthy" | "conflict" | "missing-source" | "error";
  managedLinks: number; conflicts: number; message?: string;
}
export interface SkillManagerSnapshot { marketplace: MarketplaceSnapshot; scopes: SkillScope[]; bindings: ProviderBinding[]; }
export interface InstallSkillRequest {
  envName: string; sourceUrl: string; skillName?: string; sourcePath?: string; ref?: string; force?: boolean;
}
export interface UpdateSkillRequest { envName: string; skillId: string; force?: boolean; }
export interface SetProviderBindingRequest {
  providerId: SkillProviderId; enabled: boolean; sourceEnv?: string; targetPath?: string;
}
export interface CreateSkillProviderRequest { name: string; targetPath: string; }

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
  getGeneratedImageRecoverySettings(): Promise<GeneratedImageRecoveryStatus>;
  getAppEnvironmentBadgeStatus(): Promise<AppEnvironmentBadgeStatus>;
  getRouterLifecycleSettings(): Promise<RouterLifecycleSettings>;
  getRouterPortSettings(): Promise<RouterPortSettings>;
  detectCodexToolPaths(): Promise<CodexToolStatus[]>;
  setCodexToolPath(kind: "cli" | "app", path: string): Promise<CodexToolStatus>;
  clearCodexToolPath(kind: "cli" | "app"): Promise<CodexToolStatus>;
  setCliAutoResumeSettings(value: CliAutoResumeSettings): Promise<CliAutoResumeSettings>;
  setEnvHistoryRetentionSettings(value: EnvHistoryRetentionSettings): Promise<EnvHistoryRetentionSettings>;
  setGeneratedImageRecoverySettings(value: { enabled: boolean }): Promise<GeneratedImageRecoveryStatus>;
  requestAppEnvironmentBadgePermission(): Promise<AppEnvironmentBadgeStatus>;
  setAppEnvironmentBadgeSettings(value: { enabled: boolean }): Promise<AppEnvironmentBadgeStatus>;
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
  listAccountPools(): Promise<AccountPoolStatus[]>;
  saveAccountPool(input: AccountPoolInput): Promise<AccountPoolStatus | null>;
  toggleAccountCompatibility(input: AccountCompatibilityRequest): Promise<AccountCompatibilityStatus>;
  getAccountCompatibilityStatuses(accountKeys: string[]): Promise<AccountCompatibilityStatus[]>;
  checkAccountCompatibility(envName: string, accountName: string): Promise<CompatibilityCheckResult>;
  loadUsageSnapshot(filter: UsageFilter): Promise<UsageSnapshot>;
  loadUsageRequests(query: UsageRequestQuery): Promise<UsageRequestPage>;
  listUsagePricing(): Promise<UsagePricingProfile[]>;
  saveUsagePricing(profile: UsagePricingProfile): Promise<void>;
  getSkillSnapshot(refreshMarketplace?: boolean): Promise<SkillManagerSnapshot>;
  installSkill(input: InstallSkillRequest): Promise<InstalledSkill>;
  checkSkillUpdates(envName: string): Promise<Record<string, boolean>>;
  updateSkill(input: UpdateSkillRequest): Promise<InstalledSkill>;
  uninstallSkill(envName: string, skillId: string): Promise<void>;
  setSkillProviderBinding(input: SetProviderBindingRequest): Promise<ProviderBinding>;
  createSkillProvider(input: CreateSkillProviderRequest): Promise<ProviderBinding>;
  deleteSkillProvider(providerId: SkillProviderId): Promise<void>;
  repairSkillProvider(providerId: SkillProviderId): Promise<ProviderBinding>;
}

export interface DesktopBridge {
  loadOverview(): Promise<string>;
  loadAuthMetrics(): Promise<string>;
  getCodexToolPaths(): Promise<CodexToolStatus[]>;
  getCliAutoResumeSettings(): Promise<CliAutoResumeSettings>;
  getEnvHistoryRetentionSettings(): Promise<EnvHistoryRetentionSettings>;
  getGeneratedImageRecoverySettings(): Promise<GeneratedImageRecoveryStatus>;
  getAppEnvironmentBadgeStatus(): Promise<AppEnvironmentBadgeStatus>;
  getRouterLifecycleSettings(): Promise<RouterLifecycleSettings>;
  getRouterPortSettings(): Promise<RouterPortSettings>;
  detectCodexToolPaths(): Promise<CodexToolStatus[]>;
  setCodexToolPath(kind: "cli" | "app", path: string): Promise<CodexToolStatus>;
  clearCodexToolPath(kind: "cli" | "app"): Promise<CodexToolStatus>;
  setCliAutoResumeSettings(value: CliAutoResumeSettings): Promise<CliAutoResumeSettings>;
  setEnvHistoryRetentionSettings(value: EnvHistoryRetentionSettings): Promise<EnvHistoryRetentionSettings>;
  setGeneratedImageRecoverySettings(value: { enabled: boolean }): Promise<GeneratedImageRecoveryStatus>;
  requestAppEnvironmentBadgePermission(): Promise<AppEnvironmentBadgeStatus>;
  setAppEnvironmentBadgeSettings(value: { enabled: boolean }): Promise<AppEnvironmentBadgeStatus>;
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
  listAccountPools(): Promise<AccountPoolStatus[]>;
  saveAccountPool(input: AccountPoolInput): Promise<AccountPoolStatus | null>;
  toggleAccountCompatibility(input: AccountCompatibilityRequest): Promise<AccountCompatibilityStatus>;
  getAccountCompatibilityStatuses(accountKeys: string[]): Promise<AccountCompatibilityStatus[]>;
  checkAccountCompatibility(envName: string, accountName: string): Promise<CompatibilityCheckResult>;
  loadUsageSnapshot(filter: UsageFilter): Promise<UsageSnapshot>;
  loadUsageRequests(query: UsageRequestQuery): Promise<UsageRequestPage>;
  listUsagePricing(): Promise<UsagePricingProfile[]>;
  saveUsagePricing(profile: UsagePricingProfile): Promise<void>;
  getSkillSnapshot(refreshMarketplace?: boolean): Promise<SkillManagerSnapshot>;
  installSkill(input: InstallSkillRequest): Promise<InstalledSkill>;
  checkSkillUpdates(envName: string): Promise<Record<string, boolean>>;
  updateSkill(input: UpdateSkillRequest): Promise<InstalledSkill>;
  uninstallSkill(envName: string, skillId: string): Promise<void>;
  setSkillProviderBinding(input: SetProviderBindingRequest): Promise<ProviderBinding>;
  createSkillProvider(input: CreateSkillProviderRequest): Promise<ProviderBinding>;
  deleteSkillProvider(providerId: SkillProviderId): Promise<void>;
  repairSkillProvider(providerId: SkillProviderId): Promise<ProviderBinding>;
}

export function createDesktopBridge(api: DesktopElectronApi | undefined): DesktopBridge {
  if (!api) {
    return {
      loadOverview: unavailable,
      loadAuthMetrics: unavailable,
      getCodexToolPaths: unavailable,
      getCliAutoResumeSettings: unavailable,
      getEnvHistoryRetentionSettings: unavailable,
      getGeneratedImageRecoverySettings: unavailable,
      getAppEnvironmentBadgeStatus: unavailable,
      getRouterLifecycleSettings: unavailable,
      getRouterPortSettings: unavailable,
      detectCodexToolPaths: unavailable,
      setCodexToolPath: unavailable,
      clearCodexToolPath: unavailable,
      setCliAutoResumeSettings: unavailable,
      setEnvHistoryRetentionSettings: unavailable,
      setGeneratedImageRecoverySettings: unavailable,
      requestAppEnvironmentBadgePermission: unavailable,
      setAppEnvironmentBadgeSettings: unavailable,
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
      listAccountPools: unavailable,
      saveAccountPool: unavailable,
      toggleAccountCompatibility: unavailable,
      getAccountCompatibilityStatuses: unavailable,
      checkAccountCompatibility: unavailable,
      loadUsageSnapshot: unavailable,
      loadUsageRequests: unavailable,
      listUsagePricing: unavailable,
      saveUsagePricing: unavailable,
      getSkillSnapshot: unavailable,
      installSkill: unavailable,
      checkSkillUpdates: unavailable,
      updateSkill: unavailable,
      uninstallSkill: unavailable,
      setSkillProviderBinding: unavailable,
      createSkillProvider: unavailable,
      deleteSkillProvider: unavailable,
      repairSkillProvider: unavailable,
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
      requestHealth: Object.fromEntries(fallbackOverview.accounts
        .filter((account) => account.authMode === "apikey" || Boolean(account.runtime.independentModelApiKey))
        .map((account, accountIndex) => {
          const segments = Array.from({ length: 60 }, (_, index) => ({
            completedAt: Date.now() - (59 - index) * 30_000,
            success: (index + accountIndex) % 17 !== 0,
            cacheHit: (index + accountIndex) % 7 !== 0,
          }));
          return [`${account.envName}/${account.name}`, {
            envName: account.envName,
            accountName: account.name,
            sampleSize: segments.length,
            successRate: segments.filter((segment) => segment.success).length / segments.length,
            cacheHitRate: segments.filter((segment) => segment.cacheHit).length / segments.length,
            segments,
          }];
        })),
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
    getAppEnvironmentBadgeStatus: async () => ({ enabled: false, supported: true, platform: "macos", permission: "denied", applied: 0, unresolved: 0 }),
    getRouterPortSettings: async () => ({ preferredPort: 17832 }),
    detectCodexToolPaths: async () => [],
    setCodexToolPath: async (kind, path) => ({ kind, path, detectedPath: "", manualPath: path, source: "manual", available: true }),
    clearCodexToolPath: async (kind) => ({ kind, path: "", detectedPath: "", manualPath: "", source: "missing", available: false }),
    setCliAutoResumeSettings: async (value) => value,
    setEnvHistoryRetentionSettings: async (value) => value,
    setRouterLifecycleSettings: async (value) => value,
    setRouterPortSettings: async (value) => value,
    requestAppEnvironmentBadgePermission: async () => ({ enabled: false, supported: true, platform: "macos", permission: "granted", applied: 0, unresolved: 0 }),
    setAppEnvironmentBadgeSettings: async (value) => ({ enabled: value.enabled, supported: true, platform: "macos", permission: "granted", applied: value.enabled ? 2 : 0, unresolved: 0 }),
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
    listAccountPools: async () => [],
    saveAccountPool: async () => null,
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
      facets: { envNames: ["wangxt"], accountNames: ["demo"], models: ["gpt-5.4"], endpoints: ["/responses"], poolIds: [], failoverReasons: [] },
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
    getGeneratedImageRecoverySettings: async () => ({
      enabled: false, installedEnvironments: 0, totalEnvironments: 2, conflicts: [],
    }),
    setGeneratedImageRecoverySettings: async (value) => ({
      enabled: value.enabled, installedEnvironments: value.enabled ? 2 : 0, totalEnvironments: 2, conflicts: [],
    }),
    getSkillSnapshot: async (refreshMarketplace) => loadPreviewSkillSnapshot(Boolean(refreshMarketplace)),
    installSkill: async (input) => ({
      id: input.skillName ?? "preview-skill", name: input.skillName ?? "Preview Skill",
      description: "Preview installation", path: `/preview/${input.envName}/skills/${input.skillName ?? "preview-skill"}`,
      scopeId: `codex:${input.envName}`, managed: true, linked: false, state: "healthy",
    }),
    checkSkillUpdates: async () => ({ "apple-design": true }),
    updateSkill: async (input) => ({
      id: input.skillId, name: input.skillId, description: "Updated preview skill",
      path: `/preview/${input.envName}/skills/${input.skillId}`, scopeId: `codex:${input.envName}`,
      managed: true, linked: false, state: "healthy",
    }),
    uninstallSkill: async () => undefined,
    setSkillProviderBinding: async (input) => ({
      providerId: input.providerId, name: input.providerId, custom: input.providerId.startsWith("custom:"),
      enabled: input.enabled, sourceEnv: input.sourceEnv,
      targetPath: input.targetPath ?? `~/.${input.providerId}/skills`, status: input.enabled ? "healthy" : "disabled",
      managedLinks: input.enabled ? 3 : 0, conflicts: 0,
    }),
    createSkillProvider: async (input) => ({
      providerId: `custom:${crypto.randomUUID()}`, name: input.name, custom: true, enabled: false,
      targetPath: input.targetPath, status: "disabled", managedLinks: 0, conflicts: 0,
    }),
    deleteSkillProvider: async () => undefined,
    repairSkillProvider: async (providerId) => ({
      providerId, name: providerId, custom: providerId.startsWith("custom:"), enabled: true,
      sourceEnv: "personal", targetPath: `~/.${providerId}/skills`,
      status: "healthy", managedLinks: 3, conflicts: 0,
    }),
  };
}

const previewInstalledSkills: InstalledSkill[] = [
  { id: "animation-vocabulary", name: "Animation Vocabulary", description: "Reverse-lookup glossary for web animation and motion effects.",
    path: "/preview/personal/skills/animation-vocabulary", scopeId: "codex:personal", managed: true, linked: false,
    sourceUrl: "https://github.com/example/skills.git", revision: "a1b2c3d", state: "healthy" },
  { id: "apple-design", name: "Apple Design", description: "Apple's approach to interface design and fluid physical motion.",
    path: "/preview/personal/skills/apple-design", scopeId: "codex:personal", managed: true, linked: false,
    sourceUrl: "https://github.com/example/skills.git", revision: "b2c3d4e", state: "healthy" },
  { id: "completion-review", name: "Completion Review Skill", description: "Determine whether development work is genuinely complete.",
    path: "/preview/personal/skills/completion-review", scopeId: "codex:personal", managed: false, linked: false, state: "healthy" },
];

const previewSkillSnapshot: SkillManagerSnapshot = {
  marketplace: {
    status: "live", fetchedAt: new Date().toISOString(), externalUrl: "https://skills.sh",
    items: [
      { id: "vercel-labs/skills/find-skills", slug: "find-skills", name: "Find Skills", source: "vercel-labs/skills",
        installs: 24531, installUrl: "https://github.com/vercel-labs/skills", url: "https://skills.sh/vercel-labs/skills/find-skills",
        description: "Discover and install skills from the open ecosystem." },
      { id: "anthropics/skills/frontend-design", slug: "frontend-design", name: "Frontend Design", source: "anthropics/skills",
        installs: 18340, installUrl: "https://github.com/anthropics/skills", url: "https://skills.sh/anthropics/skills/frontend-design",
        description: "Build distinctive, production-grade frontend interfaces." },
      { id: "vercel-labs/agent-skills/web-design-guidelines", slug: "web-design-guidelines", name: "Web Design Guidelines",
        source: "vercel-labs/agent-skills", installs: 12680, installUrl: "https://github.com/vercel-labs/agent-skills",
        url: "https://skills.sh/vercel-labs/agent-skills/web-design-guidelines", description: "Review UI code against practical web interface guidelines." },
    ],
  },
  scopes: [
    { id: "marketplace", kind: "marketplace", name: "Marketplace", skills: [] },
    { id: "codex:personal", kind: "codex", name: "Codex · Personal", envName: "personal", path: "/preview/personal/skills", skills: previewInstalledSkills },
    { id: "codex:company", kind: "codex", name: "Codex · Company", envName: "company", path: "/preview/company/skills", skills: [] },
    { id: "provider:claude-code", kind: "provider", name: "Claude Code", providerId: "claude-code", path: "~/.claude/skills", skills: [] },
    { id: "provider:qoder", kind: "provider", name: "Qoder", providerId: "qoder", path: "~/.qoder/skills", skills: [] },
    { id: "provider:zcode", kind: "provider", name: "ZCode", providerId: "zcode", path: "~/.zcode/skills", skills: [] },
    { id: "provider:codebuddy", kind: "provider", name: "CodeBuddy / WorkBuddy", providerId: "codebuddy", path: "~/.codebuddy/skills", skills: [] },
    { id: "provider:cursor", kind: "provider", name: "Cursor", providerId: "cursor", path: "~/.cursor/skills", skills: [] },
  ],
  bindings: [
    { providerId: "claude-code", name: "Claude Code", custom: false, enabled: false, targetPath: "~/.claude/skills", status: "disabled", managedLinks: 0, conflicts: 0 },
    { providerId: "qoder", name: "Qoder", custom: false, enabled: false, targetPath: "~/.qoder/skills", status: "disabled", managedLinks: 0, conflicts: 0 },
    { providerId: "zcode", name: "ZCode", custom: false, enabled: false, targetPath: "~/.zcode/skills", status: "disabled", managedLinks: 0, conflicts: 0 },
    { providerId: "codebuddy", name: "CodeBuddy / WorkBuddy", custom: false, enabled: false, targetPath: "~/.codebuddy/skills", status: "disabled", managedLinks: 0, conflicts: 0 },
    { providerId: "cursor", name: "Cursor", custom: false, enabled: false, targetPath: "~/.cursor/skills", status: "disabled", managedLinks: 0, conflicts: 0 },
  ],
};

async function loadPreviewSkillSnapshot(refreshMarketplace: boolean): Promise<SkillManagerSnapshot> {
  try {
    const response = await fetch(`/desktop-preview/skills-snapshot?refresh=${refreshMarketplace}`);
    if (!response.ok) throw new Error(`Marketplace returned HTTP ${response.status}`);
    return await response.json() as SkillManagerSnapshot;
  } catch (error) {
    return { ...previewSkillSnapshot, marketplace: {
      ...previewSkillSnapshot.marketplace,
      status: "cached",
      message: error instanceof Error ? error.message : String(error),
    } };
  }
}

declare global {
  interface Window {
    codexDesktop?: DesktopElectronApi;
  }
}
