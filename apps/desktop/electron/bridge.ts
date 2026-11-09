import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { access, appendFile, chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { getUiLanguage, setUiLanguage, type UiLanguage } from "./ui-language.js";
import {
  loadCoreRuntime,
  loadCoreSupportModules,
  loadDesktopOperationsModule,
  loadGatewayAgentRuntime,
  loadGatewayProviderRuntime,
  type CoreRuntime,
} from "./core-runtime.js";
import {
  appendEnvFileHistoryEntry,
  deleteEnvFileHistoryEntries,
  listEnvFileHistoryEntries,
  readEnvFileSnapshot,
  type EnvFileHistoryEntry,
  type EnvFileHistorySource,
} from "./env-file-history.js";
import {
  appendClaudeCodeConfigHistoryEntry,
  deleteClaudeCodeConfigHistoryEntries,
  listClaudeCodeConfigHistoryEntries,
  toClaudeCodeConfigHistoryPreview,
} from "./claude-code-config-history.js";
import { syncCodexProviderHistory, type CodexHistorySyncResult } from "./codex-history-sync.js";
import {
  inspectCodexConversation,
  repairCodexConversation,
  type CodexConversationInspectionResult,
  type CodexConversationRepairResult,
} from "./codex-conversation-repair.js";
import { UsageRouterManager, type GatewayRouteBinding, type GatewayCapabilityObservationEntry } from "./usage-router-manager.js";
import type {
  GatewayEnvironmentState,
  GatewayRouteGroupDefinition,
  GatewayProtocol,
} from "../../../packages/core/dist/gateway/model.js";
import type {
  ClaudeCodeAuthorizationInspection,
  ClaudeCodeConnectionState,
  ClaudeCodeModelOption,
  EnvironmentModelIdentityMode,
  EnvironmentRemoteStatus,
  EnvironmentRoutePreview,
  EnvironmentRoutePreviewModel,
  EnvironmentRoutePreviewRoute,
} from "../src/desktop-model.js";
import {
  claudeCodeAccountSourceId,
  claudeCodeConfigPathChanged,
  claudeCodeEnvironmentSourceId,
  clearClaudeCodeConnection,
  inspectClaudeCodeAuthorizationContent,
  maskClaudeCodeSecret,
  readClaudeCodeConnection,
  resolveClaudeCodeCredentialsPath,
  resolveClaudeCodeConfigDir,
  resolveClaudeCodeSettingsPath,
  stripClaudeAiOauthCredentials,
  stripClaudeCodeAuthorizationSettings,
  writeClaudeCodeConnection,
  type ClaudeCodeConnectionRecord,
  type ClaudeCodeSourceSummary,
} from "./claude-code-connection.js";
import {
  gatewayCredentialSupportsProtocol,
  gatewayProviderSupportsProtocol,
} from "./gateway-protocol-support.js";
import {
  isLocalRouterBaseUrl,
  resolveRouteDisplayBaseUrl,
  selectCompatibilityUpstreamBaseUrl,
  type EnvironmentGateway,
  type RouteTarget,
  type PricingProfile,
  type RouteCapabilities,
  type RouteProtocol,
  type UsageFilter,
  type UsageRequestQuery,
  type UsageTraceQuery,
} from "./usage-routing-model.js";
import {
  buildEffectiveCodexEnv,
  buildCodexExecutionEnvironment,
  getCodexToolStatus,
  listCodexToolStatuses,
  normalizeWindowsPackagedAppTarget,
  resetCodexToolPath,
  saveCodexToolPath,
  type CodexToolKind,
} from "./codex-tool-paths.js";
import {
  prepareWindowsPackagedAppHome,
  stopWindowsPackagedAppProcesses,
} from "./windows-packaged-app-profile.js";
import {
  getConfiguredResourcesPath,
  resolveRuntimeResource,
  resolveRuntimeRoot,
} from "./runtime-paths.js";
import { findCodexResumeSession, readCodexProjects, type CodexProject } from "./codex-projects.js";
import {
  readCliAutoResumeSettings,
  readAppWindowSettings,
  readEnvHistoryRetentionSettings,
  readGeneratedImageRecoverySettings,
  readLaunchAtLoginSettings,
  readAppPresenceSettings,
  readAppEnvironmentBadgeSettings,
  readRouterLifecycleSettings,
  readRouterPortSettings,
  saveCliAutoResumeSettings,
  saveAppWindowCount,
  renameAppWindowCount,
  removeAppWindowCount,
  saveEnvHistoryRetentionSettings,
  saveGeneratedImageRecoverySettings,
  saveLaunchAtLoginSettings,
  saveAppPresenceSettings,
  saveAppEnvironmentBadgeSettings,
  saveRouterLifecycleSettings,
  saveRouterPortSettings,
  type CliAutoResumeSettings,
  type EnvHistoryRetentionSettings,
  type GeneratedImageRecoverySettings,
  type LaunchAtLoginSettings,
  type AppPresenceSettings,
  type AppEnvironmentBadgeSettings,
  type RouterLifecycleSettings,
  type RouterPortSettings,
  MAX_APP_WINDOW_COUNT,
} from "./desktop-settings.js";
import { runEnvHistoryCleanupIfDue } from "./env-history-retention.js";
import { AppWindowLaunchError, assertCanMultiOpen, buildAppWindowLaunchPlan, executeAppWindowLaunchPlan, launchAndPersistAdditionalAppWindow, resolveCurrentAppWindowCount, type AppWindowLaunchMode } from "./app-window-lifecycle.js";
import { getCliTerminalSettings as readCliTerminalSettings, saveCliTerminalSelection, type CliTerminalId, type CliTerminalSettings } from "./cli-terminal-settings.js";
import {
  createModelCatalogStore,
  accountModelBindingKey,
  filterModelCatalogBindings,
  normalizeCustomModelInput,
  projectAccountBindingsFromCatalog,
  resolveModelBinding,
  resolveModelCatalogProviderId,
  type AccountDiscoveredModel,
  type ModelBindingOptions,
  type ModelCatalogEntry,
  type ModelCatalogSnapshot,
  type SaveCustomModelInput,
} from "./model-catalog-store.js";
import {
  mergeBundledModelCatalogs,
  loadBundledModelCatalog,
  normalizeBundledModelEntry,
  resolveCodexAppBundledCliCandidates,
  synchronizeAccountModelCatalog,
  synchronizeEnvironmentGatewayModelCatalog,
  type BundledModelCatalog,
} from "./account-model-catalog.js";
import { applyModelCatalogBindings, inspectGatewayModelBindings } from "./gateway-model-bindings.js";
import {
  createAccountSecretRef,
  createGatewayAccountDiscoveryView,
  resolveRuntimeProviderId,
  synchronizeGatewayAccountMetadata,
} from "./gateway-account-sync.js";
import {
  DEEPSEEK_DEFAULT_MODEL_SLUG,
  DEEPSEEK_DEFAULT_MODEL_SLUGS,
  KIMI_DEFAULT_MODEL_SLUG,
  KIMI_DEFAULT_MODEL_SLUGS,
  MIMO_DEFAULT_MODEL_SLUG,
  MIMO_DEFAULT_MODEL_SLUGS,
  ZAI_DEFAULT_MODEL_SLUG,
  ZAI_DEFAULT_MODEL_SLUGS,
  getProviderDefaultApiProtocol,
  getProviderDefaultBaseUrl,
  getProviderDefaultModelEntries,
  getProviderDefaultModelSlug,
  isDeepSeekOfficialBaseUrl,
  isKimiOfficialBaseUrl,
  isMimoOfficialBaseUrl,
  isZaiOfficialBaseUrl,
  resolveProviderDefaultPreset,
  resolveProviderModelPreset,
} from "./provider-model-presets.js";
import {
  SkillManager,
  type CreateSkillProviderInput,
  type InstallSkillInput,
  type SetProviderBindingInput,
  type SkillProviderId,
  type SkillSnapshotOptions,
  type UpdateSkillInput,
} from "./skill-manager.js";

import {
  inspectGeneratedImageRecoverySkill,
  reconcileGeneratedImageRecoverySkill,
  type CodexSkillEnvironment,
} from "./generated-image-recovery-skill.js";

export interface ModelCatalogAppRefreshRequirement {
  required: boolean;
  envName?: string;
  runningWindows: number;
}

export interface ModelCatalogMutationResult {
  snapshot: ModelCatalogSnapshot;
  appRefresh: ModelCatalogAppRefreshRequirement;
}

import { AppEnvironmentBadgeManager, createUnsupportedBadgeAdapter, type AppEnvironmentBadgeStatus } from "./app-environment-badges.js";
import type { DesktopAutoUpdateStatus } from "./auto-update.js";
import type { GatewayAdminConfiguration, LaunchAtLoginStatus, SaveGatewayAdminConfigurationRequest } from "../src/bridge.js";
import { stripExcludedGatewayFields } from "./gateway-admin-configuration.js";
import { MacDockBadgeAdapter, WindowsTaskbarBadgeAdapter } from "./app-environment-badge-adapters.js";
import { discoverGatewayAccountModels, discoverGatewayProviderModels } from "./gateway-model-discovery.js";
import { fetchWithOptionalProxy } from "./upstream-proxy.js";
import { SubscriptionQuotaManager } from "./subscription-quota-manager.js";
import {
  buildAccountReferences,
  canonicalAccountKey,
  extractSubscriptionCredentials,
  isEligibleSubscriptionAccount,
  type CodexSubscriptionAccount,
} from "./codex-reset-card-utils.js";
import type {
  AutoUseMode,
  ResetCardNotificationStatus,
  ResetCardOperationEvent,
  ResetCardRefreshResult,
  ResetCardSettings,
  ResetCardSnapshot,
} from "../src/reset-card-model.js";
import { DesktopNotificationService, type DesktopNotificationConstructor, type DesktopNotificationWindow } from "./desktop-notification-service.js";
import { decideResetGatewayAdmission } from "./codex-reset-gateway-admission.js";
import type {
  ProviderAuthMethod,
  ProviderAccountRef,
  ProviderHttpClient,
} from "../../../packages/gateway/dist/provider/adapters.js";
import {
  activateProviderPlugin as activateProviderPluginRuntime,
  deactivateProviderPlugin as deactivateProviderPluginRuntime,
  installProviderPlugin as installProviderPluginRuntime,
  listProviderPlugins as listProviderPluginsRuntime,
  listProviderPluginMarket as listProviderPluginMarketRuntime,
  removeProviderPlugin as removeProviderPluginRuntime,
  refreshProviderPluginMarket as refreshProviderPluginMarketRuntime,
  rollbackProviderPlugin as rollbackProviderPluginRuntime,
  installProviderPluginFromMarket as installProviderPluginFromMarketRuntime,
  getProviderPluginSettings as getProviderPluginSettingsRuntime,
  setProviderPluginSettings as setProviderPluginSettingsRuntime,
  clearProviderPluginSettings as clearProviderPluginSettingsRuntime,
  listProviderPluginDiagnostics as listProviderPluginDiagnosticsRuntime,
  getProviderPluginAdapter,
  getProviderPluginDescriptor,
  type ProviderPluginInstallRequest,
  type ProviderPluginMarketInstallRequest,
  type ProviderPluginDiagnostic,
} from "./provider-plugin-runtime.js";
import {
  buildCodexChatGptAuthJson,
  buildImportedAccountNames,
  parseExternalCodexCredentials,
  type ExternalCodexCredentialSource,
} from "./external-codex-credential-import.js";

const execFileAsync = promisify(execFile);
const currentDir = resolveCurrentDir();

// Codex App Server reads the model catalog during process startup and keeps
// the resulting model list in memory. Serialize every managed-home/catalog
// mutation and App launch so an old catalog cannot win a race with a new
// window, and so a binding update can restart the active environment safely.
let appTargetLifecycleQueue: Promise<void> = Promise.resolve();
let bundledCatalogPromise: Promise<BundledModelCatalog | undefined> | undefined;

async function withAppTargetLifecycleLock<T>(action: () => Promise<T>): Promise<T> {
  const previous = appTargetLifecycleQueue;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  appTargetLifecycleQueue = previous.then(() => gate);
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

async function mutateModelCatalog<T>(
  mutation: () => Promise<T>,
  accountKey?: string,
): Promise<{ result: T; appRefresh: ModelCatalogAppRefreshRequirement }> {
  return withAppTargetLifecycleLock(async () => {
    const result = await mutation();
    const appRefresh = await resynchronizeActiveModelCatalogsUnlocked(accountKey, { updateAppHome: false });
    return { result, appRefresh };
  });
}

const AUTH_METRICS_TTL_MS = 60_000;

async function writeFileAtomically(
  path: string,
  content: string,
  options: { encoding: "utf8"; mode: number },
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, options);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

type OverviewAccountRecord = Record<string, unknown> & {
  envName: string;
  name: string;
  authMode?: string;
  apiKeyValue?: string;
  authProfile?: {
    plan: string;
    usage5h: string;
    usageWeekly: string;
  };
};

type DesktopActionResult = {
  message: string;
  output?: string;
};

type EnvEditableFilesResult = {
  configToml: string;
  authJson: string;
};

interface TerminalLaunchAttempt {
  command: string;
  args: string[];
}

interface CliTerminalLaunchPlan {
  platform: "macos" | "windows" | "linux" | "unknown";
  launchMode: "current-window" | "new-window";
  attempts: TerminalLaunchAttempt[];
}

interface CommandExecutionPlan {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  stdin?: string;
}

const authMetricsCache = new Map<string, {
  expiresAt: number;
  value: Awaited<ReturnType<typeof collectProfileMetrics>>;
}>();
const authMetricsInflight = new Map<string, Promise<Awaited<ReturnType<typeof collectProfileMetrics>>>>();
const terminalLaunchGate = createTerminalLaunchGate(2_000);
let terminalLaunchSequence = 0;
let desktopOperationsLoaderForTest:
  | (() => Promise<DesktopOperationsServiceLike>)
  | undefined;
let usageRouterManager: UsageRouterManager | undefined;
let usageRouterManagerStateDir: string | undefined;
let subscriptionQuotaManager: SubscriptionQuotaManager | undefined;
let subscriptionQuotaManagerStateDir: string | undefined;
let desktopNotificationService: DesktopNotificationService | undefined;
let desktopNotificationDependencies: {
  getWindow: () => DesktopNotificationWindow | undefined;
  getWindows: () => DesktopNotificationWindow[];
  notification: DesktopNotificationConstructor;
} | undefined;
let envHistoryCleanupQueue: Promise<void> = Promise.resolve();
let skillManager: SkillManager | undefined;
let skillManagerStateDir: string | undefined;

function getSkillManager(): SkillManager {
  const stateDir = getStateDir();
  if (!skillManager || skillManagerStateDir !== stateDir) {
    skillManager = new SkillManager({
      stateDir,
      catalogUrl: process.env.CODEX_SWITCHER_SKILLS_CATALOG_URL,
      environments: async () => {
        const state = await (await loadCoreRuntime()).readLegacyState(getLegacyOptions());
        return Object.values(state.envs).map((environment) => ({
          name: environment.name,
          homePath: environment.path,
        }));
      },
    });
    skillManagerStateDir = stateDir;
  }
  return skillManager;
}

export function getSkillSnapshot(options: SkillSnapshotOptions | boolean = {}) {
  return getSkillManager().getSnapshot(typeof options === "boolean" ? { refreshMarketplace: options } : options);
}

export function installSkill(input: InstallSkillInput) {
  return getSkillManager().install(input);
}

export function checkSkillUpdates(envName: string) {
  return getSkillManager().checkUpdates(envName);
}

export function updateSkill(input: UpdateSkillInput) {
  return getSkillManager().update(input);
}

export function uninstallSkill(envName: string, skillId: string) {
  return getSkillManager().uninstall(envName, skillId);
}

export function setSkillProviderBinding(input: SetProviderBindingInput) {
  return getSkillManager().setProviderBinding(input);
}

export function createSkillProvider(input: CreateSkillProviderInput) {
  return getSkillManager().createProvider(input);
}

export function deleteSkillProvider(providerId: SkillProviderId) {
  return getSkillManager().deleteProvider(providerId);
}

export function repairSkillProvider(providerId: SkillProviderId) {
  return getSkillManager().repairProvider(providerId);
}

async function listCodexSkillEnvironments(): Promise<CodexSkillEnvironment[]> {
  const state = await (await loadCoreRuntime()).readLegacyState(getLegacyOptions());
  return Object.values(state.envs)
    .map((environment) => ({ name: environment.name, homePath: environment.path }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function getGeneratedImageRecoveryBundledSkillPath(): string {
  const relativePath = join("skills", "recover-codex-generated-images");
  const resourcesPath = getConfiguredResourcesPath();
  if (resourcesPath) {
    const packagedPath = join(resourcesPath, relativePath);
    if (existsSync(packagedPath)) return packagedPath;
  }
  return resolveRuntimeResource(join("apps", "desktop", "resources", relativePath), { currentFile: __filename });
}

async function reconcileGeneratedImageRecoveryForEnvironments(
  enabled: boolean,
  environments: CodexSkillEnvironment[],
) {
  return reconcileGeneratedImageRecoverySkill({
    enabled,
    environments,
    bundledSkillPath: getGeneratedImageRecoveryBundledSkillPath(),
  });
}

function getUsageRouterManager(): UsageRouterManager {
  const stateDir = getStateDir();
  if (!usageRouterManager || usageRouterManagerStateDir !== stateDir) {
    usageRouterManager = new UsageRouterManager({
      stateDir,
      serviceEntryPath: join(currentDir, "usage-router-service-main.cjs"),
      preferredPort: async () => (await readRouterPortSettings(getCodexToolPathOptions().settingsPath)).preferredPort,
      defaultProxyUrl: async () => {
        const proxy = await resolveUsageProxy();
        return proxy || undefined;
      },
      gatewayResetAdmission: (input) => getSubscriptionQuotaManager().consumeForGateway(input),
    });
    usageRouterManagerStateDir = stateDir;
  }
  return usageRouterManager;
}

function getDesktopNotificationService(): DesktopNotificationService {
  if (!desktopNotificationService) {
    desktopNotificationService = new DesktopNotificationService({
      ...(desktopNotificationDependencies ?? {}),
    });
  }
  return desktopNotificationService;
}

/** Inject Electron-only dependencies from the main process without making the
 * bridge module depend on Electron named exports during browser/test imports. */
export function configureDesktopNotificationService(options: {
  getWindow: () => DesktopNotificationWindow | undefined;
  getWindows: () => DesktopNotificationWindow[];
  notification: DesktopNotificationConstructor;
}): void {
  desktopNotificationDependencies = options;
  desktopNotificationService = undefined;
}

function broadcastResetCardEvent(channel: "desktop:resetCardSnapshot" | "desktop:resetCardOperation" | "desktop:resetCardNotification" | "desktop:resetCardNotificationClick", payload: unknown): void {
  for (const window of desktopNotificationDependencies?.getWindows() ?? []) {
    if (window.isDestroyed()) continue;
    window.webContents.send(channel, payload);
  }
}

async function discoverSubscriptionAccounts(): Promise<CodexSubscriptionAccount[]> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const references = buildAccountReferences(state);
  const proxyUrl = await resolveUsageProxy();
  const accounts: CodexSubscriptionAccount[] = [];
  for (const [envName, environment] of Object.entries(state.envs)) {
    for (const [accountName, account] of Object.entries(environment.accounts)) {
      if (!isEligibleSubscriptionAccount(account)) continue;
      const credentials = extractSubscriptionCredentials(account.authData);
      if (!credentials.accessToken) continue;
      const authFile = await resolveAuthFile(envName, accountName, environment.path);
      if (!authFile) continue;
      const accountKey = canonicalAccountKey({
        providerId: account.runtime.providerId,
        accountId: credentials.accountId,
        workspaceId: credentials.workspaceId,
        email: credentials.email,
        accessToken: credentials.accessToken,
      });
      const accountReferences = references.get(accountKey)
        ?? [{ accountKey, envName, accountName, authMode: account.authMode, preferredAuthMethod: account.runtime.preferredAuthMethod }];
      accounts.push({
        accountKey,
        envName,
        accountName,
        authMode: account.authMode,
        preferredAuthMethod: account.runtime.preferredAuthMethod,
        authFile,
        homePath: environment.path,
        accessToken: credentials.accessToken,
        ...(credentials.accountId ? { accountId: credentials.accountId } : {}),
        ...(credentials.workspaceId ? { workspaceId: credentials.workspaceId } : {}),
        ...(proxyUrl ? { proxyUrl } : {}),
        references: accountReferences,
      });
    }
  }
  return accounts;
}

function getSubscriptionQuotaManager(): SubscriptionQuotaManager {
  const stateDir = getStateDir();
  if (!subscriptionQuotaManager || subscriptionQuotaManagerStateDir !== stateDir) {
    const notifications = getDesktopNotificationService();
    subscriptionQuotaManager = new SubscriptionQuotaManager({
      stateDir,
      discoverAccounts: discoverSubscriptionAccounts,
      onSnapshot: (snapshot) => {
        cacheSubscriptionUsageMetrics(snapshot);
        broadcastResetCardEvent("desktop:resetCardSnapshot", snapshot);
      },
      onOperation: (event) => broadcastResetCardEvent("desktop:resetCardOperation", event),
      onNotify: async (input) => {
        const settings = await subscriptionQuotaManager?.getSettings();
        if (!settings) return;
        notifications.setEnabled(settings.notificationsEnabled);
        const reference = input.snapshot?.envNames?.[0] && input.snapshot?.accountNames?.[0]
          ? { envName: input.snapshot.envNames[0], accountName: input.snapshot.accountNames[0] }
          : undefined;
        const title = input.kind === "expiring" ? "Codex 重置卡即将到期"
          : input.kind === "pre-consume" ? "即将使用 Codex 重置卡"
          : input.kind === "consumed" ? "Codex 重置卡已使用"
            : input.kind === "reauth-required" ? "Codex 账号需要重新登录" : "Codex 订阅同步提醒";
        notifications.notify({ title, body: input.message, accountKey: input.accountKey, ...reference, tag: `${input.kind}:${input.accountKey}` });
      },
      allowWeeklyAutoUse: async (accountKey) => canConsumeWeeklyReset(accountKey),
    });
    subscriptionQuotaManagerStateDir = stateDir;
  }
  return subscriptionQuotaManager;
}

function cacheSubscriptionUsageMetrics(snapshot: ResetCardSnapshot): void {
  const usage5h = snapshot.usageWindows.find((window) => window.name === "five-hour");
  const usageWeekly = snapshot.usageWindows.find((window) => window.name === "weekly");
  snapshot.envNames.forEach((envName, index) => {
    const accountName = snapshot.accountNames[index];
    if (!accountName) return;
    const key = `${envName}/${accountName}`;
    const previous = authMetricsCache.get(key)?.value;
    // The subscription manager starts during app boot, before the account
    // metrics request normally populates email/plan. Do not seed the cache
    // with placeholder identity data here: that would make the first
    // accounts-page render show "-" until the next subscription refresh.
    // Once profile metrics exist, only the usage fields are overlaid so the
    // live reset timestamp is preserved without clobbering identity fields.
    if (!previous) return;
    const value = {
      email: previous.email,
      plan: snapshot.plan ?? previous.plan,
      usage5h: formatSubscriptionUsageMetric(usage5h),
      usageWeekly: formatSubscriptionUsageMetric(usageWeekly),
    };
    authMetricsCache.set(key, { value, expiresAt: Math.max(Date.now() + AUTH_METRICS_TTL_MS, snapshot.nextRefreshAt ?? 0) });
  });
}

export function formatSubscriptionUsageMetric(window: ResetCardSnapshot["usageWindows"][number] | undefined): string {
  if (window?.usedPercent === undefined) return "-";
  const percent = `${Math.round(window.usedPercent)}%`;
  if (window.resetsAt === undefined || !Number.isFinite(window.resetsAt)) return percent;
  const resetAt = new Date(window.resetsAt);
  if (!Number.isFinite(resetAt.getTime())) return percent;
  const pad = (value: number) => String(value).padStart(2, "0");
  // Keep the legacy auth-metrics wire format so the renderer can continue
  // to show a live local countdown instead of falling back to "待刷新".
  return `${percent} (${pad(resetAt.getMonth() + 1)}-${pad(resetAt.getDate())} ${pad(resetAt.getHours())}:${pad(resetAt.getMinutes())})`;
}

async function canConsumeWeeklyReset(accountKey: string): Promise<boolean> {
  const accounts = await discoverSubscriptionAccounts();
  const refs = accounts.find((account) => account.accountKey === accountKey)?.references ?? [];
  const pools = await getUsageRouterManager().listAccountPools().catch(() => []);
  for (const reference of refs) {
    const pool = pools.find((candidate) => candidate.envName === reference.envName && candidate.enabled
      && candidate.members.some((member) => member.enabled && member.accountName === reference.accountName));
    if (!pool) continue;
    const viableFallback = pool.health.some((health) => health.accountName !== reference.accountName
      && ["healthy", "degraded"].includes(health.state));
    const admission = decideResetGatewayAdmission({
      subscriptionAccount: true,
      weeklyExhausted: true,
      poolEnabled: true,
      viableFallback,
      alreadyRetried: false,
    });
    if (!admission.allowed) return false;
  }
  return true;
}

export async function startSubscriptionQuotaManager(): Promise<void> {
  await getSubscriptionQuotaManager().start();
}

export async function stopSubscriptionQuotaManager(): Promise<void> {
  await subscriptionQuotaManager?.stop();
}

export async function refreshSubscriptionQuotaOnFocus(): Promise<void> {
  if (!subscriptionQuotaManager) return;
  await subscriptionQuotaManager.notifyAppFocus();
}

export async function refreshSubscriptionQuotaOnResume(): Promise<void> {
  if (!subscriptionQuotaManager) return;
  await subscriptionQuotaManager.notifySystemResume();
}

export async function refreshSubscriptionQuotaAfterAccountMutation(): Promise<void> {
  if (!subscriptionQuotaManager) return;
  await subscriptionQuotaManager.notifyAccountsChanged();
}

export async function listResetCardSnapshots(): Promise<ResetCardSnapshot[]> {
  return getSubscriptionQuotaManager().getSnapshots();
}

export async function refreshResetCardAccount(accountKey: string): Promise<ResetCardRefreshResult> {
  const manager = getSubscriptionQuotaManager();
  return manager.refreshAccount(accountKey, true);
}

export async function getResetCardSettings(): Promise<ResetCardSettings> {
  return getSubscriptionQuotaManager().getSettings();
}

export async function setResetCardSettings(value: Partial<ResetCardSettings>): Promise<ResetCardSettings> {
  const settings = await getSubscriptionQuotaManager().setSettings(value);
  getDesktopNotificationService().setEnabled(settings.notificationsEnabled);
  return settings;
}

export async function setResetCardAccountAutoUse(accountKey: string, input: { enabled?: boolean; autoUseMode?: AutoUseMode; preConsumeMode?: ResetCardSettings["preConsumeMode"] }): Promise<ResetCardSettings> {
  return getSubscriptionQuotaManager().setAccountAutoUse(accountKey, input);
}

export async function consumeResetCard(accountKey: string, cardId?: string, confirmed = false): Promise<Awaited<ReturnType<SubscriptionQuotaManager["consume"]>>> {
  return getSubscriptionQuotaManager().consume(accountKey, cardId, "manual", undefined, confirmed);
}

export async function listPendingResetCardActions() {
  return getSubscriptionQuotaManager().getPendingActions();
}

export async function confirmPendingResetCard(accountKey: string, actionId?: string): Promise<void> {
  await getSubscriptionQuotaManager().confirmPendingAction(accountKey, actionId);
}

export async function cancelPendingResetCard(accountKey: string, actionId?: string): Promise<void> {
  await getSubscriptionQuotaManager().cancelPendingAction(accountKey, actionId);
}

export function getResetCardNotificationStatus(): ResetCardNotificationStatus {
  return getDesktopNotificationService().getStatus();
}

export async function getEnvironmentRouteStatuses() {
  await synchronizeEnabledEnvironmentRoutes();
  const state = await (await loadCoreRuntime()).readLegacyState(getLegacyOptions());
  return getUsageRouterManager().getEnvironmentStatuses(Object.keys(state.envs).sort());
}

/**
 * Returns a redacted view of the compiled gateway document and the runtime
 * routes. This deliberately reads the persisted/compiled state instead of
 * reconstructing a preview in React, so the panel is an operational diagnostic
 * and never leaks credentials or presents a route that the gateway cannot use.
 */
export async function getEnvironmentRoutePreviews(): Promise<EnvironmentRoutePreview[]> {
  // The status endpoint owns the runtime reconciliation. Keeping this read
  // side-effect free is important because the renderer polls both endpoints
  // together and a preview request must never trigger a second gateway rebuild
  // or wake Codex App's config watcher.
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const manager = getUsageRouterManager();
  const statuses = await manager.getEnvironmentStatuses(Object.keys(state.envs).sort());
  const gateways = await manager.listPersistedEnvironmentGateways().catch(() => []);
  const routes = await manager.listPersistedRoutes().catch(() => []);
  const now = Date.now();

  return Object.values(state.envs).sort((left, right) => left.name.localeCompare(right.name)).map((environment) => {
    const status = statuses.find((item) => item.envName === environment.name);
    const runtimeGateway = gateways.find((item) => item.envName === environment.name && item.enabled);
    const gateway = environment.gateway;
    const gatewayEnabled = Boolean(status?.gatewayEnabled || runtimeGateway || gateway?.mode === "gateway");
    const gatewayRunning = Boolean(status?.gatewayEnabled && status.enabled);
    // Only routes materialized by the running gateway are meaningful in this
    // operational map. Bound accounts that have no runtime route are omitted;
    // keeping the preview scoped to materialized routes also lets every
    // environment explain its own gateway instead of accidentally hiding all
    // non-current environments behind the single global App target.
    const environmentRoutes = routes.filter((route) => route.envName === environment.name && route.enabled);
    const warnings: string[] = [];
    if (!gatewayEnabled) warnings.push("Gateway mode is disabled; direct account routing is active.");
    if (environment.modelIdentityMode === "unified" && !gatewayEnabled) {
      warnings.push("Unified model identity is stored but only takes effect when Gateway mode is enabled.");
    }
    const models: EnvironmentRoutePreviewModel[] = Object.values(gateway?.routeGroups ?? {})
      .filter((group) => !group.id.startsWith("compat-route-group:"))
      .map((group) => {
        const groupRoutes = environmentRoutes.filter((route) => route.routeGroupId === group.id);
        const previewRoutes: EnvironmentRoutePreviewRoute[] = groupRoutes.map((route) => {
          const credential = gateway ? Object.values(gateway.credentials).find((candidate) => (
            candidate.providerId === route.providerId
            && (candidate.displayName === route.accountName
              || candidate.secretRef === `account:${encodeURIComponent(environment.name)}:${encodeURIComponent(route.accountName)}`)
          )) : undefined;
          const provider = route.providerId ? gateway?.providers[route.providerId] : undefined;
          const routeModelId = gateway && route.providerId
            ? Object.values(gateway.models).find((model) => model.providerId === route.providerId && model.upstreamModelId === (route.upstreamModel ?? ""))?.id
            : undefined;
          const groupMember = group.members.find((member) => member.modelId === routeModelId);
          const credentialStatus = credential?.status;
          const routeStatus: EnvironmentRoutePreviewRoute["status"] = !route.enabled || credentialStatus === "disabled"
            ? "disabled"
            : credentialStatus === "cooldown" ? "cooldown"
              : gatewayRunning ? "healthy" : "unknown";
          return {
            routeId: route.routeId,
            accountName: route.accountName,
            providerId: route.providerId ?? "unknown",
            providerDisplayName: provider?.displayName ?? route.providerId ?? "unknown",
            upstreamModelId: route.upstreamModel ?? "",
            protocol: route.protocol,
            status: routeStatus,
            capabilities: {
              tools: route.capabilities?.tools === true,
              vision: route.capabilities?.vision === true,
              streaming: route.capabilities?.streaming !== false,
              reasoning: route.capabilities?.reasoning === true,
            },
            priority: groupMember?.priority ?? 0,
            weight: groupMember?.weight ?? 1,
            isDefault: runtimeGateway?.defaultRouteId === route.routeId || gateway?.defaultRouteGroupId === group.id,
          };
        });
        const capabilities = intersectPreviewCapabilities(previewRoutes.map((route) => route.capabilities));
        if (!previewRoutes.length) warnings.push(`Model '${group.exposedModelId}' has no materialized runtime route.`);
        return {
          exposedModelId: group.exposedModelId,
          displayName: group.displayName,
          routes: previewRoutes,
          capabilities,
          strategy: group.strategy,
          sessionPolicy: group.sessionPolicy,
          fallbackEnabled: group.fallbackEnabled,
        };
      })
      .filter((model) => model.routes.length > 0);
    return {
      envName: environment.name,
      gatewayEnabled,
      gatewayStatus: gatewayRunning ? "running" : gatewayEnabled ? "configured" : "stopped",
      mode: normalizeEnvironmentModelIdentityModeForPreview(environment.modelIdentityMode),
      ...((runtimeGateway?.gatewayId ?? gateway?.gatewayId) ? { gatewayId: runtimeGateway?.gatewayId ?? gateway?.gatewayId } : {}),
      ...(status?.localGatewayBaseUrl ? { baseUrl: status.localGatewayBaseUrl } : {}),
      generatedAt: now,
      models,
      providerCount: Object.keys(gateway?.providers ?? {}).length,
      warnings,
    };
  });
}

/**
 * Remote control uses the official ChatGPT identity stored in an environment,
 * while the model service follows the currently selected account. Keep the
 * two signals together on the environment card so switching an API key never
 * looks like a remote logout.
 */
export async function getEnvironmentRemoteStatuses(): Promise<EnvironmentRemoteStatus[]> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const routeStatuses = await getUsageRouterManager()
    .getEnvironmentStatuses(Object.keys(state.envs).sort())
    .catch(() => []);

  return Object.values(state.envs)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((environment) => buildEnvironmentRemoteStatus(state, environment.name, routeStatuses));
}

export async function setEnvironmentRemoteAccount(
  envName: string,
  accountName?: string,
): Promise<EnvironmentRemoteStatus> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const environment = state.envs[envName];
  if (!environment) throw new Error(`Environment '${envName}' not found`);

  const normalized = accountName?.trim();
  if (normalized) {
    const account = environment.accounts[normalized];
    if (!account || account.authMode !== "auth" || !account.authData) {
      throw new Error("手机远程需要已登录的官方账号");
    }

    // A direct CODEX_HOME has one official ChatGPT identity. An environment
    // gateway is different: it hydrates each model credential inside the
    // gateway while the home keeps the selected remote account's auth.json.
    // API-key accounts are also independent because their key is delivered
    // through the model provider environment key.
    if (environment.gateway?.mode !== "gateway") {
      for (const target of ["cli", "app"] as const) {
        const pointer = state.targets[target];
        if (pointer.env !== envName) continue;
        const selected = environment.accounts[pointer.account];
        if (selected?.authMode === "auth" && pointer.account !== normalized) {
          throw new Error("同一环境的订阅账号与手机远程账号必须一致，请拆分环境");
        }
      }
    }
  }

  await runtime.setLegacyEnvRemoteAccount({
    stateDir: getStateDir(),
    envName,
    ...(normalized ? { accountName: normalized } : {}),
  });
  const nextState = await runtime.readLegacyState(getLegacyOptions());
  await reapplyEnvironmentTargetHomes(runtime, nextState, envName, "switch-cli");
  const routeStatuses = await getUsageRouterManager()
    .getEnvironmentStatuses(Object.keys(nextState.envs).sort())
    .catch(() => []);
  return buildEnvironmentRemoteStatus(nextState, envName, routeStatuses);
}

function buildEnvironmentRemoteStatus(
  state: Awaited<ReturnType<CoreRuntime["readLegacyState"]>>,
  envName: string,
  routeStatuses: Array<{ envName: string; gatewayEnabled?: boolean }>,
): EnvironmentRemoteStatus {
  const environment = state.envs[envName];
  if (!environment) throw new Error(`Environment '${envName}' not found`);
  const remoteAccountName = environment.remoteControl?.accountName;
  const remoteAccount = remoteAccountName ? environment.accounts[remoteAccountName] : undefined;
  const hasOfficialAccount = Object.values(environment.accounts).some((account) => (
    account.authMode === "auth" && Boolean(account.authData)
  ));
  // Official pairing happens in ChatGPT desktop settings and cannot be
  // verified by Switcher. A valid account therefore means pairing is still
  // required; never present it as an active mobile connection here.
  const status: EnvironmentRemoteStatus["status"] = remoteAccountName
    ? remoteAccount?.authMode === "auth" && remoteAccount.authData
      ? "needs_pairing"
      : "needs_login"
    : hasOfficialAccount ? "needs_account" : "unavailable";

  const target = state.targets.app.env === envName
    ? state.targets.app
    : state.targets.cli.env === envName
      ? state.targets.cli
      : undefined;
  const modelAccountName = target?.account && environment.accounts[target.account]
    ? target.account
    : Object.keys(environment.accounts)[0];
  const modelAccount = modelAccountName ? environment.accounts[modelAccountName] : undefined;
  const gateway = routeStatuses.find((item) => item.envName === envName)?.gatewayEnabled
    || environment.gateway?.mode === "gateway";
  const modelServiceLabel = gateway
    ? "Switcher 网关"
    : modelAccount?.authMode === "apikey" || modelAccount?.runtime.preferredAuthMethod === "apikey"
      ? `API Key${formatProviderSuffix(modelAccount.runtime.providerId ?? modelAccount.runtime.openaiBaseUrl)}`
      : modelAccount
        ? "官方账号"
        : "未配置";

  return {
    envName,
    status,
    ...(remoteAccountName ? { remoteAccountName } : {}),
    ...(remoteAccount ? { remoteAccountEmail: readAccountEmail(remoteAccount.authData) } : {}),
    modelServiceLabel,
    ...(modelAccountName ? { modelAccountName } : {}),
  };
}

function readAccountEmail(value: Record<string, unknown> | undefined): string | undefined {
  if (!value) return undefined;
  for (const key of ["email", "email_address", "user_email"]) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
  }
  return undefined;
}

function formatProviderSuffix(value: string | undefined): string {
  if (!value) return "";
  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      return ` · ${new URL(value).host}`;
    } catch {
      return "";
    }
  }
  return ` · ${value}`;
}

export async function setEnvironmentModelIdentityMode(
  envName: string,
  mode: EnvironmentModelIdentityMode,
): Promise<EnvironmentRoutePreview> {
  if (mode !== "account" && mode !== "unified") throw new Error(`Unsupported model identity mode '${String(mode)}'`);
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const environment = state.envs[envName];
  if (!environment) throw new Error(`Environment '${envName}' not found`);
  await runtime.setLegacyEnvModelIdentityMode({ stateDir: getStateDir(), envName, modelIdentityMode: mode });

  const activeGateway = (await getUsageRouterManager().listPersistedEnvironmentGateways()).find((item) => item.envName === envName && item.enabled);
  if (activeGateway) {
    const latest = await runtime.readLegacyState(getLegacyOptions());
    const latestEnvironment = latest.envs[envName];
    if (!latestEnvironment) throw new Error(`Environment '${envName}' disappeared while changing model identity mode`);
    const generated = await buildEnvironmentGatewayState(runtime, latestEnvironment);
    const accounts = await getEnvironmentGatewayRouteAccounts(latest, envName, generated);
    const updateBaseUrl = createEnvironmentRouteBaseUrlUpdater(runtime, envName);
    const result = await getUsageRouterManager().enableEnvironmentGateway(
      envName,
      accounts,
      updateBaseUrl,
      generated.routeGroups,
      buildGatewayRouteBindings(latestEnvironment, generated),
      generated.routeRules ?? [],
      generated.defaultRouteGroupId,
    );
    const nextGateway = {
      ...generated,
      mode: "gateway" as const,
      gatewayId: result.gatewayId ?? generated.gatewayId,
      catalogVersion: generated.catalogVersion + 1,
    };
    await runtime.writeLegacyGateway({ stateDir: getStateDir(), envName, gateway: nextGateway });
    await synchronizeEnvironmentGatewayModelCatalog({
      homePath: latestEnvironment.path,
      gateway: nextGateway,
      modelCatalog: await getModelCatalogStore().load(),
      environmentName: envName,
      diagnosticLogPath: resolveLogPath("switcher"),
      loadBundledCatalog: async () => (await loadBundledCatalogForCurrentInstall()) ?? { models: [] },
    });
  }
  return (await getEnvironmentRoutePreviews()).find((preview) => preview.envName === envName)!;
}

function normalizeEnvironmentModelIdentityModeForPreview(value: unknown): EnvironmentModelIdentityMode {
  return value === "unified" ? "unified" : "account";
}

function intersectPreviewCapabilities(values: EnvironmentRoutePreviewRoute["capabilities"][]): EnvironmentRoutePreviewRoute["capabilities"] {
  if (!values.length) return { tools: false, vision: false, streaming: false, reasoning: false };
  return {
    tools: values.every((value) => value.tools),
    vision: values.every((value) => value.vision),
    streaming: values.every((value) => value.streaming),
    reasoning: values.every((value) => value.reasoning),
  };
}

function getEnvironmentRouteAccounts(
  state: Awaited<ReturnType<Awaited<ReturnType<typeof loadCoreRuntime>>["readLegacyState"]>>,
  envName: string,
  gateway?: GatewayEnvironmentState,
) {
  const env = state.envs[envName];
  if (!env) throw new Error(`Environment '${envName}' not found`);
  return Object.entries(env.accounts).map(([accountName, account]) => {
    const secretRef = createAccountSecretRef(envName, accountName);
    const credential = (gateway && Object.values(gateway.credentials).find((candidate) => candidate.secretRef === secretRef))
      ?? (gateway && Object.values(gateway.credentials).find((candidate) => (
        (candidate.displayName === accountName || candidate.displayName === account.name)
      )));
    // Prefer the compiled credential's provider identity. This is important
    // after Gateway mode rewrites the account runtime Base URL to localhost:
    // the runtime no longer contains the upstream provider name, while the
    // credential is already bound to the provider used by the gateway.
    const providerId = credential?.providerId
      ?? resolveRuntimeProviderId(account);
    const proxyUrl = credential?.proxyUrl ?? gateway?.providers[providerId]?.proxyUrl;
    return {
      envName,
      accountName,
      authMode: account.authMode,
      providerId,
      providerAuthMethod: account.runtime.providerAuthMethod,
      apiKey: account.authMode === "auth"
        ? extractAccessTokenFromAuthData(account.authData)
        : extractProviderAccessTokenFromAuthData(account.authData),
      authAccountId: extractAccountIdFromAuthData(account.authData),
      protocol: account.authMode === "auth"
        ? "responses" as const
        : account.runtime.apiProtocol === "chat_completions"
          ? "chat_completions" as const
          : account.runtime.apiProtocol === "anthropic"
            ? "anthropic" as const
            : "responses" as const,
      upstreamModel: account.runtime.compatibilityUpstreamModel,
      baseUrl: account.runtime.openaiBaseUrlMode === "custom" && account.runtime.openaiBaseUrl
        ? account.runtime.openaiBaseUrl
        : "default",
      ...(account.runtime.providerRequestHeaders && Object.keys(account.runtime.providerRequestHeaders).length
        ? { requestHeaders: account.runtime.providerRequestHeaders }
        : {}),
      ...(proxyUrl ? { proxyUrl } : {}),
    };
  });
}

/**
 * Gateway rebuilds need the provider's upstream URL, even when the account
 * runtime currently points at a local /routes, /pools, or /gateways URL. The
 * persisted route record retains that upstream value, so use it as the source
 * of truth while rebuilding the environment gateway.
 */
async function getEnvironmentGatewayRouteAccounts(
  state: Awaited<ReturnType<Awaited<ReturnType<typeof loadCoreRuntime>>["readLegacyState"]>>,
  envName: string,
  gateway: GatewayEnvironmentState,
) {
  const accounts = getEnvironmentRouteAccounts(state, envName, gateway);
  const routes = await getUsageRouterManager().listPersistedRoutes().catch(() => []);
  return accounts.map((account) => {
    if (!isLocalRouterBaseUrl(account.baseUrl)) return account;
    const providerEndpoint = resolveGatewayProviderEndpoint(gateway, account.providerId, account.protocol);
    const candidates = routes.filter((route) => (
      route.envName === envName
      && route.accountName === account.accountName
      && route.enabled
    ));
    const route = candidates.find((candidate) => !candidate.exposedModelId) ?? candidates[0];
    // Prefer the compiled provider endpoint. The route record is retained as
    // a legacy fallback, but old states can contain api.openai.com here even
    // when discovery has already restored a custom OpenAI-compatible provider.
    return providerEndpoint
      ? { ...account, baseUrl: providerEndpoint }
      : route ? { ...account, baseUrl: resolveRouteDisplayBaseUrl(route) } : account;
  });
}

function resolveGatewayProviderEndpoint(
  gateway: GatewayEnvironmentState,
  providerId: string,
  protocol: "responses" | "chat_completions" | "anthropic" | "gemini",
): string | undefined {
  const provider = gateway.providers[providerId];
  if (!provider) return undefined;
  switch (protocol) {
    case "chat_completions": return provider.endpoints.chatCompletions ?? provider.endpoints.responses;
    case "anthropic": return provider.endpoints.anthropicMessages;
    case "gemini": return provider.endpoints.gemini;
    default: return provider.endpoints.responses;
  }
}

function sanitizeProviderRequestHeaders(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const blocked = new Set([
    "authorization",
    "cookie",
    "set-cookie",
    "proxy-authorization",
    "host",
    "content-length",
    "transfer-encoding",
  ]);
  const result: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = rawName.trim();
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) continue;
    if (blocked.has(name.toLowerCase()) || typeof rawValue !== "string") continue;
    if (rawValue.includes("\r") || rawValue.includes("\n") || rawValue.length > 4096) continue;
    result[name] = rawValue;
  }
  return Object.keys(result).length ? result : undefined;
}

/**
 * Projects the persisted Gateway catalog into explicit runtime bindings.
 * Credentials still resolve to the existing environment accounts; the
 * Gateway catalog contributes the provider/model/group selection only.
 * There is deliberately no prompt, classifier, or intent selector here.
 */
function buildGatewayRouteBindings(
  environment: {
    name: string;
    accounts: Record<string, {
      name: string;
      authMode: string;
      runtime?: { apiProtocol?: string; providerRequestHeaders?: Record<string, string> };
    }>;
  },
  gateway: GatewayEnvironmentState,
): GatewayRouteBinding[] {
  const accountNamesByCredential = new Map<string, string>();
  for (const [credentialId, credential] of Object.entries(gateway.credentials)) {
    const secretParts = credential.secretRef.split(":");
    const referencedName = secretParts.length >= 3 && secretParts[0] === "account"
      && decodeURIComponent(secretParts[1] ?? "") === environment.name
      ? decodeURIComponent(secretParts.slice(2).join(":"))
      : undefined;
    const fallback = Object.entries(environment.accounts).find(([accountName, account]) =>
      accountName === credential.displayName || account.name === credential.displayName,
    )?.[0];
    const accountName = referencedName && environment.accounts[referencedName] ? referencedName : fallback;
    if (accountName) accountNamesByCredential.set(credentialId, accountName);
  }

  const headersByCredentialAccount = (credentialIds: string[], providerId: string): Record<string, Record<string, string>> => {
    const result: Record<string, Record<string, string>> = {};
    const providerHeaders = gateway.providers[providerId]?.requestHeaders ?? {};
    for (const credentialId of credentialIds) {
      const accountName = accountNamesByCredential.get(credentialId);
      if (!accountName) continue;
      const credentialHeaders = gateway.credentials[credentialId]?.requestHeaders ?? {};
      const runtimeHeaders = environment.accounts[accountName]?.runtime?.providerRequestHeaders ?? {};
      const headers = { ...runtimeHeaders, ...providerHeaders, ...credentialHeaders };
      if (Object.keys(headers).length) result[accountName] = { ...(result[accountName] ?? {}), ...headers };
    }
    return result;
  };

  const proxyByCredentialAccount = (credentialIds: string[], providerId: string): Record<string, string> => {
    const result: Record<string, string> = {};
    const providerProxy = gateway.providers[providerId]?.proxyUrl;
    for (const credentialId of credentialIds) {
      const accountName = accountNamesByCredential.get(credentialId);
      if (!accountName) continue;
      const proxyUrl = gateway.credentials[credentialId]?.proxyUrl ?? providerProxy;
      if (proxyUrl) result[accountName] = proxyUrl;
    }
    return result;
  };

  const result: GatewayRouteBinding[] = [];
  const protocolForAccount = (accountName: string): RouteProtocol => {
    const account = environment.accounts[accountName];
    if (account?.authMode === "auth") return "responses";
    const configured = account?.runtime?.apiProtocol;
    return configured === "chat_completions" || configured === "anthropic" || configured === "gemini"
      ? configured
      : "responses";
  };
  const protocolForBinding = (
    model: GatewayEnvironmentState["models"][string],
    providerId: string,
    credentialId: string,
    accountName: string,
  ): RouteProtocol | undefined => {
    const provider = gateway.providers[providerId];
    const credential = gateway.credentials[credentialId];
    if (!provider || !credential || credential.providerId !== providerId) return undefined;
    const candidates = model.protocols.filter((protocol): protocol is GatewayProtocol => (
      gatewayProviderSupportsProtocol(provider, protocol)
        && gatewayCredentialSupportsProtocol(credential, protocol)
    ));
    if (!candidates.length) return undefined;
    // OpenAI-compatible providers can expose both Responses and Chat
    // Completions. Preserve the account's configured wire API in that case;
    // Anthropic/Gemini accounts naturally fall through to their only upstream
    // protocol while the gateway converts the Responses ingress.
    const configured = protocolForAccount(accountName);
    return candidates.includes(configured) ? configured : candidates[0];
  };
  const addBinding = (
    group: GatewayRouteGroupDefinition | undefined,
    member: GatewayRouteGroupDefinition["members"][number],
  ) => {
    const model = gateway.models[member.modelId];
    if (!model || !model.enabled) return;
    const credentials = member.credentialSelector.credentialIds?.length
      ? member.credentialSelector.credentialIds
      : Object.values(gateway.credentials)
        .filter((credential) => credential.providerId === member.providerId && credential.status !== "disabled")
        .map((credential) => credential.id);
    const accountByCredential = new Map(
      credentials
        .map((credentialId) => [credentialId, accountNamesByCredential.get(credentialId)] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
    );
    if (!accountByCredential.size) return;
    const upstreamProtocolByAccount: Record<string, RouteProtocol> = {};
    for (const credentialId of credentials) {
      const accountName = accountByCredential.get(credentialId);
      if (!accountName) continue;
      const upstreamProtocol = protocolForBinding(model, member.providerId, credentialId, accountName);
      if (upstreamProtocol) upstreamProtocolByAccount[accountName] = upstreamProtocol;
    }
    const accounts = [...new Set(Object.keys(upstreamProtocolByAccount))];
    if (!accounts.length) return;
    const requestHeadersByAccount = headersByCredentialAccount(credentials, member.providerId);
    const proxyUrlByAccount = proxyByCredentialAccount(credentials, member.providerId);
    const uniqueAccounts = [...new Set(accounts)];
    const protocolByAccount = Object.fromEntries(uniqueAccounts.map((accountName) => [accountName, protocolForAccount(accountName)]));
    const protocols = [...new Set(Object.values(upstreamProtocolByAccount))];
    result.push({
      providerId: member.providerId,
      modelId: model.id,
      upstreamModel: model.upstreamModelId,
      exposedModelId: group?.exposedModelId ?? model.id,
      ...(group ? { routeGroupId: group.id } : {}),
      accountNames: uniqueAccounts,
      protocols,
      protocolByAccount,
      upstreamProtocolByAccount,
      capabilities: {
        reasoning: model.capabilities.reasoning === true,
        tools: model.capabilities.tools === true,
        ...(model.capabilityProfile?.["tools.parallel"]?.status === "supported"
          ? { parallelToolCalls: true }
          : {}),
        vision: model.capabilities.vision !== false,
        streaming: model.capabilities.streaming !== false,
      },
      ...(model.capabilityProfile ? { capabilityProfile: model.capabilityProfile } : {}),
      ...(Object.keys(requestHeadersByAccount).length ? { requestHeadersByAccount } : {}),
      ...(Object.keys(proxyUrlByAccount).length ? { proxyUrlByAccount } : {}),
    });
  };

  for (const group of Object.values(gateway.routeGroups)) {
    // Compatibility aliases are nested references to the primary unified
    // group; materializing them again would overwrite the same route record.
    if (group.id.startsWith("compat-route-group:")) continue;
    for (const member of group.members) addBinding(group, member);
  }
  // A catalog model can be used directly even if it has not been placed in a
  // RouteGroup.  This is still explicit model routing, not intent routing.
  const groupedModelIds = new Set(Object.values(gateway.routeGroups).flatMap((group) => group.members.map((member) => member.modelId)));
  for (const model of Object.values(gateway.models)) {
    if (!model.enabled || groupedModelIds.has(model.id)) continue;
    const credentialIds = Object.values(gateway.credentials)
      .filter((credential) => credential.providerId === model.providerId && credential.status !== "disabled")
      .map((credential) => credential.id);
    const upstreamProtocolByAccount: Record<string, RouteProtocol> = {};
    for (const credentialId of credentialIds) {
      const accountName = accountNamesByCredential.get(credentialId);
      if (!accountName) continue;
      const upstreamProtocol = protocolForBinding(model, model.providerId, credentialId, accountName);
      if (upstreamProtocol) upstreamProtocolByAccount[accountName] = upstreamProtocol;
    }
    const credentials = Object.keys(upstreamProtocolByAccount);
    if (!credentials.length) continue;
    const requestHeadersByAccount = headersByCredentialAccount(
      Object.values(gateway.credentials)
        .filter((credential) => credential.providerId === model.providerId && credential.status !== "disabled")
        .map((credential) => credential.id),
      model.providerId,
    );
    const proxyUrlByAccount = proxyByCredentialAccount(
      Object.values(gateway.credentials)
        .filter((credential) => credential.providerId === model.providerId && credential.status !== "disabled")
        .map((credential) => credential.id),
      model.providerId,
    );
    const uniqueAccounts = [...new Set(credentials)];
    const protocolByAccount = Object.fromEntries(uniqueAccounts.map((accountName) => [accountName, protocolForAccount(accountName)]));
    const protocols = [...new Set(Object.values(upstreamProtocolByAccount))];
    result.push({
      providerId: model.providerId,
      modelId: model.id,
      upstreamModel: model.upstreamModelId,
      exposedModelId: model.id,
      accountNames: uniqueAccounts,
      protocols,
      protocolByAccount,
      upstreamProtocolByAccount,
      capabilities: model.capabilities,
      ...(model.capabilityProfile ? { capabilityProfile: model.capabilityProfile } : {}),
      ...(Object.keys(requestHeadersByAccount).length ? { requestHeadersByAccount } : {}),
      ...(Object.keys(proxyUrlByAccount).length ? { proxyUrlByAccount } : {}),
    });
  }
  return result;
}

function extractAccountIdFromAuthData(authData: Record<string, unknown> | undefined): string | undefined {
  const direct = readAuthStringField(authData, "account_id");
  if (direct) return direct;
  const rawTokens = authData?.tokens;
  if (!rawTokens) return undefined;
  try {
    const parsed = typeof rawTokens === "string" ? JSON.parse(rawTokens) as Record<string, unknown> : rawTokens as Record<string, unknown>;
    const tokenAccountId = parsed.account_id ?? parsed.chatgpt_account_id;
    if (typeof tokenAccountId === "string" && tokenAccountId.trim()) return tokenAccountId.trim();
    const accessToken = typeof parsed.access_token === "string" ? parsed.access_token : "";
    const payload = accessToken.split(".")[1];
    if (!payload) return undefined;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const auth = claims["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
    const accountId = auth?.chatgpt_account_id ?? claims.chatgpt_account_id ?? claims.account_id;
    return typeof accountId === "string" && accountId.trim() ? accountId.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function deriveAuthIdentityKey(
  authData: Record<string, unknown> | undefined,
  providerId = "chatgpt",
): string | undefined {
  const accountId = extractAccountIdFromAuthData(authData);
  const provider = providerId.trim() || "chatgpt";
  return accountId ? `${provider}:${accountId}` : undefined;
}

function hashAuthIdentityKey(identityKey: string): string {
  let hash = 2166136261;
  for (const character of identityKey) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function resolveAccountUpstreamBaseUrl(
  envName: string,
  accountName: string,
  runtime: { openaiBaseUrlMode: string; openaiBaseUrl?: string },
): Promise<string> {
  const routes = await getUsageRouterManager().listRoutesIfRunning().catch(() => []);
  const runtimeBaseUrl = runtime.openaiBaseUrlMode === "custom" && runtime.openaiBaseUrl ? runtime.openaiBaseUrl : "default";
  return selectCompatibilityUpstreamBaseUrl(routes, envName, accountName, runtimeBaseUrl);
}

type CatalogIdentityAccount = {
  name: string;
  authMode: string;
  runtime: {
    providerId?: string;
    openaiBaseUrlMode: string;
    openaiBaseUrl?: string;
    apiProtocol?: GatewayProtocol;
  };
};

/**
 * Resolve the provider identity used by the Codex-facing model catalog.
 *
 * The account runtime stores the local Gateway URL after a gateway is
 * enabled. That URL is only the ingress transport; the actual upstream
 * service remains on the gateway provider definition. Use that upstream
 * endpoint when available so legacy accounts with an empty/providerId=openai
 * still get a unique identity such as custom-openai:aicode.ckt.cn.
 */
function resolveCatalogProviderIdentity(
  environment: { name: string; gateway?: GatewayEnvironmentState },
  accountName: string,
  account: CatalogIdentityAccount,
  gateway = environment.gateway,
): { providerId: string; providerDisplayName?: string } {
  const runtimeProviderId = account.runtime.providerId?.trim()
    || (account.authMode === "auth" ? "chatgpt" : "openai");
  const configuredBaseUrl = account.runtime.openaiBaseUrlMode === "custom"
    ? account.runtime.openaiBaseUrl?.trim()
    : undefined;
  const secretRef = createAccountSecretRef(environment.name, accountName);
  const credential = gateway
    ? Object.values(gateway.credentials).find((candidate) => candidate.secretRef === secretRef)
    : undefined;
  const provider = credential ? gateway?.providers[credential.providerId] : undefined;
  const protocol = account.authMode === "auth" ? "responses" : account.runtime.apiProtocol ?? "responses";
  const upstreamBaseUrl = provider
    ? protocol === "chat_completions"
      ? provider.endpoints.chatCompletions ?? provider.endpoints.responses
      : protocol === "anthropic"
        ? provider.endpoints.anthropicMessages
        : protocol === "gemini"
          ? provider.endpoints.gemini
          : provider.endpoints.responses
    : undefined;
  const baseUrl = configuredBaseUrl && !isLocalRouterBaseUrl(configuredBaseUrl)
    ? configuredBaseUrl
    : upstreamBaseUrl && !isLocalRouterBaseUrl(upstreamBaseUrl)
      ? upstreamBaseUrl
      : configuredBaseUrl;
  const providerId = resolveModelCatalogProviderId(runtimeProviderId, baseUrl);
  const providerDisplayName = providerId.startsWith("custom-openai:")
    ? account.name.trim() || undefined
    : runtimeProviderId === "custom" || runtimeProviderId === "custom-openai"
      ? account.name.trim() || undefined
      : undefined;
  return { providerId, ...(providerDisplayName ? { providerDisplayName } : {}) };
}

function createEnvironmentRouteBaseUrlUpdater(
  runtime: Awaited<ReturnType<typeof loadCoreRuntime>>,
  envName: string,
  options: { applyTargetHome?: boolean } = {},
) {
  return async (accountName: string, baseUrl: string) => {
    const currentState = await runtime.readLegacyState(getLegacyOptions());
    const current = currentState.envs[envName]?.accounts[accountName];
    if (!current) throw new Error(`Account '${envName}/${accountName}' not found`);
    const next = runtime.createCoreApi({ getState: () => currentState }).updateAccountRuntime({
      envName,
      accountName,
      runtime: {
        ...current.runtime,
        openaiBaseUrlMode: baseUrl === "default" ? "default" : "custom",
        openaiBaseUrl: baseUrl === "default" ? undefined : baseUrl,
      },
      now: new Date().toISOString(),
    });
    const updated = next.envs[envName]?.accounts[accountName];
    if (!updated) throw new Error(`Unable to update '${envName}/${accountName}'`);
    await runtime.writeLegacyRuntime({ stateDir: getStateDir(), envName, accountName, runtime: updated.runtime });
    if (options.applyTargetHome !== false) {
      try {
        await applyEnvironmentRouteToActiveTarget(runtime, next, envName, accountName);
      } catch (error) {
        await runtime.writeLegacyRuntime({
          stateDir: getStateDir(),
          envName,
          accountName,
          runtime: current.runtime,
        });
        throw error;
      }
    }
  };
}

function createAccountPoolRuntimeUpdater(
  runtime: Awaited<ReturnType<typeof loadCoreRuntime>>,
  envName: string,
  protocol: "responses" | "chat_completions",
  options: { applyTargetHome?: boolean } = {},
) {
  if (protocol === "responses") return createEnvironmentRouteBaseUrlUpdater(runtime, envName, options);
  return async (accountName: string, baseUrl: string) => {
    const state = await runtime.readLegacyState(getLegacyOptions());
    const account = state.envs[envName]?.accounts[accountName];
    if (!account) throw new Error(`Account '${envName}/${accountName}' not found`);
    const apiKey = readAuthStringField(account.authData, "OPENAI_API_KEY");
    if (!apiKey) throw new Error(`Chat pool account '${envName}/${accountName}' has no API key`);
    if (/^http:\/\/127\.0\.0\.1:\d+\/pools\//.test(baseUrl)) {
      await writeCompatibilityRuntime(runtime, envName, accountName, {
        ...account.runtime,
        apiProtocol: "chat_completions",
        compatibilityRouteEnabled: true,
        compatibilityRouteBaseUrl: baseUrl,
        compatibilityRouteToken: apiKey,
        compatibilityRouteProviderId: undefined,
      });
      return;
    }
    await getUsageRouterManager().enableAccountCompatibility({
      envName, accountName, authMode: account.authMode, baseUrl, apiKey,
      providerId: account.runtime.providerId,
      upstreamModel: account.runtime.compatibilityUpstreamModel,
      reasoningProfile: account.runtime.compatibilityReasoningProfile,
      longConversationStrategy: account.runtime.compatibilityLongConversationStrategy,
      instructionRole: account.runtime.compatibilityInstructionRole,
      requestOverrides: account.runtime.compatibilityRequestOverrides,
    }, async ({ baseUrl: localBaseUrl, localRouteToken }) => {
      await writeCompatibilityRuntime(runtime, envName, accountName, {
        ...account.runtime,
        apiProtocol: "chat_completions",
        compatibilityRouteEnabled: true,
        compatibilityRouteBaseUrl: localBaseUrl,
        compatibilityRouteToken: localRouteToken,
        compatibilityRouteProviderId: undefined,
      });
    });
  };
}

async function applyEnvironmentRouteToActiveTarget(
  runtime: Awaited<ReturnType<typeof loadCoreRuntime>>,
  state: Awaited<ReturnType<Awaited<ReturnType<typeof loadCoreRuntime>>["readLegacyState"]>>,
  envName: string,
  accountName: string,
): Promise<void> {
  const target = (["cli", "app"] as const).find((candidate) => (
    state.targets[candidate].env === envName && state.targets[candidate].account === accountName
  ));
  if (!target) return;

  const env = state.envs[envName];
  if (!env) throw new Error(`Environment '${envName}' not found`);
  const gatewayBaseUrl = await resolveEnvironmentGatewayBaseUrl(envName);
  const before = await readEnvFileSnapshot(env.path);
  try {
    await runtime.applyTargetHomeState({
      state,
      target,
      authProjection: resolveTargetHomeAuthProjection(state, target),
      ...(gatewayBaseUrl ? { gatewayBaseUrl } : {}),
    });
  } catch (error) {
    await restoreEnvFileSnapshot(env.path, before);
    throw error;
  }
  const after = await readEnvFileSnapshot(env.path);
  await recordEnvFileDiffHistory(
    envName,
    before,
    after,
    target === "cli" ? "switch-cli" : "switch-app",
  );
}

async function syncEnvironmentRouteIfEnabled(envName: string): Promise<void> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const activeGateway = (await getUsageRouterManager().listPersistedEnvironmentGateways())
    .find((gateway) => gateway.envName === envName && gateway.enabled);
  if (activeGateway) {
    // A gateway owns the environment's routes. Do not fall through to the
    // account-route synchronizer, which would replace the gateway ingress
    // with the selected account's direct /routes URL.
    await resynchronizeActiveEnvironmentGateways(runtime, state, envName);
    return;
  }
  const pool = (await getUsageRouterManager().listPersistedAccountPools()).find((item) => item.envName === envName && item.enabled);
  if (pool) {
    const accountMap = new Map(Object.entries(state.envs[envName]?.accounts ?? {}));
    const poolAccounts = getEnvironmentRouteAccounts(state, envName)
      .filter((account) => pool.members.some((member) => member.accountName === account.accountName && accountMap.has(account.accountName)))
      .map((account) => {
        const member = pool.members.find((item) => item.accountName === account.accountName);
        return member ? { ...account, baseUrl: member.originalBaseUrl } : account;
      });
    if (!poolAccounts.length) {
      await getUsageRouterManager().removeAccountPoolConfiguration(envName);
      return;
    }
    await getUsageRouterManager().enableAccountPool({ envName, protocol: pool.protocol,
      accountNames: poolAccounts.map((account) => account.accountName),
      weights: Object.fromEntries(pool.members.filter((member) => poolAccounts.some((account) => account.accountName === member.accountName)).map((member) => [member.accountName, member.weight])),
      sessionTtlMinutes: pool.sessionTtlMinutes, maxFailoverAttempts: pool.maxFailoverAttempts,
      maxSameAccountFailures: pool.maxSameAccountFailures,
    }, poolAccounts, createAccountPoolRuntimeUpdater(runtime, envName, pool.protocol));
    return;
  }
  await getUsageRouterManager().syncEnvironmentIfEnabled(
    envName,
    getEnvironmentRouteAccounts(state, envName),
    createEnvironmentRouteBaseUrlUpdater(runtime, envName),
  );
}

async function synchronizeEnabledEnvironmentRoutes(): Promise<void> {
  const routes = await getUsageRouterManager().listRoutesIfRunning().catch(() => []);
  const envNames = Array.from(new Set(
    routes
      .filter((route) => route.enabled && route.protocol === "responses")
      .map((route) => route.envName),
  ));
  for (const envName of envNames) {
    await syncEnvironmentRouteIfEnabled(envName).catch(() => undefined);
  }
}

async function restoreEnabledRoutes(): Promise<void> {
  const manager = getUsageRouterManager();
  const routes = (await manager.listPersistedRoutes()).filter((route) => route.enabled);
  const pools = (await manager.listPersistedAccountPools()).filter((pool) => pool.enabled);
  const gateways = (await manager.listPersistedEnvironmentGateways()).filter((gateway) => gateway.enabled);
  if (!routes.length && !pools.length && !gateways.length) return;

  const runtime = await loadCoreRuntime();
  let initialState = await runtime.readLegacyState(getLegacyOptions());
  const runningAppEnvironments = await findRunningManagedAppEnvironments(initialState);
  const gatewayEnvironments = new Set(gateways.map((gateway) => gateway.envName));
  for (const pool of pools) {
    if (!initialState.envs[pool.envName]) {
      await manager.removeAccountPoolConfiguration(pool.envName).catch(() => undefined);
      continue;
    }
    const poolMembers = new Map(pool.members.map((member) => [member.accountName, member]));
    const poolAccounts = getEnvironmentRouteAccounts(initialState, pool.envName).map((account) => {
      const member = poolMembers.get(account.accountName);
      return member ? { ...account, baseUrl: member.originalBaseUrl } : account;
    });
    await manager.enableAccountPool({ envName: pool.envName, protocol: pool.protocol,
      accountNames: pool.members.map((member) => member.accountName),
      weights: Object.fromEntries(pool.members.map((member) => [member.accountName, member.weight])),
      sessionTtlMinutes: pool.sessionTtlMinutes, maxFailoverAttempts: pool.maxFailoverAttempts,
      maxSameAccountFailures: pool.maxSameAccountFailures,
    }, poolAccounts, createAccountPoolRuntimeUpdater(runtime, pool.envName, pool.protocol, {
      applyTargetHome: !runningAppEnvironments.has(pool.envName),
    }));
  }
  const responseEnvNames = Array.from(new Set(
    routes
      .filter((route) => route.protocol === "responses" && !gatewayEnvironments.has(route.envName))
      .map((route) => route.envName),
  ));
  for (const envName of responseEnvNames) {
    if (!initialState.envs[envName]) {
      await manager.removeEnvironmentRoutes(envName);
      continue;
    }
    await manager.enableEnvironment(
      envName,
      getEnvironmentRouteAccounts(initialState, envName),
      createEnvironmentRouteBaseUrlUpdater(runtime, envName, {
        applyTargetHome: !runningAppEnvironments.has(envName),
      }),
    );
  }

  for (const route of routes.filter((item) => item.protocol === "chat_completions")) {
    const latestState = await runtime.readLegacyState(getLegacyOptions());
    const account = latestState.envs[route.envName]?.accounts[route.accountName];
    if (!account) {
      await manager.removeAccountRoutes(route.envName, route.accountName);
      continue;
    }
    const apiKey = readAuthStringField(account.authData, "OPENAI_API_KEY");
    if (!apiKey) throw new Error(`Compatibility route for '${route.envName}/${route.accountName}' has no API key`);
    await manager.enableAccountCompatibility({
      envName: route.envName,
      accountName: route.accountName,
      authMode: account.authMode,
      providerId: account.runtime.providerId ?? route.providerId,
      baseUrl: route.originalBaseUrl || account.runtime.openaiBaseUrl || "default",
      apiKey,
      upstreamModel: account.runtime.compatibilityUpstreamModel?.trim() || route.upstreamModel,
      reasoningProfile: account.runtime.compatibilityReasoningProfile ?? route.reasoningProfile,
      longConversationStrategy: account.runtime.compatibilityLongConversationStrategy ?? route.longConversationStrategy,
      instructionRole: account.runtime.compatibilityInstructionRole ?? route.instructionRole,
      requestOverrides: account.runtime.compatibilityRequestOverrides ?? route.requestOverrides,
      proxyUrl: route.proxyUrl,
    }, async ({ baseUrl, localRouteToken }) => {
      await writeCompatibilityRuntime(runtime, route.envName, route.accountName, {
        ...account.runtime,
        apiProtocol: "chat_completions",
        compatibilityRouteEnabled: true,
        compatibilityRouteBaseUrl: baseUrl,
        compatibilityRouteToken: localRouteToken,
        compatibilityRouteProviderId: undefined,
      });
    });
  }

  for (const persistedGateway of gateways) {
    const environment = initialState.envs[persistedGateway.envName];
    if (!environment) {
      await manager.disableEnvironmentGateway(persistedGateway.envName, async () => undefined).catch(() => undefined);
      continue;
    }
    const generated = await buildEnvironmentGatewayState(runtime, environment);
    const gateway: GatewayEnvironmentState = {
      ...generated,
      mode: "gateway",
      gatewayId: persistedGateway.gatewayId ?? generated.gatewayId,
      // Restoring the same compiled gateway must not manufacture a new
      // catalog version. A synthetic increment makes every startup look like
      // a model change and can wake Codex App's config watcher repeatedly.
      catalogVersion: generated.catalogVersion,
    };
    await runtime.writeLegacyGateway({ stateDir: getStateDir(), envName: environment.name, gateway });
    initialState = await runtime.readLegacyState(getLegacyOptions());
    const accounts = await getEnvironmentGatewayRouteAccounts(initialState, environment.name, gateway);
    const updateTargetHome = !runningAppEnvironments.has(environment.name);
    const updateBaseUrl = createEnvironmentRouteBaseUrlUpdater(runtime, environment.name, {
      applyTargetHome: updateTargetHome,
    });
    await manager.enableEnvironmentGateway(
      environment.name,
      accounts,
      updateBaseUrl,
      gateway.routeGroups,
      buildGatewayRouteBindings(initialState.envs[environment.name]!, gateway),
      gateway.routeRules ?? [],
      gateway.defaultRouteGroupId,
    );
    if (updateTargetHome) {
      const bundledCatalog = await loadBundledCatalogForCurrentInstall();
      await synchronizeEnvironmentGatewayModelCatalog({
        homePath: environment.path,
        gateway,
        modelCatalog: await getModelCatalogStore().load(),
        environmentName: environment.name,
        diagnosticLogPath: resolveLogPath("switcher"),
        loadBundledCatalog: bundledCatalog ? async () => bundledCatalog : undefined,
      });
      // Reapply the target home after restoring the gateway. This also
      // migrates an older config.toml that still declared OPENAI_API_KEY for
      // a managed authMethods=["none"] provider.
      await reapplyEnvironmentTargetHomes(runtime, initialState, environment.name, "restore");
    }
  }
}

async function findRunningManagedAppEnvironments(
  state: Awaited<ReturnType<Awaited<ReturnType<typeof loadCoreRuntime>>["readLegacyState"]>>,
): Promise<ReadonlySet<string>> {
  const support = await loadCoreSupportModules();
  const paths = support.resolveManagedAppStatePaths(getStateDir());
  const entries = await Promise.all(Object.keys(state.envs).map(async (envName) => {
    const count = await support.reconcileManagedAppInstanceCount(paths, envName).catch(() => 0);
    return (count ?? 0) > 0 ? envName : undefined;
  }));
  return new Set(entries.filter((envName): envName is string => Boolean(envName)));
}

export async function toggleEnvironmentRoute(envName: string, enabled: boolean) {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const accounts = getEnvironmentRouteAccounts(state, envName);
  const updateBaseUrl = createEnvironmentRouteBaseUrlUpdater(runtime, envName);
  return enabled
    ? getUsageRouterManager().enableEnvironment(envName, accounts, updateBaseUrl)
    : getUsageRouterManager().disableEnvironment(envName, updateBaseUrl);
}

export async function toggleEnvironmentGateway(envName: string, enabled: boolean) {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const env = state.envs[envName];
  if (!env) throw new Error(`Environment '${envName}' not found`);
  const generated = await buildEnvironmentGatewayState(runtime, env);
  const accounts = await getEnvironmentGatewayRouteAccounts(state, envName, generated);
  const updateBaseUrl = createEnvironmentRouteBaseUrlUpdater(runtime, envName);
  const manager = getUsageRouterManager();

  if (!enabled) {
    const result = await manager.disableEnvironmentGateway(envName, updateBaseUrl);
    await runtime.clearLegacyGateway({ stateDir: getStateDir(), envName });
    const nextState = await runtime.readLegacyState(getLegacyOptions());
    await reapplyEnvironmentTargetHomes(runtime, nextState, envName, "disable-environment-gateway");
    return result;
  }

  const result = await manager.enableEnvironmentGateway(
    envName,
    accounts,
    updateBaseUrl,
    generated.routeGroups,
    buildGatewayRouteBindings(env, generated),
    generated.routeRules ?? [],
    generated.defaultRouteGroupId,
  );
  const gateway = {
    ...generated,
    mode: "gateway" as const,
    gatewayId: result.gatewayId ?? generated.gatewayId,
    catalogVersion: generated.catalogVersion + 1,
  };
  try {
    await runtime.writeLegacyGateway({ stateDir: getStateDir(), envName, gateway });
    const nextState = await runtime.readLegacyState(getLegacyOptions());
    await reapplyEnvironmentTargetHomes(runtime, nextState, envName, "enable-environment-gateway");
    await reapplyConnectedClaudeCodeForEnvironment(envName);
    return result;
  } catch (error) {
    await manager.disableEnvironmentGateway(envName, updateBaseUrl).catch(() => undefined);
    await runtime.clearLegacyGateway({ stateDir: getStateDir(), envName }).catch(() => undefined);
    throw error;
  }
}

async function buildEnvironmentGatewayState(
  runtime: Awaited<ReturnType<typeof loadCoreRuntime>>,
  environment: Awaited<ReturnType<Awaited<ReturnType<typeof loadCoreRuntime>>["readLegacyState"]>>["envs"][string],
  snapshotOverride?: ModelCatalogSnapshot,
): Promise<GatewayEnvironmentState> {
  const snapshot = snapshotOverride ?? await getModelCatalogStore().load();
  const accountProviderMetadata = await collectGatewayAccountProviderMetadata(
    environment,
    snapshot,
  );
  const base = synchronizeGatewayAccountMetadata(
    environment,
    environment.gateway ?? runtime.buildLegacyGatewayEnvironmentState(environment),
    { rebindRoutes: true, accountProviderMetadata },
  );
  const bundledModels = await loadGatewayBundledModels(environment, snapshot);
  return applyModelCatalogBindings(environment, base, snapshot, bundledModels);
}

/**
 * Recover upstream identity for accounts whose runtime has been rewritten to
 * a local Gateway URL.  Discovery snapshots provide a stable provider id;
 * persisted route records provide the authoritative endpoint for old gateway
 * documents that were compiled before provider identity was introduced.
 */
async function collectGatewayAccountProviderMetadata(
  environment: { name: string; accounts: Record<string, unknown> },
  snapshot: ModelCatalogSnapshot,
): Promise<Record<string, { providerId?: string; upstreamBaseUrl?: string }>> {
  const metadata: Record<string, { providerId?: string; upstreamBaseUrl?: string }> = {};
  for (const accountName of Object.keys(environment.accounts)) {
    const discovery = snapshot.accountModelDiscoveries?.[accountModelBindingKey(environment.name, accountName)];
    if (discovery?.providerId) {
      metadata[accountName] = {
        providerId: discovery.providerId,
        ...(deriveCustomProviderBaseUrl(discovery.providerId)
          ? { upstreamBaseUrl: deriveCustomProviderBaseUrl(discovery.providerId) }
          : {}),
      };
    }
  }

  const routes = await getUsageRouterManager().listPersistedRoutes().catch(() => []);
  for (const route of routes) {
    if (route.envName !== environment.name || !route.enabled) continue;
    const current = metadata[route.accountName] ?? {};
    // Prefer a direct account route over a model-specific materialized route;
    // either is valid when the former does not exist (legacy gateway state).
    const isDirect = !route.exposedModelId;
    // A legacy route may carry the generic api.openai.com endpoint even
    // though discovery has already identified a custom upstream. Preserve the
    // discovered endpoint in that case; a route is allowed to replace it only
    // when it carries the same provider identity.
    const sameProvider = Boolean(current.providerId && route.providerId && current.providerId === route.providerId);
    if (current.upstreamBaseUrl && (!isDirect || !sameProvider)) continue;
    metadata[route.accountName] = {
      ...current,
      ...(route.providerId ? { providerId: current.providerId ?? route.providerId } : {}),
      ...(route.upstreamBaseUrl ? { upstreamBaseUrl: route.upstreamBaseUrl } : {}),
    };
  }
  return metadata;
}

/**
 * Provider ids for OpenAI-compatible origins include the normalized host. A
 * provider id is intentionally safe to persist in model catalogs, so it does
 * not retain credentials or query strings. Recover the conventional `/v1`
 * endpoint as a migration fallback when an old route lost its upstream URL.
 * New route records still win when they contain a non-local endpoint.
 */
function deriveCustomProviderBaseUrl(providerId: string): string | undefined {
  const match = providerId.trim().match(/^custom-openai:([^:]+)$/i);
  if (!match?.[1] || !/^[A-Za-z0-9.-]+(?:-\d+)?$/.test(match[1])) return undefined;
  const port = match[1].match(/^(.*)-(\d{2,5})$/);
  const host = port?.[1] || match[1];
  return `https://${host}${port?.[2] ? `:${port[2]}` : ""}/v1`;
}

/**
 * Finds the materialized route for a catalog model preview.
 *
 * In account identity mode the exposed id is the catalog slug. In unified
 * mode the same binding is exposed as its upstream model id, so matching only
 * the slug produces a false 422 even though the gateway route is valid.
 * Prefer the strongest identity match and fall back to the account/upstream
 * pair for legacy route records that do not retain the logical model id.
 */
function selectGatewayRouteBindingForModel(
  bindings: readonly GatewayRouteBinding[],
  accountName: string,
  modelSlug: string,
  upstreamModel: string,
  providerId?: string,
): GatewayRouteBinding | undefined {
  const normalizedAccount = accountName.trim();
  const normalizedSlug = modelSlug.trim();
  const normalizedUpstream = upstreamModel.trim();
  if (!normalizedAccount || !normalizedUpstream) return undefined;
  const exposedIds = new Set([normalizedSlug, normalizedUpstream].filter(Boolean));
  const accountAndUpstream = (binding: GatewayRouteBinding): boolean => (
    binding.accountNames.includes(normalizedAccount)
      && binding.upstreamModel.trim() === normalizedUpstream
  );
  const providerAndIdentity = bindings.find((binding) => (
    accountAndUpstream(binding)
      && (!providerId || binding.providerId === providerId)
      && exposedIds.has(binding.exposedModelId.trim())
  ));
  if (providerAndIdentity) return providerAndIdentity;
  const identity = bindings.find((binding) => accountAndUpstream(binding) && exposedIds.has(binding.exposedModelId.trim()));
  if (identity) return identity;
  return bindings.find(accountAndUpstream);
}

async function buildModelRequestPreview(
  input: { envName: string; accountName: string; model: string; modelId?: string; prompt?: string },
): Promise<Parameters<UsageRouterManager["testModelRequestPreview"]>[0] | undefined> {
  // A preview is only meaningful when the environment is currently using the
  // Gateway ingress. Direct account routing must keep using the direct test
  // path so the button reflects the same runtime mode as the saved config.
  if (!input.modelId) return undefined;
  const activeGateways = await getUsageRouterManager().listPersistedEnvironmentGateways().catch(() => []);
  if (!activeGateways.some((gateway) => gateway.envName === input.envName && gateway.enabled)) return undefined;

  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const environment = state.envs[input.envName];
  const account = environment?.accounts[input.accountName];
  if (!environment || !account) throw new Error(`Account '${input.envName}/${input.accountName}' is not available`);

  const catalog = await getModelCatalogStore().load();
  const sourceModel = catalog.models.find((model) => model.id === input.modelId);
  if (!sourceModel) throw new Error(`Model '${input.modelId}' is not present in the catalog`);

  const accountKey = accountModelBindingKey(input.envName, input.accountName);
  const catalogIdentity = resolveCatalogProviderIdentity(environment, input.accountName, account);
  const protocol = account.authMode === "auth" ? "responses" as const : account.runtime.apiProtocol ?? "responses" as const;
  const projected = projectAccountBindingsFromCatalog(structuredClone(catalog), {
    accountKey,
    modelIds: [sourceModel.id],
    providerId: catalogIdentity.providerId,
    ...(catalogIdentity.providerDisplayName ? { providerDisplayName: catalogIdentity.providerDisplayName } : {}),
    protocol,
    preserveHistoricalBindings: true,
  });
  const targetModelId = projected.accountBindings[accountKey]?.[0];
  const targetModel = targetModelId ? projected.models.find((model) => model.id === targetModelId) : undefined;
  if (!targetModel) throw new Error(`Model '${input.model}' could not be bound to account '${input.envName}/${input.accountName}'`);

  const gateway = await buildEnvironmentGatewayState(runtime, environment, projected);
  const targetBinding = resolveModelBinding(projected, targetModel, accountKey);
  const binding = selectGatewayRouteBindingForModel(
    buildGatewayRouteBindings(environment, gateway),
    input.accountName,
    targetModel.entry.slug,
    targetBinding.upstreamModelId,
    catalogIdentity.providerId,
  );
  if (!binding) throw new Error(`Gateway route for '${targetModel.entry.slug}' is not compatible with account '${input.envName}/${input.accountName}'`);

  const routes = await getUsageRouterManager().listPersistedRoutes().catch(() => []);
  const accountRoutes = routes.filter((route) => (
    route.envName === input.envName
      && route.accountName === input.accountName
      && route.enabled
  ));
  // Older gateway states may contain only materialized model routes. Reuse
  // the selected account's matching model route as the upstream source in
  // that case; the saved gateway compiler treats both records as equivalent
  // sources for the provider endpoint and credential.
  const baseRoute = accountRoutes.find((route) => (
    route.exposedModelId === binding.exposedModelId
      && route.upstreamModel === binding.upstreamModel
  ))
    ?? accountRoutes.find((route) => !route.exposedModelId)
    ?? accountRoutes[0];
  if (!baseRoute) throw new Error(`Gateway route for account '${input.envName}/${input.accountName}' is missing`);

  const routeProtocol = binding.upstreamProtocolByAccount?.[input.accountName]
    ?? binding.protocolByAccount?.[input.accountName]
    ?? baseRoute.protocol;
  const now = Date.now();
  const route: RouteTarget = {
    routeId: `preview-route-${randomUUID()}`,
    envName: input.envName,
    accountName: input.accountName,
    upstreamBaseUrl: baseRoute.upstreamBaseUrl,
    originalBaseUrl: baseRoute.originalBaseUrl,
    protocol: routeProtocol,
    providerId: binding.providerId,
    exposedModelId: binding.exposedModelId,
    routeGroupId: binding.routeGroupId,
    upstreamModel: binding.upstreamModel,
    capabilities: binding.capabilities,
    capabilityProfile: binding.capabilityProfile,
    reasoningProfile: baseRoute.reasoningProfile,
    longConversationStrategy: baseRoute.longConversationStrategy,
    instructionRole: baseRoute.instructionRole,
    requestOverrides: baseRoute.requestOverrides,
    requestHeaders: binding.requestHeadersByAccount?.[input.accountName] ?? baseRoute.requestHeaders,
    proxyUrl: binding.proxyUrlByAccount?.[input.accountName] ?? baseRoute.proxyUrl,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
  const accountRoute = getEnvironmentRouteAccounts(state, input.envName, gateway)
    .find((candidate) => candidate.accountName === input.accountName);
  if (!accountRoute) throw new Error(`Gateway credential for account '${input.envName}/${input.accountName}' is missing`);
  return {
    envName: input.envName,
    accountName: input.accountName,
    // Unified Gateway mode exposes the upstream/logical model id while the
    // catalog keeps the provider-qualified slug. Preview requests must use
    // the route's actual exposed identity or the local Gateway returns a
    // misleading MODEL_NOT_FOUND before reaching the provider.
    model: resolvePreviewModelId(binding.exposedModelId, targetModel.entry.slug),
    prompt: input.prompt,
    route,
    upstreamApiKey: accountRoute.apiKey,
    authMode: accountRoute.providerAuthMethod === "none" ? "none" : accountRoute.authMode === "auth" ? "auth" : "apikey",
    accountId: accountRoute.authAccountId,
    hydrateRouteSecret: accountRoute.providerAuthMethod === "none" || Boolean(accountRoute.apiKey?.trim()),
  };
}

function resolvePreviewModelId(exposedModelId: string | undefined, catalogSlug: string): string {
  return exposedModelId?.trim() || catalogSlug.trim();
}

/**
 * Load the union of the standalone CLI and Codex App bundled catalogs.
 *
 * The App Server is launched from the App's embedded CodexCLI binary, which
 * can be newer than the standalone `codex` on PATH.  A gateway catalog built
 * from PATH alone would therefore omit App-only official models.  Prefer the
 * App catalog when both binaries contain the same slug, then add CLI-only
 * entries for compatibility with the shared environment home.
 */
async function loadBundledCatalogForCurrentInstall(): Promise<BundledModelCatalog | undefined> {
  if (!bundledCatalogPromise) {
    bundledCatalogPromise = loadBundledCatalogForCurrentInstallUncached();
  }
  return bundledCatalogPromise;
}

async function loadBundledCatalogForCurrentInstallUncached(): Promise<BundledModelCatalog | undefined> {
  const statuses = await listCodexToolStatuses(getCodexToolPathOptions());
  const cliStatus = statuses.find((status) => status.kind === "cli");
  const appStatus = statuses.find((status) => status.kind === "app");
  const appBundledCandidates = appStatus?.available
    ? resolveCodexAppBundledCliCandidates(appStatus.path)
    : [];
  const candidates = [
    ...appBundledCandidates,
    // On Windows the detected app path can itself be a usable CLI shim. On
    // macOS, however, the app path is a GUI executable; invoking it with
    // `debug models --bundled` can block startup while Codex opens a window.
    ...(appStatus?.available && appBundledCandidates.length === 0 ? [appStatus.path] : []),
    ...(cliStatus?.available ? [cliStatus.path] : []),
  ];
  const catalogs: BundledModelCatalog[] = [];
  for (const path of [...new Set(candidates.filter(Boolean))]) {
    try {
      catalogs.push(await loadBundledModelCatalog(path));
    } catch {
      // A missing embedded CLI, a GUI executable, or a stale standalone CLI
      // must not prevent another valid catalog source from being used.
    }
  }
  return catalogs.length ? mergeBundledModelCatalogs(...catalogs) : undefined;
}

async function loadGatewayBundledModels(
  environment: { name: string; path: string },
  snapshot: ModelCatalogSnapshot,
): Promise<ModelCatalogEntry[]> {
  const bundled = await loadBundledCatalogForCurrentInstall();
  if (bundled) {
    return bundled.models;
  }

  try {
    const catalogPath = join(environment.path, "home", "model-catalogs", "codex-switcher-gateway-models.json");
    const parsed = JSON.parse(await readFile(catalogPath, "utf8")) as unknown;
    const rawModels = isRecord(parsed) && Array.isArray(parsed.models) ? parsed.models : [];
    const customSlugs = new Set(snapshot.models.map((model) => model.entry.slug));
    return rawModels
      .filter(isRecord)
      .filter((model) => typeof model.slug === "string" && !customSlugs.has(model.slug))
      .map((model) => normalizeCustomModelInput(model));
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function reapplyEnvironmentTargetHomes(
  runtime: CoreRuntime,
  state: Awaited<ReturnType<CoreRuntime["readLegacyState"]>>,
  envName: string,
  source: EnvFileHistorySource,
): Promise<void> {
  for (const target of ["cli", "app"] as const) {
    if (state.targets[target].env !== envName) continue;
    await applyTargetHomeStateWithHistory(runtime, state, target, source);
  }
}

export async function toggleEnvironmentLocalAgentAccess(envName: string, enabled: boolean) {
  const result = await getUsageRouterManager().setEnvironmentLocalAgentAccess(envName, enabled);
  if (enabled) await reapplyConnectedClaudeCodeForEnvironment(envName);
  return result;
}

const CLAUDE_CODE_BINDING_ID = "global";

/**
 * A gateway restart can rotate its local URL/token. Keep a connected global
 * Claude profile aligned when the environment is brought back, while leaving
 * a disabled source untouched so the user can choose a different profile.
 */
async function reapplyConnectedClaudeCodeForEnvironment(envName: string): Promise<void> {
  const record = await readClaudeCodeConnection(getStateDir());
  if (!record || record.kind !== "environment_gateway" || record.environmentName !== envName) return;
  await reapplyClaudeCode().catch(() => undefined);
}

export async function inspectClaudeCodeAuthorization(): Promise<ClaudeCodeAuthorizationInspection> {
  const environment = { ...process.env };
  const homeDir = homedir();
  const settingsPath = resolveClaudeCodeSettingsPath(homeDir, environment);
  const credentialsPath = resolveClaudeCodeCredentialsPath(homeDir, environment);
  return inspectClaudeCodeAuthorizationContent({
    homeDir,
    environment,
    processEnvironment: environment,
    settingsContent: await readOptionalClaudeCodeFile(settingsPath),
    credentialsContent: await readOptionalClaudeCodeFile(credentialsPath),
  });
}

async function cleanupClaudeCodeAuthorizationConflicts(inspection: ClaudeCodeAuthorizationInspection): Promise<void> {
  if (!inspection.hasConflict) return;
  if (!inspection.canCleanup) {
    const sources = inspection.conflicts.filter((conflict) => !conflict.removable).map((conflict) => conflict.description).join(" ");
    throw new Error(`${sources || "Claude Code inherits an external authorization source from the current shell."} Unset it there before connecting in API-key mode.`);
  }
  const stateDir = getStateDir();
  const settingsConflict = inspection.conflicts.some((conflict) => conflict.source === "settings" && conflict.removable);
  if (settingsConflict) {
    const content = await readOptionalClaudeCodeFile(inspection.settingsPath);
    if (content) {
      await appendClaudeCodeConfigHistoryEntry({ stateDir, configPath: inspection.settingsPath, source: "authorization_cleanup", content });
      await writeClaudeCodeConfig(inspection.settingsPath, stripClaudeCodeAuthorizationSettings(content));
    }
  }
  const oauthConflict = inspection.conflicts.some((conflict) => conflict.kind === "claude_ai_oauth");
  if (oauthConflict) {
    const content = await readOptionalClaudeCodeFile(inspection.credentialsPath);
    if (content) {
      await appendClaudeCodeConfigHistoryEntry({ stateDir, configPath: inspection.credentialsPath, source: "authorization_cleanup", content });
      const next = stripClaudeAiOauthCredentials(content);
      if (next) await writeClaudeCodeConfig(inspection.credentialsPath, next);
      else await rm(inspection.credentialsPath, { force: true });
    }
  }
}

/**
 * Resolves the existing Environment and Account records that Claude Code can
 * consume. The renderer receives metadata only; credential material stays in
 * the Electron process and is used only while applying the global binding.
 */
export async function listClaudeCodeSources(): Promise<ClaudeCodeSourceSummary[]> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const envNames = Object.keys(state.envs).sort();
  const statuses = await getUsageRouterManager().getEnvironmentStatuses(envNames);
  const previews = await getEnvironmentRoutePreviews();
  const sources: ClaudeCodeSourceSummary[] = [];

  for (const environment of Object.values(state.envs).sort((left, right) => left.name.localeCompare(right.name))) {
    const status = statuses.find((item) => item.envName === environment.name);
    const preview = previews.find((item) => item.envName === environment.name);
    const gatewayEnabled = status?.gatewayEnabled === true;
    const localAgentAccessEnabled = status?.localAgentAccessEnabled === true;
    const models = (preview?.models ?? []).map((model): ClaudeCodeModelOption => ({ id: model.exposedModelId, displayName: model.displayName }));
    const sourceState = !gatewayEnabled
      ? "needs_gateway" as const
      : !localAgentAccessEnabled
        ? "needs_local_agent" as const
        : status?.localAgentBaseUrl && status.localAgentAccessToken
          ? "ready" as const
          : "unavailable" as const;
    sources.push({
      id: claudeCodeEnvironmentSourceId(environment.name),
      kind: "environment_gateway",
      environmentName: environment.name,
      displayName: `${environment.name} · 环境网关`,
      state: sourceState,
      ...(sourceState === "needs_gateway" ? { reason: "环境网关未开启" } : {}),
      ...(sourceState === "needs_local_agent" ? { reason: "本机 Agent 接入未开启" } : {}),
      ...(status?.localAgentBaseUrl ? { baseUrl: status.localAgentBaseUrl } : {}),
      ...(status?.localAgentAccessToken ? { apiKeyPreview: maskClaudeCodeSecret(status.localAgentAccessToken) } : {}),
      models,
      gatewayEnabled,
      localAgentAccessEnabled,
    });

    let gateway: GatewayEnvironmentState;
    try {
      gateway = await buildEnvironmentGatewayState(runtime, environment);
    } catch {
      continue;
    }
    for (const [accountName, account] of Object.entries(environment.accounts)) {
      const source = resolveClaudeCodeAccountSource(environment.name, accountName, account, gateway);
      if (source) sources.push(source);
    }
  }
  return sources;
}

export async function getClaudeCodeConnection(): Promise<ClaudeCodeConnectionState> {
  const record = await readClaudeCodeConnection(getStateDir());
  const configPath = resolveClaudeCodeSettingsPath(homedir());
  const authorization = await inspectClaudeCodeAuthorization();
  if (!record) return { connected: false, configPath, authorization };
  const sources = await listClaudeCodeSources();
  const source = sources.find((item) => item.id === record.sourceId);
  const configPathChanged = claudeCodeConfigPathChanged(record.configPath, configPath);
  const adapter = await createClaudeCodeAgentAdapter(isAbsolute(record.configPath) ? record.configPath : undefined);
  const drift = await adapter.adapter.check(CLAUDE_CODE_BINDING_ID).catch(() => ({ state: "unwired" as const }));
  return {
    connected: Boolean(source) && !configPathChanged,
    configPath,
    authorization,
    ...(configPathChanged ? { configPathChanged: true } : {}),
    ...(source ? { source } : {}),
    record: {
      version: 1,
      sourceId: record.sourceId,
      kind: record.kind,
      environmentName: record.environmentName,
      ...(record.accountName ? { accountName: record.accountName } : {}),
      ...(record.gatewayId ? { gatewayId: record.gatewayId } : {}),
      ...(record.modelId ? { modelId: record.modelId } : {}),
      configPath: record.configPath,
      snapshotBindingId: record.snapshotBindingId,
      connectedAt: record.connectedAt,
    },
    // A source disappearing (for example when its environment gateway is
    // disabled) is a wiring problem even if the file itself still matches the
    // last snapshot. This keeps the UI from reporting a false clean state.
    drift: source && !configPathChanged ? drift.state : "unwired",
    restartRequired: true,
  };
}

export async function connectClaudeCode(input: { sourceId: string; modelId?: string; cleanupAuthorization?: boolean }): Promise<ClaudeCodeConnectionState> {
  const sources = await listClaudeCodeSources();
  const source = sources.find((item) => item.id === input.sourceId);
  if (!source) throw new Error(`Claude Code source '${input.sourceId}' was not found`);
  if (source.state !== "ready") throw new Error(source.reason ?? `Claude Code source '${input.sourceId}' is not ready`);
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const secret = await resolveClaudeCodeSourceSecret(source, state);
  if (!secret) throw new Error(`Claude Code source '${input.sourceId}' has no usable API key`);
  const authorization = await inspectClaudeCodeAuthorization();
  if (authorization.hasConflict && !input.cleanupAuthorization) {
    throw new Error("Claude Code authorization conflict detected; confirm backup and cleanup before connecting in API-key mode.");
  }
  const modelId = input.modelId?.trim() || source.models[0]?.id;
  const status = source.kind === "environment_gateway"
    ? (await getUsageRouterManager().getEnvironmentStatuses([source.environmentName]))[0]
    : undefined;
  const agent = await createClaudeCodeAgentAdapter();
  await ensureClaudeCodeConfigHistorySeeded();
  if (input.cleanupAuthorization) await cleanupClaudeCodeAuthorizationConflicts(authorization);
  const configPath = resolveClaudeCodeSettingsPath(homedir());
  const beforeConfig = await readClaudeCodeConfigContent(configPath);
  const managedValues = shouldDisableClaudeAutoModeServer(source)
    ? { "env.CLAUDE_CODE_AUTO_MODE_SERVER": "0" }
    : undefined;
  if (shouldBackupClaudeCodeConfig(beforeConfig, source.baseUrl ?? "", secret, modelId, managedValues)) {
    await appendClaudeCodeConfigHistoryEntry({
      stateDir: getStateDir(),
      configPath,
      source: "connect",
      content: beforeConfig,
    });
  }
  await agent.adapter.apply({
    bindingId: CLAUDE_CODE_BINDING_ID,
    agentId: agent.profile.id,
    gatewayBaseUrl: source.baseUrl ?? "",
    gatewayTokenRef: secret,
    protocol: "anthropic",
    exposedModelId: modelId ?? "",
    ...(source.kind === "environment_gateway" && status?.gatewayId ? { routeGroupId: status.gatewayId } : {}),
    ...(managedValues ? { managedValues } : {}),
    enabled: true,
    updatedAt: Date.now(),
  });
  const record: ClaudeCodeConnectionRecord = {
    version: 1,
    sourceId: source.id,
    kind: source.kind,
    environmentName: source.environmentName,
    ...(source.accountName ? { accountName: source.accountName } : {}),
    ...(status?.gatewayId ? { gatewayId: status.gatewayId } : {}),
    ...(modelId ? { modelId } : {}),
    configPath,
    snapshotBindingId: CLAUDE_CODE_BINDING_ID,
    connectedAt: Date.now(),
  };
  await writeClaudeCodeConnection(getStateDir(), record);
  return getClaudeCodeConnection();
}

export async function disconnectClaudeCode(): Promise<ClaudeCodeConnectionState> {
  const record = await readClaudeCodeConnection(getStateDir());
  const configPath = record?.configPath && isAbsolute(record.configPath)
    ? record.configPath
    : resolveClaudeCodeSettingsPath(homedir());
  const agent = await createClaudeCodeAgentAdapter(configPath);
  if (record) {
    await appendClaudeCodeConfigHistoryEntry({
      stateDir: getStateDir(),
      configPath,
      source: "disconnect",
      content: await readClaudeCodeConfigContent(configPath),
    });
  }
  await agent.adapter.restore(CLAUDE_CODE_BINDING_ID);
  await clearClaudeCodeConnection(getStateDir());
  return getClaudeCodeConnection();
}

export async function diagnoseClaudeCode(): Promise<ClaudeCodeConnectionState & { sources: ClaudeCodeSourceSummary[] }> {
  return { ...(await getClaudeCodeConnection()), sources: await listClaudeCodeSources() };
}

/** Re-apply the last selected source after a gateway restart or external edit. */
export async function reapplyClaudeCode(): Promise<ClaudeCodeConnectionState> {
  const record = await readClaudeCodeConnection(getStateDir());
  if (!record) throw new Error("Claude Code is not connected");
  return connectClaudeCode({ sourceId: record.sourceId, ...(record.modelId ? { modelId: record.modelId } : {}) });
}

export async function listClaudeCodeConfigHistory(): Promise<string> {
  await ensureClaudeCodeConfigHistorySeeded();
  const entries = await listClaudeCodeConfigHistoryEntries(getStateDir());
  return `${JSON.stringify(entries.map(toClaudeCodeConfigHistoryPreview), null, 2)}\n`;
}

export async function restoreClaudeCodeConfigHistory(entryId: string): Promise<DesktopActionResult> {
  const entries = await listClaudeCodeConfigHistoryEntries(getStateDir());
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) throw new Error(`Claude Code history entry '${entryId}' not found`);

  const activeConfigDir = resolveClaudeCodeConfigDir(homedir());
  const configPath = resolve(entry.configPath);
  if (!isManagedClaudeCodeHistoryPath(configPath, activeConfigDir)) {
    throw new Error(`Claude Code history belongs to ${entry.configPath}; the active CLAUDE_CONFIG_DIR does not match this managed file.`);
  }
  const before = await readClaudeCodeConfigContent(configPath);
  if (before !== entry.content) {
    await appendClaudeCodeConfigHistoryEntry({
      stateDir: getStateDir(),
      configPath,
      source: "restore",
      content: before,
    });
    if (entry.content) await writeClaudeCodeConfig(configPath, entry.content);
    else await rm(configPath, { force: true });
    // A historical file may belong to a previous source or to the pre-connect
    // configuration. Do not leave the UI claiming that the current binding is
    // active after restoring an arbitrary snapshot.
    await clearClaudeCodeConnection(getStateDir());
  }

  return {
    message: "Restored Claude Code configuration",
    output: configPath,
  };
}

function isManagedClaudeCodeHistoryPath(configPath: string, activeConfigDir: string): boolean {
  const root = resolve(activeConfigDir);
  return configPath === resolve(join(root, "settings.json")) || configPath === resolve(join(root, ".credentials.json"));
}

export async function deleteClaudeCodeConfigHistory(entryIds: string[]): Promise<DesktopActionResult> {
  const deleted = await deleteClaudeCodeConfigHistoryEntries(getStateDir(), entryIds);
  return {
    message: `Deleted ${deleted} Claude Code history entries`,
    output: `${deleted}\n`,
  };
}

async function readClaudeCodeConfigContent(configPath: string): Promise<string> {
  try {
    return await readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

async function readOptionalClaudeCodeFile(configPath: string): Promise<string | undefined> {
  try {
    return await readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeClaudeCodeConfig(configPath: string, content: string): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  const temporaryPath = `${configPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
    await chmod(temporaryPath, 0o600).catch(() => undefined);
    await rename(temporaryPath, configPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  await chmod(configPath, 0o600).catch(() => undefined);
}

function shouldBackupClaudeCodeConfig(
  content: string,
  baseUrl: string,
  apiKey: string,
  modelId?: string,
  managedValues?: Readonly<Record<string, string>>,
): boolean {
  if (!content) return true;
  try {
    const parsed = JSON.parse(content) as { env?: Record<string, unknown> };
    const env = parsed.env ?? {};
    if (env.ANTHROPIC_BASE_URL !== baseUrl
      || env.ANTHROPIC_API_KEY !== apiKey
      || (modelId ? env.ANTHROPIC_MODEL !== modelId : false)
      || typeof env.ANTHROPIC_AUTH_TOKEN === "string") return true;
    for (const [path, expected] of Object.entries(managedValues ?? {})) {
      const value = path.split(".").filter(Boolean).reduce<unknown>((current, key) => (
        current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined
      ), parsed);
      if (value !== expected) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function shouldDisableClaudeAutoModeServer(source: ClaudeCodeSourceSummary): boolean {
  if (source.kind === "environment_gateway") return true;
  if (!source.baseUrl) return false;
  try {
    return new URL(source.baseUrl).hostname.toLowerCase() !== "api.anthropic.com";
  } catch {
    // An invalid/custom endpoint will fail the real request later; keep the
    // Claude Code client on the gateway-compatible path instead of enabling
    // an official-only server check by accident.
    return true;
  }
}

async function ensureClaudeCodeConfigHistorySeeded(): Promise<void> {
  const stateDir = getStateDir();
  const existing = await listClaudeCodeConfigHistoryEntries(stateDir);
  if (existing.length) return;

  const snapshotPath = join(stateDir, "claude-code-agent", "agents", "global.json");
  try {
    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as { configPath?: unknown; originalContent?: unknown };
    if (typeof snapshot.originalContent !== "string") return;
    await appendClaudeCodeConfigHistoryEntry({
      stateDir,
      configPath: typeof snapshot.configPath === "string"
        ? resolve(homedir(), snapshot.configPath)
        : resolveClaudeCodeSettingsPath(homedir()),
      source: "migration",
      content: snapshot.originalContent,
    });
  } catch {
    // No legacy Agent snapshot exists yet; the first managed connection will create one.
  }
}

async function createClaudeCodeAgentAdapter(configPathOverride?: string) {
  const runtime = await loadGatewayAgentRuntime();
  const profile = runtime.BUILT_IN_AGENT_PROFILES.find((item) => item.id === "claude");
  if (!profile) throw new Error("Claude Code Agent adapter is unavailable");
  const effectiveConfigPath = configPathOverride && isAbsolute(configPathOverride)
    ? configPathOverride
    : resolveClaudeCodeSettingsPath(homedir());
  const configDir = dirname(effectiveConfigPath);
  const fs = runtime.createNodeAgentFileSystem(configDir, { additionalRoots: [getStateDir()] });
  // The adapter is rooted at the effective Claude config directory, so its
  // relative settings path must be settings.json rather than ~/.claude/... .
  const adapter = runtime.createAgentAdapter({ ...profile, configPath: basename(effectiveConfigPath) }, {
    fs,
    stateDir: join(getStateDir(), "claude-code-agent"),
  });
  return { runtime, profile, adapter };
}

async function resolveClaudeCodeSourceSecret(
  source: ClaudeCodeSourceSummary,
  state: Awaited<ReturnType<Awaited<ReturnType<typeof loadCoreRuntime>>["readLegacyState"]>>,
): Promise<string | undefined> {
  if (source.kind === "environment_gateway") {
    const status = (await getUsageRouterManager().getEnvironmentStatuses([source.environmentName]))[0];
    return status?.localAgentAccessToken?.trim() || undefined;
  }
  const account = source.accountName ? state.envs[source.environmentName]?.accounts[source.accountName] : undefined;
  return account ? extractProviderAccessTokenFromAuthData(account.authData) || undefined : undefined;
}

function resolveClaudeCodeAccountSource(
  environmentName: string,
  accountName: string,
  account: {
    name: string;
    authMode: string;
    authData?: Record<string, unknown>;
    runtime: { providerAuthMethod?: string; model?: string; compatibilityUpstreamModel?: string };
  },
  gateway: GatewayEnvironmentState,
): ClaudeCodeSourceSummary | undefined {
  if (account.authMode !== "apikey" && account.runtime.providerAuthMethod !== "api_key") return undefined;
  const secret = extractProviderAccessTokenFromAuthData(account.authData);
  if (!secret) return undefined;
  const secretRef = createAccountSecretRef(environmentName, accountName);
  const credential = Object.values(gateway.credentials).find((item) => item.secretRef === secretRef && item.status !== "disabled");
  if (!credential || !credential.supportedProtocols.includes("anthropic")) return undefined;
  const provider = gateway.providers[credential.providerId];
  const baseUrl = provider?.endpoints.anthropicMessages;
  if (!provider || !baseUrl || !gatewayProviderSupportsProtocol(provider, "anthropic")) return undefined;
  const models = Object.values(gateway.models)
    .filter((model) => model.enabled && model.providerId === provider.id && model.protocols.includes("anthropic"))
    .map((model): ClaudeCodeModelOption => ({ id: model.upstreamModelId, displayName: model.displayName }));
  const configuredModel = account.runtime.model?.trim() || account.runtime.compatibilityUpstreamModel?.trim();
  const modelOptions = models.length || !configuredModel
    ? models
    : [{ id: configuredModel, displayName: configuredModel }];
  return {
    id: claudeCodeAccountSourceId(environmentName, accountName),
    kind: "account",
    environmentName,
    accountName,
    displayName: `${environmentName} · ${account.name}`,
    providerDisplayName: provider.displayName,
    state: "ready",
    baseUrl,
    apiKeyPreview: maskClaudeCodeSecret(secret),
    models: modelOptions,
  };
}

export async function listAccountPools() {
  return getUsageRouterManager().listAccountPools();
}

export async function saveAccountPool(input: {
  envName: string; enabled: boolean; protocol: "responses" | "chat_completions";
  members: Array<{ accountName: string; enabled?: boolean; weight?: number; priority?: number }>;
  sessionTtlMinutes?: number; maxFailoverAttempts?: number; maxSameAccountFailures?: number;
}) {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const existingPool = (await getUsageRouterManager().listPersistedAccountPools())
    .find((pool) => pool.envName === input.envName);
  const existingMembers = new Map(existingPool?.members.map((member) => [member.accountName, member]) ?? []);
  const existingRoutes = await getUsageRouterManager().listRoutesIfRunning();
  const accounts = getEnvironmentRouteAccounts(state, input.envName).map((account) => {
    const poolMember = existingMembers.get(account.accountName);
    if (poolMember) return { ...account, baseUrl: poolMember.originalBaseUrl };
    const route = existingRoutes.find((item) => item.envName === input.envName && item.accountName === account.accountName);
    return route ? { ...account, baseUrl: route.originalBaseUrl } : account;
  });
  const updateBaseUrl = createAccountPoolRuntimeUpdater(runtime, input.envName, existingPool?.protocol ?? input.protocol);
  if (!input.enabled) {
    await getUsageRouterManager().disableAccountPool(input.envName, updateBaseUrl);
    return null;
  }
  const selectedNames = new Set(input.members.filter((member) => member.enabled !== false).map((member) => member.accountName));
  for (const member of existingPool?.members ?? []) {
    if (!selectedNames.has(member.accountName)) await updateBaseUrl(member.accountName, member.originalBaseUrl);
  }
  return getUsageRouterManager().enableAccountPool({
    envName: input.envName, protocol: input.protocol,
    accountNames: input.members.filter((member) => member.enabled !== false).sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)).map((member) => member.accountName),
    weights: Object.fromEntries(input.members.map((member) => [member.accountName, member.weight ?? 1])),
    sessionTtlMinutes: input.sessionTtlMinutes, maxFailoverAttempts: input.maxFailoverAttempts,
    maxSameAccountFailures: input.maxSameAccountFailures,
  }, accounts, createAccountPoolRuntimeUpdater(runtime, input.envName, input.protocol));
}

export async function loadUsageSnapshot(filter: UsageFilter) {
  return getUsageRouterManager().queryUsage(filter);
}

export async function loadUsageRequests(query: UsageRequestQuery) {
  return getUsageRouterManager().queryUsageRequests(query);
}

export async function loadUsageTrace(query: UsageTraceQuery = {}) {
  return getUsageRouterManager().listTraceEvents(query);
}

export async function loadGatewayAdminSnapshot() {
  const runtime = await loadCoreRuntime();
  const agentRuntime = await loadGatewayAgentRuntime().catch(() => undefined);
  const state = await runtime.readLegacyState(getLegacyOptions());
  const manager = getUsageRouterManager();
  const [routes, gateways, statuses] = await Promise.all([
    manager.listPersistedRoutes(),
    manager.listPersistedEnvironmentGateways(),
    manager.getEnvironmentStatuses(Object.keys(state.envs)),
  ]);
  return Promise.all(Object.values(state.envs).sort((left, right) => left.name.localeCompare(right.name)).map(async (environment) => {
    const gateway = environment.gateway ?? {
      schemaVersion: 1 as const,
      mode: "direct" as const,
      gatewayId: `gateway-${environment.name}`,
      providers: {}, credentials: {}, models: {}, routeGroups: {}, catalogVersion: 0,
    };
    const v2 = await runtime.readLegacyGatewayV2({ stateDir: getStateDir(), envName: environment.name }).catch(() => undefined);
    const liveGateway = gateways.find((item) => item.envName === environment.name && item.enabled);
    const routeStatus = statuses.find((item) => item.envName === environment.name);
    const environmentRoutes = routes.filter((route) => route.envName === environment.name && route.enabled);
    const agents = await Promise.all(Object.values(v2?.agentBindings ?? {}).map(async (item) => {
      const base = { id: item.agentId, displayName: item.displayName, enabled: item.enabled, defaultModelId: item.defaultModelId, defaultRouteGroupId: item.defaultRouteGroupId, reasoningProfile: item.reasoningProfile, fallbackModelId: item.fallbackModelId, subAgentModelId: item.subAgentModelId };
      if (!agentRuntime) return base;
      const profile = agentRuntime.BUILT_IN_AGENT_PROFILES.find((candidate) => candidate.id === item.agentId);
      if (!profile) return { ...base, state: "unwired" as const };
      const fs = agentRuntime.createNodeAgentFileSystem(environment.path, { additionalRoots: [getStateDir()] });
      const adapter = agentRuntime.createAgentAdapter(profile, { fs, stateDir: join(getStateDir(), "gateway-agents", encodeURIComponent(environment.name)) });
      const discovered = await adapter.discover();
      const drift = item.enabled ? await adapter.check(`${environment.name}:${item.agentId}`) : undefined;
      return { ...base, installed: discovered.installed, configPath: discovered.configPath, state: item.enabled ? drift?.state ?? "unwired" : "disabled" as const };
    }));
    return {
      envName: environment.name,
      mode: gateway.mode,
      gatewayId: gateway.gatewayId,
      gatewayEnabled: Boolean(liveGateway),
      localGatewayBaseUrl: routeStatus?.localGatewayBaseUrl,
      providers: Object.values(gateway.providers).map((item) => ({ id: item.id, displayName: item.displayName, kind: item.kind, enabled: item.enabled })),
      credentials: Object.values(gateway.credentials).map((item) => ({ id: item.id, providerId: item.providerId, kind: item.kind, status: item.status })),
      models: Object.values(gateway.models).map((item) => ({ id: item.id, providerId: item.providerId, upstreamModelId: item.upstreamModelId, displayName: item.displayName, enabled: item.enabled })),
      routeGroups: Object.values(gateway.routeGroups).map((item) => ({ id: item.id, displayName: item.displayName, exposedModelId: item.exposedModelId, strategy: item.strategy, sessionPolicy: item.sessionPolicy, fallbackEnabled: item.fallbackEnabled, memberCount: item.members.length })),
      agents,
      routedAccounts: environmentRoutes.length,
      quota: gateway.quota,
    };
  }));
}

export async function loadGatewayAdminConfiguration(envName: string): Promise<GatewayAdminConfiguration | null> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const environment = state.envs[envName];
  if (!environment) return null;
  const gateway = environment.gateway ?? await buildEnvironmentGatewayState(runtime, environment);
  const v2 = await runtime.readLegacyGatewayV2({ stateDir: getStateDir(), envName }).catch(() => undefined);
  return {
    envName,
    revision: v2?.revision ?? 0,
    gateway: stripExcludedGatewayFields(gateway),
    agentBindings: JSON.parse(JSON.stringify(v2?.agentBindings ?? {})) as Record<string, Record<string, unknown>>,
  };
}

export async function discoverGatewayAdminModels(input: { envName: string; providerId: string }) {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const environment = state.envs[input.envName];
  if (!environment) throw new Error(`Environment '${input.envName}' not found`);
  let gateway = environment.gateway ?? await buildEnvironmentGatewayState(runtime, environment);
  const pluginDescriptor = await getProviderPluginDescriptor(getStateDir(), input.providerId);
  if (pluginDescriptor && !gateway.providers[input.providerId]) {
    const endpoints = Object.fromEntries(pluginDescriptor.endpoints.map((endpoint) => [
      endpoint.protocol === "chat_completions" ? "chatCompletions" : endpoint.protocol === "anthropic" ? "anthropicMessages" : endpoint.protocol,
      endpoint.baseUrl,
    ]));
    gateway = {
      ...gateway,
      providers: {
        ...gateway.providers,
        [input.providerId]: {
          id: input.providerId,
          displayName: pluginDescriptor.displayName,
          kind: "custom" as const,
          endpoints,
          modelDiscovery: "plugin" as const,
          enabled: true,
        },
      },
    };
  }
  const result = await discoverGatewayProviderModels({
    environment,
    envName: input.envName,
    gateway,
    providerId: input.providerId,
    stateDir: getStateDir(),
  });
  const nextGateway = {
    ...gateway,
    models: { ...gateway.models, ...Object.fromEntries(result.models.map((model) => [model.id, model])) },
    catalogVersion: gateway.catalogVersion + (result.models.length ? 1 : 0),
  };
  await runtime.writeLegacyGateway({ stateDir: getStateDir(), envName: input.envName, gateway: nextGateway });
  const bundledCatalog = await loadBundledCatalogForCurrentInstall();
  await synchronizeEnvironmentGatewayModelCatalog({
    homePath: environment.path,
    gateway: nextGateway,
    modelCatalog: await getModelCatalogStore().load(),
    environmentName: input.envName,
    diagnosticLogPath: resolveLogPath("switcher"),
    loadBundledCatalog: bundledCatalog ? async () => bundledCatalog : undefined,
  });
  const activeGateway = (await getUsageRouterManager().listPersistedEnvironmentGateways()).find((item) => item.envName === input.envName && item.enabled);
  if (activeGateway) {
    const latestState = await runtime.readLegacyState(getLegacyOptions());
    const accounts = await getEnvironmentGatewayRouteAccounts(latestState, input.envName, nextGateway);
    const updateBaseUrl = createEnvironmentRouteBaseUrlUpdater(runtime, input.envName);
    await getUsageRouterManager().enableEnvironmentGateway(
      input.envName,
      accounts,
      updateBaseUrl,
      Object.fromEntries(Object.values(nextGateway.routeGroups).map((group) => [group.id, group])),
      buildGatewayRouteBindings(environment, nextGateway),
      nextGateway.routeRules ?? [],
      nextGateway.defaultRouteGroupId,
    );
  }
  return {
    envName: input.envName,
    providerId: input.providerId,
    modelIds: result.models.map((model) => model.id),
    credentialsUsed: result.credentialsUsed,
    catalogVersion: nextGateway.catalogVersion,
  };
}

export function loadProviderPluginSnapshot() {
  return listProviderPluginsRuntime(getStateDir());
}

export function loadProviderPluginDiagnostics(pluginId?: string): Promise<ProviderPluginDiagnostic[]> {
  return listProviderPluginDiagnosticsRuntime(getStateDir(), pluginId);
}

export function loadProviderPluginSettings(id: string) {
  return getProviderPluginSettingsRuntime(getStateDir(), id);
}

export function saveProviderPluginSettings(id: string, values: Record<string, unknown>) {
  return setProviderPluginSettingsRuntime(getStateDir(), id, values);
}

export async function resetProviderPluginSettings(id: string) {
  await clearProviderPluginSettingsRuntime(getStateDir(), id);
  return getProviderPluginSettingsRuntime(getStateDir(), id);
}

export function activateProviderPluginById(id: string) {
  return activateProviderPluginRuntime(getStateDir(), id);
}

export function loadProviderPluginMarket() {
  return listProviderPluginMarketRuntime(getStateDir());
}

export function refreshProviderPluginMarket(url: string) {
  return refreshProviderPluginMarketRuntime(getStateDir(), url);
}

export function installProviderPlugin(input: ProviderPluginInstallRequest) {
  return installProviderPluginRuntime(getStateDir(), input);
}

export function installProviderPluginFromMarket(input: ProviderPluginMarketInstallRequest) {
  return installProviderPluginFromMarketRuntime(getStateDir(), input);
}

export function deactivateProviderPluginById(id: string) {
  return deactivateProviderPluginRuntime(getStateDir(), id);
}

export function rollbackProviderPluginById(id: string) {
  return rollbackProviderPluginRuntime(getStateDir(), id);
}

export function removeProviderPluginById(id: string) {
  return removeProviderPluginRuntime(getStateDir(), id);
}

type DesktopAgentBindingRecord = Record<string, unknown>;

async function synchronizeDesktopGatewayAgents(input: {
  envName: string;
  environment: { path: string };
  gateway: GatewayEnvironmentState;
  previousBindings: Record<string, DesktopAgentBindingRecord>;
  nextBindings: Record<string, DesktopAgentBindingRecord>;
}): Promise<void> {
  const agentRuntime = await loadGatewayAgentRuntime();
  const profiles = new Map(agentRuntime.BUILT_IN_AGENT_PROFILES.map((profile) => [profile.id, profile]));
  const stateDir = join(getStateDir(), "gateway-agents", encodeURIComponent(input.envName));
  const fs = agentRuntime.createNodeAgentFileSystem(input.environment.path, { additionalRoots: [getStateDir()] });
  const routeStatus = (await getUsageRouterManager().getEnvironmentStatuses([input.envName]))[0];
  const routerSettings = await readRouterPortSettings(getCodexToolPathOptions().settingsPath);
  const gatewayBaseUrl = routeStatus?.localGatewayBaseUrl
    ?? `http://127.0.0.1:${routerSettings.preferredPort}/gateways/${encodeURIComponent(input.gateway.gatewayId)}`;
  const gatewayTokenRef = `gateway/${encodeURIComponent(input.envName)}`;
  const adapterFor = (agentId: string) => {
    const profile = [...profiles.values()].find((item) => item.id === agentId);
    if (!profile) throw new Error(`Unsupported Gateway Agent '${agentId}'`);
    return { profile, adapter: agentRuntime.createAgentAdapter(profile, { fs, stateDir }) };
  };
  const bindingIdFor = (agentId: string) => `${input.envName}:${agentId}`;
  const modelFor = (binding: DesktopAgentBindingRecord): { modelId: string; routeGroupId?: string; reasoningProfile?: string; fallbackModelId?: string; subAgentModelId?: string } | undefined => {
    const requestedModel = typeof binding.defaultModelId === "string" && binding.defaultModelId.trim() ? binding.defaultModelId.trim() : undefined;
    const requestedGroup = typeof binding.defaultRouteGroupId === "string" && binding.defaultRouteGroupId.trim() ? binding.defaultRouteGroupId.trim() : undefined;
    const group = requestedGroup ? input.gateway.routeGroups[requestedGroup] : input.gateway.defaultRouteGroupId ? input.gateway.routeGroups[input.gateway.defaultRouteGroupId] : undefined;
    const modelId = requestedModel ?? group?.exposedModelId ?? Object.values(input.gateway.models)[0]?.id;
    if (!modelId) return undefined;
    const optionalString = (key: string) => typeof binding[key] === "string" && binding[key].trim() ? binding[key].trim() : undefined;
    return {
      modelId,
      routeGroupId: requestedGroup ?? group?.id,
      ...(optionalString("reasoningProfile") ? { reasoningProfile: optionalString("reasoningProfile") } : {}),
      ...(optionalString("fallbackModelId") ? { fallbackModelId: optionalString("fallbackModelId") } : {}),
      ...(optionalString("subAgentModelId") ? { subAgentModelId: optionalString("subAgentModelId") } : {}),
    };
  };
  const applyBinding = async (binding: DesktopAgentBindingRecord) => {
    const agentId = typeof binding.agentId === "string" && binding.agentId.trim() ? binding.agentId.trim() : "";
    if (!agentId) throw new Error("Gateway Agent binding is missing agentId");
    const { profile, adapter } = adapterFor(agentId);
    const model = modelFor(binding);
    if (!model) throw new Error(`Gateway Agent '${agentId}' needs a model or RouteGroup before it can be connected`);
    await adapter.apply({
      bindingId: bindingIdFor(agentId),
      agentId: profile.id,
      gatewayBaseUrl,
      gatewayTokenRef,
      protocol: profile.defaultProtocol,
      exposedModelId: model.modelId,
      routeGroupId: model.routeGroupId,
      reasoningProfile: model.reasoningProfile,
      fallbackModelId: model.fallbackModelId,
      subAgentModelId: model.subAgentModelId,
      enabled: true,
      updatedAt: Date.now(),
    });
  };
  const restoreBinding = async (binding: DesktopAgentBindingRecord) => {
    const agentId = typeof binding.agentId === "string" && binding.agentId.trim() ? binding.agentId.trim() : "";
    if (!agentId) return;
    const { adapter } = adapterFor(agentId);
    await adapter.restore(bindingIdFor(agentId));
  };

  // Validate every enabled binding before mutating any Agent configuration.
  for (const binding of Object.values(input.nextBindings)) {
    if (binding.enabled !== true) continue;
    const agentId = typeof binding.agentId === "string" ? binding.agentId.trim() : "";
    if (!agentId) throw new Error("Gateway Agent binding is missing agentId");
    adapterFor(agentId);
    if (!modelFor(binding)) throw new Error(`Gateway Agent '${agentId}' needs a model or RouteGroup before it can be connected`);
  }

  const touched = new Set<string>();
  try {
    // Apply new bindings first so a failed new configuration leaves removed
    // bindings untouched until every replacement is known to be writable.
    for (const binding of Object.values(input.nextBindings)) {
      const agentId = typeof binding.agentId === "string" ? binding.agentId.trim() : "";
      if (!agentId) continue;
      touched.add(agentId);
      if (binding.enabled === true) await applyBinding(binding);
      else await restoreBinding(binding);
    }
    for (const binding of Object.values(input.previousBindings)) {
      const agentId = typeof binding.agentId === "string" ? binding.agentId.trim() : "";
      if (!agentId || touched.has(agentId)) continue;
      touched.add(agentId);
      await restoreBinding(binding);
    }
  } catch (error) {
    // Restore the previous explicit bindings when a multi-Agent update fails.
    // Adapter snapshots retain the pre-wire content across repeated applies.
    for (const agentId of touched) {
      const previous = Object.values(input.previousBindings).find((binding) => binding.agentId === agentId);
      try {
        if (previous?.enabled === true && modelFor(previous)) await applyBinding(previous);
        else if (previous) await restoreBinding(previous);
        else await restoreBinding({ agentId });
      } catch {
        // Preserve the original failure; the subsequent Drift check reports
        // any platform-level rollback failure without leaking credentials.
      }
    }
    throw error;
  }
}

export async function saveGatewayAdminConfiguration(input: SaveGatewayAdminConfigurationRequest): Promise<GatewayAdminConfiguration> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const environment = state.envs[input.envName];
  if (!environment) throw new Error(`Environment '${input.envName}' not found`);
  const gateway = applyModelCatalogBindings(
    environment,
    stripExcludedGatewayFields(input.gateway) as unknown as GatewayEnvironmentState,
    await getModelCatalogStore().load(),
  );
  const previousV2 = await runtime.readLegacyGatewayV2({ stateDir: getStateDir(), envName: input.envName }).catch(() => undefined);
  await runtime.writeLegacyGateway({ stateDir: getStateDir(), envName: input.envName, gateway: gateway as unknown as Parameters<CoreRuntime["writeLegacyGateway"]>[0]["gateway"] });
  if (input.agentBindings) {
    const currentV2 = await runtime.readLegacyGatewayV2({ stateDir: getStateDir(), envName: input.envName });
    if (!currentV2) throw new Error(`Gateway v2 configuration for '${input.envName}' could not be created`);
    await runtime.writeLegacyGatewayV2({
      stateDir: getStateDir(),
      envName: input.envName,
      gateway: {
        ...currentV2,
        agentBindings: input.agentBindings,
        revision: currentV2.revision + 1,
        sourceSchemaVersion: 2,
      } as unknown as Parameters<CoreRuntime["writeLegacyGatewayV2"]>[0]["gateway"],
    });
    await synchronizeDesktopGatewayAgents({
      envName: input.envName,
      environment,
      gateway,
      previousBindings: (previousV2?.agentBindings ?? {}) as unknown as Record<string, DesktopAgentBindingRecord>,
      nextBindings: input.agentBindings,
    });
  }
  const latest = await runtime.readLegacyState(getLegacyOptions());
  const accounts = getEnvironmentRouteAccounts(latest, input.envName);
  const updateBaseUrl = createEnvironmentRouteBaseUrlUpdater(runtime, input.envName);
  const activeGateway = (await getUsageRouterManager().listPersistedEnvironmentGateways()).find((item) => item.envName === input.envName && item.enabled);
  if (activeGateway) {
    const gateway = latest.envs[input.envName]?.gateway;
    if (gateway) {
      const gatewayAccounts = await getEnvironmentGatewayRouteAccounts(latest, input.envName, gateway);
      await getUsageRouterManager().enableEnvironmentGateway(
        input.envName,
        gatewayAccounts,
        updateBaseUrl,
        Object.fromEntries(Object.values(gateway.routeGroups).map((group) => [group.id, group])),
        buildGatewayRouteBindings(latest.envs[input.envName]!, gateway),
        gateway.routeRules ?? [],
        gateway.defaultRouteGroupId,
      );
    }
  }
  const saved = await loadGatewayAdminConfiguration(input.envName);
  if (!saved) throw new Error(`Environment '${input.envName}' disappeared while saving gateway configuration`);
  return saved;
}

let autoUpdateController: import("./auto-update.js").DesktopAutoUpdateController | undefined;

export function registerAutoUpdateController(controller: import("./auto-update.js").DesktopAutoUpdateController): void {
  autoUpdateController = controller;
}

export function getAutoUpdateStatus(): DesktopAutoUpdateStatus {
  return autoUpdateController?.getStatus() ?? { enabled: false, state: "disabled", message: "Auto-update is not initialized" };
}

export async function checkForAutoUpdate(): Promise<DesktopAutoUpdateStatus> {
  return autoUpdateController?.check() ?? getAutoUpdateStatus();
}

export function installDownloadedUpdate(): DesktopAutoUpdateStatus {
  if (!autoUpdateController) throw new Error("Auto-update is not initialized");
  return autoUpdateController.install();
}

export async function listUsagePricing() {
  return getUsageRouterManager().listPricing();
}

export async function saveUsagePricing(profile: PricingProfile) {
  return getUsageRouterManager().upsertPricing(profile);
}

interface DesktopOperationsServiceLike {
  deleteAccount(input: { envName: string; accountName: string }): Promise<DesktopActionResult>;
  logoutAccount(input: {
    envName: string;
    accountName: string;
    target: "cli" | "app" | "both";
  }): Promise<DesktopActionResult>;
  getProxyStatus(): Promise<DesktopActionResult>;
  setProxy(input: { value: string }): Promise<DesktopActionResult>;
  restoreProxyAutoDetect(): Promise<DesktopActionResult>;
  disableProxy(): Promise<DesktopActionResult>;
  testProxy(): Promise<DesktopActionResult>;
  getTokenRefreshStatus(): Promise<DesktopActionResult>;
  startTokenRefreshGuard(): Promise<DesktopActionResult>;
  stopTokenRefreshGuard(): Promise<DesktopActionResult>;
  runTokenRefreshOnce(): Promise<DesktopActionResult>;
  getAppStatus(): Promise<DesktopActionResult>;
  logoutApp(input?: { accountName?: string }): Promise<DesktopActionResult>;
  stopManagedApp(): Promise<DesktopActionResult>;
  listOperations(): Promise<DesktopActionResult>;
  runDoctor(): Promise<DesktopActionResult>;
  runRecover(): Promise<DesktopActionResult>;
}

type LocalSwitcherPlatform = "windows" | "macos" | "linux" | "unknown";

function detectPlatformLocal(platform = process.platform): LocalSwitcherPlatform {
  if (platform === "win32") {
    return "windows";
  }
  if (platform === "darwin") {
    return "macos";
  }
  if (platform === "linux") {
    return "linux";
  }
  return "unknown";
}

function resolveHomeDirLocal(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): string {
  const normalized = detectPlatformLocal(platform);
  let home = env.HOME;

  if (normalized === "windows") {
    home =
      env.USERPROFILE ||
      (env.HOMEDRIVE && env.HOMEPATH ? `${env.HOMEDRIVE}${env.HOMEPATH}` : undefined) ||
      env.HOME;
  }

  home ||= process.env.HOME || "";
  if (!home) {
    throw new Error("Unable to resolve user home directory");
  }
  return home;
}

function resolveRuntimePathsLocal(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): {
  homeDir: string;
  stateDir: string;
  envsDir: string;
  defaultHome: string;
} {
  const homeDir = resolveHomeDirLocal(env, platform);
  return {
    homeDir,
    stateDir: env.CODEX_SWITCHER_STATE_DIR || join(homeDir, ".codex-switcher"),
    envsDir: env.CODEX_SWITCHER_ENVS_DIR || join(homeDir, ".codex-envs"),
    defaultHome: env.CODEX_SWITCHER_DEFAULT_HOME || join(homeDir, ".codex"),
  };
}

function codexCliCandidatePathsLocal(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): string[] {
  if (env.CODEX_SWITCHER_CODEX_BIN) {
    return [env.CODEX_SWITCHER_CODEX_BIN];
  }
  const homeDir = resolveHomeDirLocal(env, platform);
  if (detectPlatformLocal(platform) === "windows") {
    return [
      join(homeDir, "AppData", "Local", "Programs", "Codex", "codex.exe"),
      join(homeDir, "AppData", "Local", "Programs", "Codex", "resources", "codex.exe"),
    ];
  }
  return [
    "/Applications/Codex.app/Contents/Resources/codex",
    join(homeDir, "Applications", "Codex.app", "Contents", "Resources", "codex"),
  ];
}

function resolveWindowsAppLauncherLocal(env: NodeJS.ProcessEnv = process.env): string {
  return (env.CODEX_SWITCHER_WINDOWS_APP_LAUNCHER || "cmd").toLowerCase();
}

function resolveCurrentDir(): string {
  if (typeof __dirname === "string") {
    return __dirname;
  }

  const candidates = [
    join(process.cwd(), "electron"),
    join(process.cwd(), "apps", "desktop", "electron"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return process.cwd();
}

export async function loadOverview(): Promise<string> {
  await restoreEnabledRoutes();
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const api = runtime.createCoreApi({
    getState: () => state,
  });
  const overview = api.getOverview() as {
    accounts: OverviewAccountRecord[];
    status: {
      cli: Record<string, unknown>;
      app: Record<string, unknown>;
    };
  };
  const routes = await getUsageRouterManager().listRoutesIfRunning().catch(() => []);
  const pools = await getUsageRouterManager().listAccountPools().catch(() => []);

  const accounts = await Promise.all(overview.accounts.map(async (accountSummary) => {
    const account = state.envs[accountSummary.envName]?.accounts[accountSummary.name];
    const accountRoutes = routes.filter((candidate) =>
      candidate.enabled && candidate.envName === accountSummary.envName && candidate.accountName === accountSummary.name);
    const expectedProtocol = account?.runtime.apiProtocol ?? "responses";
    const route = accountRoutes.find((candidate) => candidate.protocol === expectedProtocol) ?? accountRoutes[0];
    const pool = pools.find((candidate) => candidate.enabled && candidate.envName === accountSummary.envName
      && candidate.members.some((member) => member.enabled && member.accountName === accountSummary.name));
    const poolMember = pool?.members.find((member) => member.accountName === accountSummary.name);
    const isApiKeyAccount =
      account?.runtime.preferredAuthMethod === "apikey" || accountSummary.authMode === "apikey";
    const storedApiKey = readAuthStringField(account?.authData, "OPENAI_API_KEY");

    const routedBaseUrl = pool && poolMember
      ? poolMember.upstreamBaseUrl
      : route ? resolveRouteDisplayBaseUrl(route) : "";
    const historicalBaseUrl = isLocalRouterBaseUrl(routedBaseUrl)
      ? (await getUsageRouterManager().queryUsageRequests({
          from: 0, to: Date.now(), envName: accountSummary.envName, accountName: accountSummary.name,
          page: 1, pageSize: 100,
        }).catch(() => null))?.items.find((item) => !isLocalRouterBaseUrl(item.upstreamBaseUrl))?.upstreamBaseUrl
      : undefined;

    return {
      ...accountSummary,
      apiKeyValue: isApiKeyAccount
        ? storedApiKey
        : undefined,
      hasApiKey: Boolean(storedApiKey || account?.runtime.independentModelApiKey?.trim()),
      route: pool && poolMember
        ? {
            enabled: true as const,
            originalBaseUrl: historicalBaseUrl ?? poolMember.upstreamBaseUrl,
            localBaseUrl: pool.localBaseUrl ?? account?.runtime.openaiBaseUrl ?? "",
            protocol: pool.protocol,
            poolEnabled: true as const,
            poolId: pool.poolId,
          }
        : route
        ? {
            enabled: true as const,
            originalBaseUrl: historicalBaseUrl ?? resolveRouteDisplayBaseUrl(route),
            localBaseUrl: account?.runtime.openaiBaseUrl ?? "",
            protocol: route.protocol,
          }
        : undefined,
    };
  }));

  return `${JSON.stringify({ ...overview, accounts }, null, 2)}\n`;
}

export async function repairLegacyEnvironmentConfigs() {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const result = await runtime.repairLegacyTargetHomeConfigs({
    state,
    beforeWrite: async (entry) => {
      await appendEnvFileHistoryEntry({
        stateDir: getStateDir(),
        envName: entry.envName,
        fileType: "config.toml",
        source: "migration",
        content: entry.beforeConfigToml,
      });
    },
  });
  if (result.unresolved.length > 0 || result.failures.length > 0) {
    console.warn("Codex legacy config migration incomplete", {
      unresolved: result.unresolved,
      failures: result.failures,
    });
  }
  return result;
}

export async function loadAuthMetrics(): Promise<string> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const api = runtime.createCoreApi({
    getState: () => state,
  });
  const overview = api.getOverview() as {
    accounts: OverviewAccountRecord[];
    status: {
      cli: Record<string, unknown>;
      app: Record<string, unknown>;
    };
  };

  const [accountMetrics, cliStatus, appStatus, requestHealth] = await Promise.all([
    enrichAccountOverviewList(state, overview.accounts),
    enrichTargetOverviewStatus(state, "cli", overview.status.cli),
    enrichTargetOverviewStatus(state, "app", overview.status.app),
    getUsageRouterManager().queryRecentAccountHealthIfRunning(60).catch(() => []),
  ]);

  const payload = {
    accounts: Object.fromEntries(
      accountMetrics
        .filter((account) => account.authProfile)
        .map((account) => [`${account.envName}/${account.name}`, account.authProfile]),
    ),
    requestHealth: Object.fromEntries(
      requestHealth.map((item) => [`${item.envName}/${item.accountName}`, item]),
    ),
    status: {
      cli: cliStatus.email || cliStatus.usage5h || cliStatus.usageWeekly
        ? {
            email: String(cliStatus.email ?? "-"),
            usage5h: String(cliStatus.usage5h ?? "-"),
            usageWeekly: String(cliStatus.usageWeekly ?? "-"),
          }
        : undefined,
      app: appStatus.email || appStatus.usage5h || appStatus.usageWeekly
        ? {
            email: String(appStatus.email ?? "-"),
            usage5h: String(appStatus.usage5h ?? "-"),
            usageWeekly: String(appStatus.usageWeekly ?? "-"),
          }
        : undefined,
    },
  };

  return `${JSON.stringify(payload, null, 2)}\n`;
}

export async function getLanguage(): Promise<UiLanguage> {
  return getUiLanguage();
}

export async function setLanguage(language: string): Promise<UiLanguage> {
  return setUiLanguage(language);
}

export async function switchEnv(target: "cli" | "app", envName: string): Promise<DesktopActionResult> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const next = runtime.createCoreApi({ getState: () => state }).selectEnv({
    envName,
    target,
    now: new Date().toISOString(),
  });

  await applyTargetHomeStateWithHistory(runtime, next, target, target === "cli" ? "switch-cli" : "switch-app");
  await runtime.writeLegacyPointers({
    stateDir: getStateDir(),
    target,
    env: next.targets[target].env,
    account: next.targets[target].account,
  });
  return {
    message: `Switched ${target.toUpperCase()} env to ${next.targets[target].env}`,
    output: `${next.targets[target].env}/${next.targets[target].account}\n`,
  };
}

export async function switchAccount(
  target: "cli" | "app",
  envName: string,
  accountName: string,
  strategy?: "replace-current" | "current-window" | "new-window" | "multi-window",
  workingDirectory?: string,
): Promise<DesktopActionResult> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const selected = state.envs[envName]?.accounts[accountName];
  assertDirectRemoteIdentityCompatibility(state, envName, accountName);
  let currentAppWindowCount: number | undefined;
  if (strategy === "multi-window") {
    currentAppWindowCount = await readDesiredAppWindowCount(envName);
    assertCanMultiOpen({ target, envName, accountName, activeEnvName: state.targets.app.env,
      activeAccountName: state.targets.app.account, currentCount: currentAppWindowCount, maximumCount: MAX_APP_WINDOW_COUNT });
  }
  if (selected?.runtime.apiProtocol === "chat_completions" && selected.runtime.compatibilityRouteEnabled) {
    const activePool = (await getUsageRouterManager().listAccountPools()).find((pool) => (
      pool.envName === envName
      && pool.protocol === "chat_completions"
      && pool.members.some((member) => member.accountName === accountName && member.enabled)
      && selected.runtime.compatibilityRouteBaseUrl === pool.localBaseUrl
    ));
    if (activePool && !activePool.health.some((item) => item.accountName === accountName && ["unauthorized", "exhausted", "disabled"].includes(item.state))) {
      // Pool credentials are hydrated during startup restoration; do not replace the
      // shared pool provider with an individual compatibility route while switching.
    } else {
    let [status] = await getUsageRouterManager().getAccountCompatibilityStatuses([`${envName}/${accountName}`]);
    if (!status || status.state !== "ready") {
      const apiKey = readAuthStringField(selected.authData, "OPENAI_API_KEY");
      const baseUrl = await resolveAccountUpstreamBaseUrl(envName, accountName, selected.runtime);
      if (apiKey) {
        await getUsageRouterManager().enableAccountCompatibility({ envName, accountName, authMode: selected.authMode,
          baseUrl, apiKey, providerId: selected.runtime.providerId,
          upstreamModel: selected.runtime.compatibilityUpstreamModel,
          reasoningProfile: selected.runtime.compatibilityReasoningProfile,
          longConversationStrategy: selected.runtime.compatibilityLongConversationStrategy,
          instructionRole: selected.runtime.compatibilityInstructionRole,
          requestOverrides: selected.runtime.compatibilityRequestOverrides },
        async ({ baseUrl: localBaseUrl, localRouteToken }) => {
          await writeCompatibilityRuntime(runtime, envName, accountName, {
            ...selected.runtime, apiProtocol: "chat_completions", compatibilityRouteEnabled: true,
            compatibilityRouteBaseUrl: localBaseUrl, compatibilityRouteToken: localRouteToken,
            compatibilityRouteProviderId: undefined,
          });
        });
        [status] = await getUsageRouterManager().getAccountCompatibilityStatuses([`${envName}/${accountName}`]);
      }
    }
    if (!status || status.state !== "ready") {
      throw new Error(`Compatibility route for '${envName}/${accountName}' is not ready. Re-enable or check the route before launch.`);
    }
    }
  }
  const next = runtime.createCoreApi({ getState: () => state }).selectAccount({
    envName,
    accountName,
    target,
    now: new Date().toISOString(),
  });

  await applyTargetHomeStateWithHistory(runtime, next, target, target === "cli" ? "switch-cli" : "switch-app");
  await runtime.writeLegacyPointers({
    stateDir: getStateDir(),
    target,
    env: next.targets[target].env,
    account: next.targets[target].account,
  });
  if (target === "app") {
    if (strategy === "multi-window") {
      const settingsPath = getCodexToolPathOptions().settingsPath;
      const count = currentAppWindowCount ?? await readDesiredAppWindowCount(envName);
      const savedCount = await launchAndPersistAdditionalAppWindow({ currentCount: count,
        maximumCount: MAX_APP_WINDOW_COUNT,
        launch: () => launchAppTarget(next, runtime, "additional"),
        saveCount: (nextCount) => saveAppWindowCount(settingsPath, envName, nextCount) });
      return {
        message: `Opened App window ${savedCount} for ${envName}/${accountName}`,
      };
    }
    await launchAppTarget(next, runtime, "reconcile");
  } else {
    const warning = await openCommandInPreferredTerminal(
      ["cli", "launch-current"],
      strategy === "current-window" ? "current-window" : "new-window",
      workingDirectory,
    );
    return {
      message: `Switched ${target.toUpperCase()} account to ${next.targets[target].env}/${next.targets[target].account}${warning ? `. ${warning}` : ""}`,
      output: `${next.targets[target].env}/${next.targets[target].account}\n`,
    };
  }
  return {
    message: `Switched ${target.toUpperCase()} account to ${next.targets[target].env}/${next.targets[target].account}`,
    output: `${next.targets[target].env}/${next.targets[target].account}\n`,
  };
}

async function writeCompatibilityRuntime(
  runtime: Awaited<ReturnType<typeof loadCoreRuntime>>,
  envName: string,
  accountName: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const state = await runtime.readLegacyState(getLegacyOptions());
  const current = state.envs[envName]?.accounts[accountName];
  if (!current) throw new Error(`Account '${envName}/${accountName}' not found`);
  const next = runtime.createCoreApi({ getState: () => state }).updateAccountRuntime({
    envName, accountName, runtime: { ...current.runtime, ...patch }, now: new Date().toISOString(),
  });
  const updated = next.envs[envName]?.accounts[accountName];
  if (!updated) throw new Error(`Unable to update '${envName}/${accountName}'`);
  await runtime.writeLegacyRuntime({ stateDir: getStateDir(), envName, accountName, runtime: updated.runtime });
  await syncUpdatedAuthToActiveTargetsDirect(runtime, envName, accountName);
}

export async function enableAccountCompatibility(input: {
  envName: string;
  accountName: string;
  upstreamModel?: string;
  reasoningProfile?: "auto" | "standard" | "reasoning_content" | "think_tags";
  longConversationStrategy?: "safe" | "continuity";
  instructionRole?: "auto" | "system" | "developer";
  requestOverrides?: Record<string, unknown>;
}) {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const account = state.envs[input.envName]?.accounts[input.accountName];
  if (!account) throw new Error(`Account '${input.envName}/${input.accountName}' not found`);
  const apiKey = readAuthStringField(account.authData, "OPENAI_API_KEY");
  const baseUrl = await resolveAccountUpstreamBaseUrl(input.envName, input.accountName, account.runtime);
  return getUsageRouterManager().enableAccountCompatibility({
    envName: input.envName, accountName: input.accountName, authMode: account.authMode,
    baseUrl, apiKey, providerId: account.runtime.providerId, upstreamModel: input.upstreamModel,
    reasoningProfile: input.reasoningProfile, requestOverrides: input.requestOverrides,
    longConversationStrategy: input.longConversationStrategy,
    instructionRole: input.instructionRole,
  }, async ({ baseUrl: localBaseUrl, localRouteToken }) => {
    await writeCompatibilityRuntime(runtime, input.envName, input.accountName, {
      apiProtocol: "chat_completions", compatibilityRouteEnabled: true,
      compatibilityRouteBaseUrl: localBaseUrl, compatibilityRouteToken: localRouteToken,
      compatibilityRouteProviderId: undefined, compatibilityUpstreamModel: input.upstreamModel,
      compatibilityReasoningProfile: input.reasoningProfile ?? "auto",
      compatibilityLongConversationStrategy: input.longConversationStrategy ?? "safe",
      compatibilityInstructionRole: input.instructionRole ?? "auto",
      compatibilityRequestOverrides: input.requestOverrides,
    });
  });
}

export async function disableAccountCompatibility(envName: string, accountName: string) {
  const runtime = await loadCoreRuntime();
  return getUsageRouterManager().disableAccountCompatibility(envName, accountName, async (originalBaseUrl) => {
    await writeCompatibilityRuntime(runtime, envName, accountName, {
      apiProtocol: "responses", compatibilityRouteEnabled: false,
      compatibilityRouteBaseUrl: undefined, compatibilityRouteToken: undefined,
      compatibilityRouteProviderId: undefined, compatibilityUpstreamModel: undefined,
      compatibilityReasoningProfile: "auto", compatibilityRequestOverrides: undefined,
      compatibilityLongConversationStrategy: "safe",
      compatibilityInstructionRole: "auto",
      openaiBaseUrlMode: originalBaseUrl === "default" ? "default" : "custom",
      openaiBaseUrl: originalBaseUrl === "default" ? undefined : originalBaseUrl,
    });
  });
}

export async function getAccountCompatibilityStatuses(accountKeys: string[]) {
  return getUsageRouterManager().getAccountCompatibilityStatuses(accountKeys);
}

export async function checkAccountCompatibility(envName: string, accountName: string) {
  return getUsageRouterManager().checkAccountCompatibility(envName, accountName);
}

export async function testModelRequest(input: {
  envName: string;
  accountName: string;
  model: string;
  modelId?: string;
  upstreamModel?: string;
  prompt?: string;
}) {
  const manager = getUsageRouterManager();
  const activeGateways = input.modelId
    ? await manager.listPersistedEnvironmentGateways().catch(() => [])
    : [];
  const gatewayActive = activeGateways.some((gateway) => gateway.envName === input.envName && gateway.enabled);
  if (gatewayActive) {
    try {
      const preview = await buildModelRequestPreview(input);
      if (!preview) {
        return {
          ok: false,
          status: 422,
          message: "Unable to compile the selected model's Gateway preview route",
          latencyMs: 0,
          model: input.model.trim(),
        };
      }
      return manager.testModelRequestPreview(preview);
    } catch (error) {
      return {
        ok: false,
        status: 422,
        message: error instanceof Error ? error.message : String(error),
        latencyMs: 0,
        model: input.model.trim(),
      };
    }
  }
  return manager.testModelRequest(input);
}

export async function listAccountProjects(envName: string, _accountName: string): Promise<CodexProject[]> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const env = state.envs[envName];
  if (!env) throw new Error(`Env '${envName}' not found`);
  return readCodexProjects(env.path);
}

export async function createEnv(request: {
  envName: string;
  source: {
    kind: "empty" | "default" | "env";
    envName?: string;
  };
}): Promise<DesktopActionResult> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const sourceEnvName =
    request.source.kind === "env"
      ? request.source.envName?.trim() || undefined
      : request.source.kind === "default"
        ? "default"
        : undefined;
  const next = runtime.createCoreApi({ getState: () => state }).createEnv({
    envName: request.envName,
    homePath: request.envName === "default" ? getDefaultHome() : `${getEnvsDir()}/${request.envName}/home`,
    cloneFromEnv: sourceEnvName,
    now: new Date().toISOString(),
  });
  const created = next.envs[request.envName];
  if (!created) {
    throw new Error(`failed to create env '${request.envName}'`);
  }

  try {
    await runtime.createLegacyEnv({
      envsDir: getEnvsDir(),
      envName: request.envName,
    });

    if (sourceEnvName) {
      const sourcePath = state.envs[sourceEnvName]?.path;
      if (!sourcePath) {
        throw new Error(`source env '${sourceEnvName}' not found`);
      }
      await cloneEnvHomeExcludingAuth(sourcePath, created.path);
    }
    const recovery = await readGeneratedImageRecoverySettings(getCodexToolPathOptions().settingsPath);
    if (recovery.enabled) {
      await reconcileGeneratedImageRecoveryForEnvironments(true, [{ name: created.name, homePath: created.path }]);
    }
  } catch (error) {
    await rm(join(getEnvsDir(), request.envName), { recursive: true, force: true });
    await rm(join(getStateDir(), "env-accounts", request.envName), { recursive: true, force: true });
    throw error;
  }

  return {
    message: `Created env ${created.name}`,
    output: `${created.name}\n`,
  };
}

export async function deleteEnv(envName: string): Promise<DesktopActionResult> {
  const runtime = await loadCoreRuntime();
  await removeEnvDirect(runtime, envName);
  return {
    message: `Removed env ${envName}`,
    output: `${envName}\n`,
  };
}

export async function createEnvLegacy(envName: string): Promise<string> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const next = runtime.createCoreApi({ getState: () => state }).createEnv({
    envName,
    homePath: envName === "default" ? getDefaultHome() : `${getEnvsDir()}/${envName}/home`,
    now: new Date().toISOString(),
  });

  await runtime.createLegacyEnv({
    envsDir: getEnvsDir(),
    envName,
  });

  const recovery = await readGeneratedImageRecoverySettings(getCodexToolPathOptions().settingsPath);
  if (recovery.enabled) {
    const created = next.envs[envName];
    if (created) await reconcileGeneratedImageRecoveryForEnvironments(true, [{ name: created.name, homePath: created.path }]);
  }

  return `${next.envs[envName]?.name ?? envName}\n`;
}

export async function updateEnv(
  envName: string,
  nextEnvName: string,
  homePath: string,
): Promise<DesktopActionResult> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const existingPool = (await getUsageRouterManager().listPersistedAccountPools())
    .find((pool) => pool.envName === envName && pool.enabled);
  const next = runtime.createCoreApi({ getState: () => state }).updateEnv({
    envName,
    nextEnvName,
    homePath,
    now: new Date().toISOString(),
  });
  const nextEnv = next.envs[nextEnvName];
  if (!nextEnv) {
    throw new Error(`failed to update env '${envName}'`);
  }

  await runtime.updateLegacyEnv({
    stateDir: getStateDir(),
    envsDir: getEnvsDir(),
    envName,
    nextEnvName,
    homePath: nextEnv.path,
  });
  if (nextEnvName !== envName) {
    await renameAppWindowCount(getCodexToolPathOptions().settingsPath, envName, nextEnvName);
  }

  if (existingPool && nextEnvName !== envName) {
    const latestState = await runtime.readLegacyState(getLegacyOptions());
    const originals = new Map(existingPool.members.map((member) => [member.accountName, member.originalBaseUrl]));
    const accounts = getEnvironmentRouteAccounts(latestState, nextEnvName)
      .filter((account) => originals.has(account.accountName))
      .map((account) => ({ ...account, baseUrl: originals.get(account.accountName) ?? account.baseUrl }));
    await getUsageRouterManager().removeAccountPoolConfiguration(envName);
    try {
      await getUsageRouterManager().enableAccountPool({
        envName: nextEnvName,
        protocol: existingPool.protocol,
        accountNames: accounts.map((account) => account.accountName),
        weights: Object.fromEntries(existingPool.members.map((member) => [member.accountName, member.weight])),
        sessionTtlMinutes: existingPool.sessionTtlMinutes,
        maxFailoverAttempts: existingPool.maxFailoverAttempts,
        maxSameAccountFailures: existingPool.maxSameAccountFailures,
      }, accounts, createAccountPoolRuntimeUpdater(runtime, nextEnvName, existingPool.protocol));
    } catch (error) {
      await Promise.allSettled(accounts.map((account) => (
        createAccountPoolRuntimeUpdater(runtime, nextEnvName, existingPool.protocol)(account.accountName, account.baseUrl)
      )));
      throw error;
    }
  }

  for (const target of ["cli", "app"] as const) {
    if (next.targets[target].env === nextEnvName) {
      await runtime.writeLegacyPointers({
        stateDir: getStateDir(),
        target,
        env: next.targets[target].env,
        account: next.targets[target].account,
      });
      await applyTargetHomeStateWithHistory(runtime, next, target, target === "cli" ? "switch-cli" : "switch-app");
    }
  }

  return {
    message: `Updated env ${nextEnv.name}`,
    output: `${nextEnv.name} ${nextEnv.path}\n`,
  };
}

export async function readEnvConfig(envName: string): Promise<string> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const env = state.envs[envName];
  if (!env) {
    throw new Error(`Env '${envName}' not found`);
  }

  return readTextFileOrEmpty(join(env.path, "config.toml"));
}

export async function readEnvFiles(envName: string): Promise<string> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const env = state.envs[envName];
  if (!env) {
    throw new Error(`Env '${envName}' not found`);
  }

  const payload: EnvEditableFilesResult = {
    configToml: await readTextFileOrEmpty(join(env.path, "config.toml")),
    authJson: await readTextFileOrEmpty(join(env.path, "auth.json")),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export async function updateEnvConfig(envName: string, content: string): Promise<DesktopActionResult> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const env = state.envs[envName];
  if (!env) {
    throw new Error(`Env '${envName}' not found`);
  }

  await updateEnvEditableFilesDirect(envName, {
    configToml: content,
    authJson: await readTextFileOrEmpty(join(env.path, "auth.json")),
  });
  return {
    message: `Updated config for ${envName}`,
    output: join(env.path, "config.toml"),
  };
}

export async function updateEnvFiles(
  envName: string,
  files: EnvEditableFilesResult,
): Promise<DesktopActionResult> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const env = state.envs[envName];
  if (!env) {
    throw new Error(`Env '${envName}' not found`);
  }

  await updateEnvEditableFilesDirect(envName, files);
  return {
    message: `Updated editable files for ${envName}`,
    output: env.path,
  };
}

export async function syncEnvironmentConversationHistory(envName: string): Promise<CodexHistorySyncResult> {
  const trimmedEnvName = envName.trim();
  if (!trimmedEnvName) throw new Error("Environment name is required");
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const environment = state.envs[trimmedEnvName];
  if (!environment) throw new Error(`Env '${trimmedEnvName}' not found`);

  const support = await loadCoreSupportModules();
  const isRunning = async () => {
    const paths = support.resolveManagedAppStatePaths(getStateDir());
    const reconciled = await support.reconcileManagedAppInstanceCount(paths, trimmedEnvName).catch(() => undefined);
    if (reconciled !== undefined) return reconciled > 0;
    const instances = await support.listManagedAppInstances(paths);
    return instances.some((instance) => instance.targetKey?.trim().split("/", 1)[0] === trimmedEnvName);
  };

  return syncCodexProviderHistory({
    envName: trimmedEnvName,
    homePath: environment.path,
    stateDir: getStateDir(),
    isRunning,
  });
}

async function loadConversationRepairContext() {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const environments = Object.values(state.envs).map((environment) => ({
    envName: environment.name,
    homePath: environment.path,
    gatewayEnabled: environment.gateway?.mode === "gateway",
  }));
  const support = await loadCoreSupportModules();
  const isRunning = async (envName: string) => {
    const paths = support.resolveManagedAppStatePaths(getStateDir());
    const reconciled = await support.reconcileManagedAppInstanceCount(paths, envName).catch(() => undefined);
    if (reconciled !== undefined) return reconciled > 0;
    const instances = await support.listManagedAppInstances(paths);
    return instances.some((instance) => instance.targetKey?.trim().split("/", 1)[0] === envName);
  };
  return { environments, isRunning };
}

export async function inspectCodexConversationById(conversationId: string): Promise<CodexConversationInspectionResult> {
  const context = await loadConversationRepairContext();
  return inspectCodexConversation(conversationId, context.environments);
}

export async function repairCodexConversationById(input: {
  conversationId: string;
  envName?: string;
  targetProviderId?: string;
}): Promise<CodexConversationRepairResult> {
  const context = await loadConversationRepairContext();
  return repairCodexConversation({
    ...input,
    environments: context.environments,
    stateDir: getStateDir(),
    isRunning: context.isRunning,
  });
}

export async function listEnvFileHistory(envName: string): Promise<string> {
  const entries = await listEnvFileHistoryEntries(getStateDir(), envName);
  return `${JSON.stringify(entries, null, 2)}\n`;
}

export async function restoreEnvFileHistory(envName: string, entryId: string): Promise<DesktopActionResult> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const env = state.envs[envName];
  if (!env) {
    throw new Error(`Env '${envName}' not found`);
  }

  const entries = await listEnvFileHistoryEntries(getStateDir(), envName);
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) {
    throw new Error(`History entry '${entryId}' not found`);
  }

  const before = await readEnvFileSnapshot(env.path);
  if (entry.fileType === "config.toml") {
    if (before.configToml !== entry.content) {
      await appendEnvFileHistoryEntry({
        stateDir: getStateDir(),
        envName,
        fileType: "config.toml",
        source: "restore",
        content: before.configToml,
      });
      await writeTextFileRaw(join(env.path, "config.toml"), entry.content);
    }
  } else if (before.authJson !== entry.content) {
    await appendEnvFileHistoryEntry({
      stateDir: getStateDir(),
      envName,
      fileType: "auth.json",
      source: "restore",
      content: before.authJson,
    });
    await writeTextFileRaw(join(env.path, "auth.json"), entry.content);
  }

  return {
    message: `Restored ${entry.fileType} for ${envName}`,
    output: entry.fileType,
  };
}

export async function deleteEnvFileHistory(envName: string, entryIds: string[]): Promise<DesktopActionResult> {
  const deleted = await deleteEnvFileHistoryEntries(getStateDir(), envName, entryIds);
  return {
    message: `Deleted ${deleted} history entries for ${envName}`,
    output: `${deleted}\n`,
  };
}

export async function updateRuntime(
  envName: string,
  accountName: string,
  baseUrl: string
): Promise<DesktopActionResult> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const next = runtime.createCoreApi({ getState: () => state }).updateAccountRuntime({
    envName,
    accountName,
    runtime: {
      preferredAuthMethod: baseUrl && baseUrl !== "default" ? "apikey" : "chatgpt",
      openaiBaseUrlMode: baseUrl && baseUrl !== "default" ? "custom" : "default",
      openaiBaseUrl: baseUrl && baseUrl !== "default" ? baseUrl : undefined,
    },
    now: new Date().toISOString(),
  });
  const account = next.envs[envName]?.accounts[accountName];
  if (!account) {
    throw new Error(`failed to update runtime for '${envName}/${accountName}'`);
  }

  await runtime.writeLegacyRuntime({
    stateDir: getStateDir(),
    envName,
    accountName,
    runtime: account.runtime,
  });

  for (const currentTarget of ["cli", "app"] as const) {
    const pointer = next.targets[currentTarget];
    if (pointer.env === envName && pointer.account === accountName) {
      await applyTargetHomeStateWithHistory(runtime, next, currentTarget, currentTarget === "cli" ? "switch-cli" : "switch-app");
    }
  }

  return {
    message: `Updated runtime for ${envName}/${accountName}`,
    output: `${envName}/${accountName} ${account.runtime.openaiBaseUrl ?? "default"}\n`,
  };
}

export async function updateIndependentModel(request: {
  envName: string;
  accountName: string;
  enabled: boolean;
  providerId?: string;
  apiKey?: string;
  baseUrl?: string;
}): Promise<DesktopActionResult> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const current = state.envs[request.envName]?.accounts[request.accountName];
  if (!current) {
    throw new Error(`Account '${request.envName}/${request.accountName}' not found`);
  }
  if (current.authMode !== "auth") {
    throw new Error("Independent model config is only supported for AUTH accounts");
  }

  const next = runtime.createCoreApi({ getState: () => state }).updateAccountRuntime({
    envName: request.envName,
    accountName: request.accountName,
    runtime: {
      ...current.runtime,
      independentModelEnabled: request.enabled,
      independentModelProviderId: request.enabled ? request.providerId?.trim() || "custom" : undefined,
      independentModelApiKey: request.enabled ? request.apiKey?.trim() || undefined : undefined,
      independentModelBaseUrl: request.enabled ? request.baseUrl?.trim() || undefined : undefined,
    },
    now: new Date().toISOString(),
  });
  const account = next.envs[request.envName]?.accounts[request.accountName];
  if (!account) {
    throw new Error(`failed to update independent model for '${request.envName}/${request.accountName}'`);
  }

  await runtime.writeLegacyRuntime({
    stateDir: getStateDir(),
    envName: request.envName,
    accountName: request.accountName,
    runtime: account.runtime,
  });

  for (const currentTarget of ["cli", "app"] as const) {
    const pointer = next.targets[currentTarget];
    if (pointer.env === request.envName && pointer.account === request.accountName) {
      await applyTargetHomeStateWithHistory(runtime, next, currentTarget, currentTarget === "cli" ? "switch-cli" : "switch-app");
    }
  }
  if (request.enabled && (isDeepSeekOfficialBaseUrl(request.baseUrl)
    || isMimoOfficialBaseUrl(request.baseUrl)
    || isKimiOfficialBaseUrl(request.baseUrl)
    || isZaiOfficialBaseUrl(request.baseUrl))) {
    await ensureIndependentModelSlug(
      state.envs[request.envName]!.path,
      isMimoOfficialBaseUrl(request.baseUrl)
        ? MIMO_DEFAULT_MODEL_SLUG
        : isKimiOfficialBaseUrl(request.baseUrl)
          ? KIMI_DEFAULT_MODEL_SLUG
          : isZaiOfficialBaseUrl(request.baseUrl)
            ? ZAI_DEFAULT_MODEL_SLUG
            : DEEPSEEK_DEFAULT_MODEL_SLUG,
    );
  }

  return {
    message: `Updated independent model for ${request.envName}/${request.accountName}`,
    output: `${request.envName}/${request.accountName} ${request.enabled ? "enabled" : "disabled"}\n`,
  };
}

export async function nativeLogin(request: {
  providerId?: string;
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
  apiProtocol?: "responses" | "chat_completions" | "anthropic";
  compatibilityEnabled?: boolean;
  upstreamModel?: string;
  reasoningProfile?: "auto" | "standard" | "reasoning_content" | "think_tags";
  longConversationStrategy?: "safe" | "continuity";
  instructionRole?: "auto" | "system" | "developer";
  requestOverrides?: Record<string, unknown>;
}): Promise<DesktopActionResult> {
  switch (request.mode) {
    case "auth":
      return nativeAuthLogin(request);
    case "apikey":
      return nativeApiKeyLogin(request);
    case "sub2api":
    case "cpa":
      return nativeExternalCredentialLogin(request, request.mode);
    default:
      throw new Error(`unsupported login mode: ${request.mode}`);
  }
}

export interface ProviderCredentialImportRequest {
  providerId: string;
  account: string;
  envName: string;
  target: "cli" | "app" | "both" | "none";
  authMethod?: ProviderAuthMethod;
  accessToken?: string;
  refreshToken?: string;
  accountId?: string;
  expiresAt?: number;
  baseUrl?: string;
  apiProtocol?: "responses" | "chat_completions" | "anthropic";
  requestHeaders?: Record<string, string>;
}

/**
 * Imports a Provider credential into the same account store used by manual
 * account switching.  The Codex-compatible account files keep only the
 * credential material required by the local route; provider metadata remains
 * in runtime.json so discovery and refresh can use the correct adapter.
 */
export async function importProviderCredential(
  request: ProviderCredentialImportRequest,
): Promise<DesktopActionResult> {
  const providerId = normalizeProviderId(request.providerId);
  if (!providerId) throw new Error("Provider ID is required");
  if (!request.account.trim()) throw new Error("Account name is required");
  const providerRuntime = await loadGatewayProviderRuntime();
  const definition = providerRuntime.providerDefinitions().find((item) => item.id === providerId);
  const pluginAdapter = definition ? undefined : await getProviderPluginAdapter(getStateDir(), providerId);
  const adapter = definition
    ? providerRuntime.createConfiguredProviderAdapter?.(definition, definition.endpoints)
      ?? providerRuntime.createProviderAdapter(definition)
    : pluginAdapter;
  if (!adapter) throw new Error(`Provider '${providerId}' is not installed`);

  const authMethod = request.authMethod ?? (definition?.category === "subscription" ? "subscription" : "api_key");
  if (!adapter.authMethods.includes(authMethod)) {
    throw new Error(`Provider '${providerId}' does not support credential type '${authMethod}'`);
  }
  const accessToken = request.accessToken?.trim() || undefined;
  const refreshToken = request.refreshToken?.trim() || undefined;
  const providerRequestHeaders = sanitizeProviderRequestHeaders(request.requestHeaders);
  if (authMethod !== "none" && !accessToken) throw new Error("Access token or API key is required");
  if (request.expiresAt !== undefined && (!Number.isFinite(request.expiresAt) || request.expiresAt <= 0)) {
    throw new Error("Credential expiry must be a positive timestamp");
  }

  const endpoint = definition?.endpoints.find((item) => item.protocol === (request.apiProtocol ?? "responses"))
    ?? definition?.endpoints[0];
  const baseUrl = request.baseUrl?.trim() || endpoint?.baseUrl;
  const apiProtocol = request.apiProtocol
    ?? (endpoint?.protocol === "chat_completions"
      ? "chat_completions"
      : endpoint?.protocol === "anthropic"
        ? "anthropic"
        : "responses");
  const authJson: Record<string, unknown> = {
    provider_id: providerId,
    provider_auth_method: authMethod,
    ...(request.accountId?.trim() ? { account_id: request.accountId.trim() } : {}),
    ...(accessToken ? { OPENAI_API_KEY: accessToken } : {}),
    ...(accessToken || refreshToken || request.expiresAt
      ? {
          tokens: {
            ...(accessToken ? { access_token: accessToken } : {}),
            ...(refreshToken ? { refresh_token: refreshToken } : {}),
            ...(request.expiresAt ? { expires_at: request.expiresAt } : {}),
          },
        }
      : {}),
  };

  const state = await (await loadCoreRuntime()).readLegacyState(getLegacyOptions());
  if (!state.envs[request.envName]) throw new Error(`Env '${request.envName}' not found`);
  await saveAccountArtifacts({
    envName: request.envName,
    account: request.account.trim(),
    runtime: {
      providerId,
      providerAuthMethod: authMethod,
      ...(providerRequestHeaders ? { providerRequestHeaders } : {}),
      preferredAuthMethod: "apikey",
      openaiBaseUrlMode: baseUrl ? "custom" : "default",
      openaiBaseUrl: baseUrl,
      apiProtocol,
      compatibilityRouteEnabled: false,
    },
    authJsonContent: `${JSON.stringify(authJson, null, 2)}\n`,
    target: request.target,
  });
  await ensureProviderDefaultModels(getModelCatalogStore(), providerId);
  await discoverAccountModels(request.envName, request.account.trim());
  return {
    message: `Imported ${providerId} credential for ${request.envName}/${request.account.trim()}`,
    output: `Provider credential imported: ${request.envName}/${request.account.trim()}`,
  };
}

export async function refreshProviderCredential(input: {
  envName: string;
  account: string;
}): Promise<DesktopActionResult> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const environment = state.envs[input.envName];
  const account = environment?.accounts[input.account];
  const providerId = account?.runtime.providerId;
  if (!environment || !account || !providerId) throw new Error(`Provider account '${input.envName}/${input.account}' not found`);
  const rawTokens = account.authData?.tokens;
  const tokens = parseTokenRecord(rawTokens);
  const refreshToken = typeof tokens?.refresh_token === "string" ? tokens.refresh_token.trim() : "";
  if (!refreshToken) throw new Error(`Provider account '${input.envName}/${input.account}' has no refresh token`);
  const providerRuntime = await loadGatewayProviderRuntime();
  const definition = providerRuntime.providerDefinitions().find((item) => item.id === providerId);
  const adapter = definition
    ? providerRuntime.createConfiguredProviderAdapter?.(definition, definition.endpoints)
      ?? providerRuntime.createProviderAdapter(definition)
    : await getProviderPluginAdapter(getStateDir(), providerId);
  if (!adapter) throw new Error(`Provider '${providerId}' is not installed`);
  const providerAuthMethod = account.runtime.providerAuthMethod ?? (account.authMode === "auth" ? "subscription" : "api_key");
  const providerAccount: ProviderAccountRef = {
    accountId: extractAccountIdFromAuthData(account.authData) ?? input.account,
    displayName: input.account,
    authMethod: providerAuthMethod,
    secretRef: `account:${encodeURIComponent(input.envName)}:${encodeURIComponent(input.account)}`,
    status: "active",
    ...(tokens?.expires_at && typeof tokens.expires_at === "number" ? { expiresAt: tokens.expires_at } : {}),
  };
  const refreshed = await adapter.refresh(await createProviderHttpClient(), providerAccount, refreshToken);
  const nextTokens = {
    ...(tokens ?? {}),
    ...(refreshed.accessToken ? { access_token: refreshed.accessToken } : {}),
    ...(refreshed.refreshToken ? { refresh_token: refreshed.refreshToken } : {}),
    ...(refreshed.account.expiresAt ? { expires_at: refreshed.account.expiresAt } : {}),
  };
  const nextAuthData = {
    ...(account.authData ?? {}),
    ...(refreshed.accessToken ? { OPENAI_API_KEY: refreshed.accessToken } : {}),
    tokens: nextTokens,
  };
  const authPath = join(getStateDir(), "env-accounts", input.envName, input.account, "auth.json");
  await writeFileAtomically(authPath, `${JSON.stringify(nextAuthData, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await runtime.writeLegacyRuntime({
    stateDir: getStateDir(),
    envName: input.envName,
    accountName: input.account,
    runtime: { ...account.runtime, providerAuthMethod },
  });
  await discoverAccountModels(input.envName, input.account);
  await resynchronizeActiveModelCatalogs(accountModelBindingKey(input.envName, input.account), { updateAppHome: false });
  await syncEnvironmentRouteIfEnabled(input.envName).catch(() => undefined);
  return {
    message: `Refreshed ${providerId} credential for ${input.envName}/${input.account}`,
    output: `Provider credential refreshed: ${input.envName}/${input.account}`,
  };
}

async function createProviderHttpClient(): Promise<ProviderHttpClient> {
  const globalProxy = await resolveUsageProxy();
  return {
    async request(url, init, context) {
      const response = await fetchWithOptionalProxy(
        url,
        { method: init.method, headers: init.headers, body: init.body },
        context?.proxyUrl ?? globalProxy,
      );
      let payload: unknown = {};
      try { payload = await response.json(); } catch { /* provider may return an empty error body */ }
      return {
        status: response.status,
        headers: response.headers,
        json: async () => (isRecord(payload) ? payload : {}) as import("../../../packages/gateway/dist/protocol.js").JsonObject,
      };
    },
  };
}

function parseTokenRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function getCodexToolPathOptions() {
  return { settingsPath: join(getStateDir(), "desktop-settings.json"), env: process.env, platform: process.platform };
}

export async function getCodexToolPaths() {
  return listCodexToolStatuses(getCodexToolPathOptions());
}

export async function detectCodexToolPaths() {
  return listCodexToolStatuses(getCodexToolPathOptions());
}

export async function setCodexToolPath(kind: CodexToolKind, path: string) {
  const result = await saveCodexToolPath(kind, path, getCodexToolPathOptions());
  bundledCatalogPromise = undefined;
  return result;
}

export async function clearCodexToolPath(kind: CodexToolKind) {
  const result = await resetCodexToolPath(kind, getCodexToolPathOptions());
  bundledCatalogPromise = undefined;
  return result;
}

export async function getCliAutoResumeSettings(): Promise<CliAutoResumeSettings> {
  return readCliAutoResumeSettings(getCodexToolPathOptions().settingsPath);
}

export async function getRouterLifecycleSettings(): Promise<RouterLifecycleSettings> {
  return readRouterLifecycleSettings(getCodexToolPathOptions().settingsPath);
}

export async function getRouterPortSettings(): Promise<RouterPortSettings> {
  return readRouterPortSettings(getCodexToolPathOptions().settingsPath);
}

export async function getLaunchAtLoginSettings(): Promise<LaunchAtLoginStatus> {
  const settings = await readLaunchAtLoginSettings(getCodexToolPathOptions().settingsPath);
  return { ...settings, supported: process.platform === "darwin" || process.platform === "win32" };
}

export interface AppPresenceStatus extends AppPresenceSettings {
  supported: boolean;
  platform: "darwin" | "win32" | "linux" | "unsupported";
}

function appPresencePlatform(): AppPresenceStatus["platform"] {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "win32") return "win32";
  if (process.platform === "linux") return "linux";
  return "unsupported";
}

export async function getAppPresenceSettings(): Promise<AppPresenceStatus> {
  const settings = await readAppPresenceSettings(getCodexToolPathOptions().settingsPath);
  return { ...settings, supported: process.platform === "darwin", platform: appPresencePlatform() };
}

export async function getEnvHistoryRetentionSettings(): Promise<EnvHistoryRetentionSettings> {
  return readEnvHistoryRetentionSettings(getCodexToolPathOptions().settingsPath);
}

export async function getGeneratedImageRecoverySettings() {
  const settings = await readGeneratedImageRecoverySettings(getCodexToolPathOptions().settingsPath);
  const environments = await listCodexSkillEnvironments();
  if (settings.enabled) return reconcileGeneratedImageRecoveryForEnvironments(true, environments);
  return inspectGeneratedImageRecoverySkill(false, environments);
}

let appEnvironmentBadgeManager: AppEnvironmentBadgeManager | undefined;

function getAppEnvironmentBadgeManager(): AppEnvironmentBadgeManager {
  if (!appEnvironmentBadgeManager) {
    const adapter = process.platform === "darwin"
      ? new MacDockBadgeAdapter(currentDir)
      : process.platform === "win32"
        ? new WindowsTaskbarBadgeAdapter(currentDir)
        : createUnsupportedBadgeAdapter();
    const settingsPath = getCodexToolPathOptions().settingsPath;
    appEnvironmentBadgeManager = new AppEnvironmentBadgeManager({
      adapter,
      readEnabled: async () => (await readAppEnvironmentBadgeSettings(settingsPath)).enabled,
      saveEnabled: async (enabled) => { await saveAppEnvironmentBadgeSettings(settingsPath, { enabled }); },
      listInstances: async () => {
        const support = await loadCoreSupportModules();
        return support.listManagedAppInstances(support.resolveManagedAppStatePaths(getStateDir()));
      },
    });
  }
  return appEnvironmentBadgeManager;
}

export async function getAppEnvironmentBadgeStatus(): Promise<AppEnvironmentBadgeStatus> {
  return getAppEnvironmentBadgeManager().getStatus();
}

export async function requestAppEnvironmentBadgePermission(): Promise<AppEnvironmentBadgeStatus> {
  return getAppEnvironmentBadgeManager().requestPermission();
}

export async function setAppEnvironmentBadgeSettings(value: AppEnvironmentBadgeSettings): Promise<AppEnvironmentBadgeStatus> {
  return getAppEnvironmentBadgeManager().setEnabled(value.enabled === true);
}

export async function synchronizeAppEnvironmentBadges(): Promise<AppEnvironmentBadgeStatus> {
  return getAppEnvironmentBadgeManager().sync();
}

function scheduleAppEnvironmentBadgeSync(): void {
  for (const delayMs of [0, 900, 2_500]) {
    const timer = setTimeout(() => { void synchronizeAppEnvironmentBadges().catch(() => undefined); }, delayMs);
    timer.unref();
  }
}

export async function setRouterLifecycleSettings(value: RouterLifecycleSettings): Promise<RouterLifecycleSettings> {
  return saveRouterLifecycleSettings(getCodexToolPathOptions().settingsPath, value);
}

export async function setRouterPortSettings(value: RouterPortSettings): Promise<RouterPortSettings> {
  return saveRouterPortSettings(getCodexToolPathOptions().settingsPath, value);
}

export async function setLaunchAtLoginSettings(value: { enabled: boolean }): Promise<LaunchAtLoginStatus> {
  const settings = await saveLaunchAtLoginSettings(getCodexToolPathOptions().settingsPath, value);
  return { ...settings, supported: process.platform === "darwin" || process.platform === "win32" };
}

export async function setAppPresenceSettings(value: AppPresenceSettings): Promise<AppPresenceStatus> {
  const settings = await saveAppPresenceSettings(getCodexToolPathOptions().settingsPath, value);
  return { ...settings, supported: process.platform === "darwin", platform: appPresencePlatform() };
}

export async function setEnvHistoryRetentionSettings(
  value: EnvHistoryRetentionSettings,
): Promise<EnvHistoryRetentionSettings> {
  const saved = await saveEnvHistoryRetentionSettings(getCodexToolPathOptions().settingsPath, value);
  void runEnvHistoryRetentionCleanup(true).catch(() => undefined);
  return saved;
}

export async function setGeneratedImageRecoverySettings(value: GeneratedImageRecoverySettings) {
  const enabled = value.enabled === true;
  const environments = await listCodexSkillEnvironments();
  const status = await reconcileGeneratedImageRecoveryForEnvironments(enabled, environments);
  await saveGeneratedImageRecoverySettings(getCodexToolPathOptions().settingsPath, { enabled });
  return status;
}

export function runEnvHistoryRetentionCleanup(force = false) {
  const options = getCodexToolPathOptions();
  const cleanup = envHistoryCleanupQueue.then(() => runEnvHistoryCleanupIfDue({
      stateDir: getStateDir(),
      settingsPath: options.settingsPath,
      force,
    }));
  envHistoryCleanupQueue = cleanup.then(() => undefined, () => undefined);
  return cleanup;
}

export async function stopUsageRouter(): Promise<boolean> {
  return getUsageRouterManager().stopService();
}

export async function setCliAutoResumeSettings(value: CliAutoResumeSettings): Promise<CliAutoResumeSettings> {
  return saveCliAutoResumeSettings(getCodexToolPathOptions().settingsPath, value);
}

export async function getCliTerminalSettings(): Promise<CliTerminalSettings> { return readCliTerminalSettings(getCodexToolPathOptions()); }
export async function scanCliTerminalSettings(): Promise<CliTerminalSettings> { return readCliTerminalSettings(getCodexToolPathOptions()); }
export async function setCliTerminalSelection(id: CliTerminalId): Promise<CliTerminalSettings> {
  const current = await readCliTerminalSettings(getCodexToolPathOptions());
  return saveCliTerminalSelection(getCodexToolPathOptions().settingsPath, id, current.terminals);
}

function getModelCatalogStore() {
  return createModelCatalogStore(join(getStateDir(), "custom-model-catalogs.json"));
}

async function reconcileLegacyModelCatalog(store = getModelCatalogStore()): Promise<void> {
  let remap: Record<string, string>;
  try {
    const snapshot = await store.load();
    remap = await buildLegacyModelProviderRemap(snapshot);
  } catch {
    // Catalog self-healing is best effort. A provider discovery/list request
    // must remain usable even when an old Gateway document is unavailable.
    return;
  }
  if (!Object.keys(remap).length) return;
  try {
    const result = await store.reconcileLegacyProviderIdentities(remap);
    if (!result.changed) return;
    await appendFile(resolveLogPath("switcher"), `${JSON.stringify({
      at: new Date().toISOString(),
      event: "model_catalog_migration",
      migratedModels: result.migratedModels,
      mergedModels: result.mergedModels,
      backupPath: result.backupPath,
    })}\n`, "utf8").catch(() => undefined);
  } catch {
    // Keep the catalog readable if a migration cannot be persisted. The next
    // list/discovery pass will retry after the source state is available.
  }
}

async function buildLegacyModelProviderRemap(
  snapshot: ModelCatalogSnapshot,
): Promise<Record<string, string>> {
  const grouped = new Map<string, ModelCatalogEntry[]>();
  for (const model of snapshot.models) {
    const legacyProviderId = resolveLegacyGatewayProviderId(model.entry);
    if (!legacyProviderId) continue;
    const models = grouped.get(legacyProviderId) ?? [];
    models.push(model.entry);
    grouped.set(legacyProviderId, models);
  }
  if (!grouped.size) return {};

  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const gateways = new Map<string, GatewayEnvironmentState>();
  for (const environment of Object.values(state.envs)) {
    if (environment.gateway?.gatewayId) gateways.set(environment.gateway.gatewayId, environment.gateway);
  }
  const discoveryCandidatesByUpstream = new Map<string, Set<string>>();
  for (const discovery of Object.values(snapshot.accountModelDiscoveries ?? {})) {
    for (const model of discovery.models) {
      if (isLegacyGatewayProviderId(model.providerId)) continue;
      const candidates = discoveryCandidatesByUpstream.get(model.upstreamModelId) ?? new Set<string>();
      candidates.add(model.providerId);
      discoveryCandidatesByUpstream.set(model.upstreamModelId, candidates);
    }
  }

  const remap: Record<string, string> = {};
  for (const [legacyProviderId, entries] of grouped) {
    const gatewayId = parseLegacyGatewayId(legacyProviderId);
    const gateway = gatewayId ? gateways.get(gatewayId) : undefined;
    const candidates = new Set<string>();
    let uniquelyResolved = true;
    for (const entry of entries) {
      const upstreamModelId = resolveCatalogEntryUpstreamModelId(entry);
      if (!upstreamModelId) {
        uniquelyResolved = false;
        break;
      }
      const gatewayCandidates = gateway
        ? new Set(
            Object.values(gateway.models)
              .filter((model) => model.upstreamModelId === upstreamModelId && model.enabled !== false)
              .map((model) => resolveGatewayModelCatalogProviderId(gateway, model))
              .filter((providerId): providerId is string => Boolean(providerId)),
          )
        : new Set<string>();
      // A disabled/removed Gateway may no longer have a persisted environment
      // document. A canonical discovery snapshot is still safe evidence when
      // it is the only provider identity advertising this upstream model.
      const modelCandidates = gatewayCandidates.size
        ? gatewayCandidates
        : discoveryCandidatesByUpstream.get(upstreamModelId) ?? new Set<string>();
      if (modelCandidates.size !== 1) {
        uniquelyResolved = false;
        break;
      }
      candidates.add([...modelCandidates][0]!);
    }
    if (uniquelyResolved && candidates.size === 1) remap[legacyProviderId] = [...candidates][0]!;
  }
  return remap;
}

function resolveLegacyGatewayProviderId(entry: ModelCatalogEntry): string | undefined {
  const providerId = typeof entry.provider_id === "string" ? entry.provider_id.trim() : "";
  if (isLegacyGatewayProviderId(providerId)) return providerId;
  for (const value of [entry.provider_model_key, entry.slug]) {
    if (typeof value !== "string") continue;
    const match = value.trim().match(/^(custom-openai:(?:127\.0\.0\.1|localhost)-\d+:gateways-[^:]+):/i);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function isLegacyGatewayProviderId(value: string): boolean {
  return /^custom-openai:(?:127\.0\.0\.1|localhost)-\d+:gateways-[^:]+$/i.test(value.trim());
}

function parseLegacyGatewayId(providerId: string): string | undefined {
  return providerId.match(/^custom-openai:(?:127\.0\.0\.1|localhost)-\d+:gateways-(.+)$/i)?.[1];
}

function resolveCatalogEntryUpstreamModelId(entry: ModelCatalogEntry): string {
  const configured = typeof entry.upstream_model_id === "string" ? entry.upstream_model_id.trim() : "";
  if (configured) return configured;
  const providerId = typeof entry.provider_id === "string" ? entry.provider_id.trim() : "";
  const providerModelKey = typeof entry.provider_model_key === "string" ? entry.provider_model_key.trim() : "";
  if (providerId && providerModelKey.startsWith(`${providerId}:`)) return providerModelKey.slice(providerId.length + 1).trim();
  if (providerId && entry.slug.startsWith(`${providerId}:`)) return entry.slug.slice(providerId.length + 1).trim();
  return entry.slug.trim();
}

function resolveGatewayModelCatalogProviderId(
  gateway: GatewayEnvironmentState,
  model: GatewayEnvironmentState["models"][string],
): string | undefined {
  const provider = gateway.providers[model.providerId];
  if (!provider) return undefined;
  const endpoint = model.protocols.map((protocol) => (
    protocol === "chat_completions" ? provider.endpoints.chatCompletions
      : protocol === "anthropic" ? provider.endpoints.anthropicMessages
        : protocol === "gemini" ? provider.endpoints.gemini
          : provider.endpoints.responses
  )).find((value): value is string => Boolean(value?.trim()))
    ?? provider.endpoints.responses
    ?? provider.endpoints.chatCompletions
    ?? provider.endpoints.anthropicMessages
    ?? provider.endpoints.gemini;
  if (!endpoint || isLocalRouterBaseUrl(endpoint)) return undefined;
  const runtimeProviderId = provider.kind === "openai" ? "openai" : provider.id;
  return resolveModelCatalogProviderId(runtimeProviderId, endpoint);
}

export async function listCustomModels() {
  const store = getModelCatalogStore();
  await ensureProviderDefaultModels(store);
  await ensureBundledModelCatalog(store);
  await reconcileLegacyModelCatalog(store);
  return filterModelCatalogBindings(
    await store.load(),
    await loadKnownAccountKeys(),
  );
}

export async function listGatewayCapabilityObservations(): Promise<GatewayCapabilityObservationEntry[]> {
  return getUsageRouterManager().listCapabilityObservations();
}

/** Discovers and persists the models visible to one environment account. */
export async function discoverAccountModels(envName: string, accountName: string): Promise<ModelCatalogMutationResult> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const environment = state.envs[envName];
  const account = environment?.accounts[accountName];
  if (!environment || !account) throw new Error(`Account '${envName}/${accountName}' not found`);

  // Recompile the gateway view before discovery as well.  A legacy persisted
  // document can still bind this account to the generic OpenAI provider while
  // the account runtime points at the local Gateway ingress.
  const store = getModelCatalogStore();
  const catalogSnapshot = await store.load();
  const baseGateway = await buildEnvironmentGatewayState(runtime, environment, catalogSnapshot);
  const compiledCredential = Object.values(baseGateway.credentials).find((credential) => (
    credential.secretRef === createAccountSecretRef(envName, accountName)
  ));
  const providerId = compiledCredential?.providerId ?? resolveRuntimeProviderId(account, {
    fallbackProviderId: catalogSnapshot.accountModelDiscoveries?.[accountModelBindingKey(envName, accountName)]?.providerId,
  });
  const catalogIdentity = resolveCatalogProviderIdentity(environment, accountName, account, baseGateway);
  const catalogProviderId = catalogIdentity.providerId;
  const providerDisplayName = catalogIdentity.providerDisplayName;
  const accountKey = accountModelBindingKey(envName, accountName);
  const persistedGatewayCredential = Object.values(environment.gateway?.credentials ?? {})
    .find((credential) => credential.secretRef === createAccountSecretRef(envName, accountName));
  const persistedGatewayProviderId = persistedGatewayCredential?.providerId;
  const discoveryLogContext = {
    gatewayCredentialId: persistedGatewayCredential?.id,
    gatewayCredentialFound: persistedGatewayCredential !== undefined,
    gatewayProviderIdBeforeSync: persistedGatewayProviderId,
    gatewayProviderMismatch: persistedGatewayProviderId !== undefined && persistedGatewayProviderId !== providerId,
  };
  let appRefresh: ModelCatalogAppRefreshRequirement = { required: false, runningWindows: 0 };
  await withAppTargetLifecycleLock(() => store.saveAccountModelDiscovery({
    accountKey,
    providerId: catalogProviderId,
    state: "discovering",
  }));
  await appendModelDiscoveryLog({ envName, accountName, accountKey, providerId, state: "discovering", ...discoveryLogContext });

  let gateway: GatewayEnvironmentState;
  try {
    gateway = createGatewayAccountDiscoveryView(environment, baseGateway, accountName);
    const result = await discoverGatewayAccountModels({
      environment,
      envName,
      accountName,
      gateway,
      providerId,
      stateDir: getStateDir(),
    });
    const models: Array<Omit<AccountDiscoveredModel, "firstSeenAt" | "lastSeenAt" | "status"> & { status?: AccountDiscoveredModel["status"] }> = result.models.map((model) => ({
      providerModelKey: `${catalogProviderId}:${model.upstreamModelId}`,
      providerId: catalogProviderId,
      ...(providerDisplayName ? { providerDisplayName } : {}),
      upstreamModelId: model.upstreamModelId,
      displayName: model.displayName,
      iconKey: providerId,
      protocols: model.protocols,
      capabilities: {
        reasoning: model.capabilities.reasoning === true,
        tools: model.capabilities.tools === true,
        ...(model.capabilityProfile?.["tools.parallel"]?.status === "supported"
          ? { parallelToolCalls: true }
          : {}),
        vision: model.capabilities.vision !== false,
        streaming: model.capabilities.streaming !== false,
      },
      ...(model.capabilityProfile ? { capabilityProfile: model.capabilityProfile } : {}),
      source: model.source ?? "discovery",
      status: "available",
    }));
    await withAppTargetLifecycleLock(async () => {
      await store.saveAccountModelDiscovery({
        accountKey,
        providerId: catalogProviderId,
        state: "ready",
        models,
        discoveredAt: new Date().toISOString(),
      });
      await reconcileLegacyModelCatalog(store);
      // Keep the final discovery write and its projected gateway catalog in
      // the same critical section as App launch and binding mutations.
      // Discovery can add the model that the user is about to bind. If the
      // active App Server was started before this write, it will keep serving
      // its old in-memory catalog until it is restarted. Use the same refresh
      // path as explicit binding changes so discovery and binding cannot leave
      // the picker stale depending on which operation completed last.
      appRefresh = await resynchronizeActiveModelCatalogsUnlocked(accountKey, { updateAppHome: false }).catch(() => ({
        required: false,
        runningWindows: 0,
      }));
    });
    await appendModelDiscoveryLog({
      envName,
      accountName,
      accountKey,
      providerId,
      state: "ready",
      modelCount: models.length,
      modelIds: models.map((model) => model.upstreamModelId),
      ...discoveryLogContext,
    });
  } catch (error) {
    const message = sanitizeModelDiscoveryError(error);
    await withAppTargetLifecycleLock(() => store.saveAccountModelDiscovery({
      accountKey,
      providerId: catalogProviderId,
      state: "failed",
      lastError: message,
    }));
    await appendModelDiscoveryLog({
      envName,
      accountName,
      accountKey,
      providerId,
      state: "failed",
      modelCount: 0,
      error: message,
      ...discoveryLogContext,
    });
  }

  // Do not persist a half-repaired gateway after a failed discovery. A
  // successful result is rebuilt from the synchronized account/provider and
  // model-catalog state in the same critical section as the final discovery
  // write above.
  return { snapshot: await listCustomModels(), appRefresh };
}

/** Refreshes every known account without changing its existing exposure picks. */
export async function refreshAllAccountModels(): Promise<ModelCatalogSnapshot> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const accounts = Object.values(state.envs).flatMap((environment) =>
    Object.keys(environment.accounts).map((accountName) => ({ envName: environment.name, accountName })),
  );
  // The catalog is an atomic file store without a database transaction. Keep
  // writes ordered so two accounts cannot overwrite one another's snapshot.
  for (const { envName, accountName } of accounts) {
    await discoverAccountModels(envName, accountName);
  }
  return listCustomModels();
}

function sanitizeModelDiscoveryError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|key|token)-[A-Za-z0-9._~-]+\b/gi, "[redacted]")
    .slice(0, 500);
}

async function appendModelDiscoveryLog(details: {
  envName: string;
  accountName: string;
  accountKey: string;
  providerId: string;
  state: "discovering" | "ready" | "failed";
  modelCount?: number;
  modelIds?: string[];
  error?: string;
  gatewayCredentialId?: string;
  gatewayCredentialFound?: boolean;
  gatewayProviderIdBeforeSync?: string;
  gatewayProviderMismatch?: boolean;
}): Promise<void> {
  const safeModelIds = details.modelIds?.map((value) => value.replace(/[\r\n]/g, "").slice(0, 160)).slice(0, 200);
  await appendFile(resolveLogPath("switcher"), `${JSON.stringify({
    at: new Date().toISOString(),
    event: "account_model_discovery",
    envName: details.envName,
    accountName: details.accountName,
    accountKey: details.accountKey,
    providerId: details.providerId,
    state: details.state,
    ...(details.modelCount !== undefined ? { modelCount: details.modelCount } : {}),
    ...(safeModelIds?.length ? { modelIds: safeModelIds } : {}),
    ...(details.error ? { error: details.error } : {}),
    ...(details.gatewayCredentialId ? { gatewayCredentialId: details.gatewayCredentialId } : {}),
    ...(details.gatewayCredentialFound !== undefined ? { gatewayCredentialFound: details.gatewayCredentialFound } : {}),
    ...(details.gatewayProviderIdBeforeSync ? { gatewayProviderIdBeforeSync: details.gatewayProviderIdBeforeSync } : {}),
    ...(details.gatewayProviderMismatch ? { gatewayProviderMismatch: true } : {}),
  })}\n`, "utf8").catch(() => undefined);
}

async function appendAppLifecycleLog(details: {
  event: "app_launch_started" | "app_catalog_ready" | "app_launch_completed" | "app_launch_failed";
  envName: string;
  accountName: string;
  mode: AppWindowLaunchMode;
  codexHome: string;
  catalogPath: string;
  desiredCount?: number;
  error?: string;
}): Promise<void> {
  await appendFile(resolveLogPath("switcher"), `${JSON.stringify({
    at: new Date().toISOString(),
    ...details,
  })}\n`, "utf8").catch(() => undefined);
}

export async function listProviderCatalog() {
  const runtime = await loadGatewayProviderRuntime();
  const builtIns: import("../src/bridge.js").ProviderCatalogItem[] = runtime.canonicalProviderDefinitions().map((definition) => {
    const protocols = [...new Set(definition.endpoints.map((endpoint) => endpoint.protocol))];
    return {
      id: definition.id,
      displayName: definition.displayName,
      category: definition.category ?? "custom",
      iconKey: definition.iconKey ?? "custom",
      ...(definition.endpoints[0]?.baseUrl ? { defaultBaseUrl: definition.endpoints[0].baseUrl } : {}),
      ...(definition.aliasOf ? { aliasOf: definition.aliasOf } : {}),
      authMethods: [...definition.authMethods],
      protocols,
      discoveryMode: definition.endpoints.some((endpoint) => endpoint.modelsPath)
        ? (definition.category === "local" ? "local" : "remote")
        : "manual",
      capabilities: {
        modelDiscovery: definition.endpoints.some((endpoint) => Boolean(endpoint.modelsPath)),
        quota: definition.endpoints.some((endpoint) => Boolean(endpoint.quotaPath)),
        tokenRefresh: definition.authMethods.includes("oauth") || definition.authMethods.includes("subscription"),
        accountPool: true,
        // The Gateway ingress is Responses. Every supported non-Responses
        // upstream protocol is converted by the shared protocol adapter.
        protocolConversion: protocols.some((protocol) => protocol !== "responses"),
      },
    };
  });
  const byId = new Map(builtIns.map((item) => [item.id, item]));
  // A provider plugin is part of the account onboarding catalog as soon as it
  // is installed and active. Keep built-ins authoritative on id collisions.
  const plugins = await listProviderPluginsRuntime(getStateDir());
  for (const plugin of plugins) {
    const provider = plugin.provider;
    if (!provider || byId.has(provider.id)) continue;
    const protocols = [...new Set(provider.endpoints.map((endpoint) => endpoint.protocol))];
    const iconUrl = plugin.icon && /^(?:https?:|data:|file:)/i.test(plugin.icon) ? plugin.icon : undefined;
    byId.set(provider.id, {
      id: provider.id,
      displayName: provider.displayName,
      category: "custom" as const,
      iconKey: iconUrl ? "custom" : provider.id,
      ...(iconUrl ? { iconUrl } : {}),
      pluginId: plugin.id,
      ...(provider.managed ? { managed: true } : {}),
      ...(provider.endpoints[0]?.baseUrl ? { defaultBaseUrl: provider.endpoints[0].baseUrl } : {}),
      authMethods: [...provider.authMethods],
      protocols,
      discoveryMode: "plugin",
      capabilities: {
        modelDiscovery: provider.endpoints.some((endpoint) => Boolean(endpoint.modelsPath)),
        quota: provider.endpoints.some((endpoint) => Boolean(endpoint.quotaPath)),
        tokenRefresh: provider.authMethods.includes("oauth") || provider.authMethods.includes("subscription"),
        accountPool: true,
        protocolConversion: protocols.some((protocol) => protocol !== "responses"),
      },
    });
  }
  return [...byId.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export async function saveCustomModel(input: SaveCustomModelInput) {
  const { appRefresh } = await mutateModelCatalog(
    () => getModelCatalogStore().saveModel(input),
  );
  return { snapshot: await listCustomModels(), appRefresh } satisfies ModelCatalogMutationResult;
}

export async function deleteCustomModel(id: string) {
  const { appRefresh } = await mutateModelCatalog(
    () => getModelCatalogStore().deleteModel(id),
  );
  return { snapshot: await listCustomModels(), appRefresh } satisfies ModelCatalogMutationResult;
}

export async function setAccountModelBindings(accountKey: string, modelIds: string[]) {
  const { result: snapshot, appRefresh } = await mutateModelCatalog(async () => {
    const store = getModelCatalogStore();
    const currentCatalog = await store.load();
    const discovery = currentCatalog.accountModelDiscoveries?.[accountKey];
    const hasBundledSelection = modelIds.some((modelId) => (
      currentCatalog.models.find((model) => model.id === modelId)?.entry.model_source === "bundled"
    ));
    if (hasBundledSelection || discovery?.state === "failed" || (discovery?.state === "ready" && !discovery.models.some((model) => model.status === "available"))) {
      const separator = accountKey.indexOf("/");
      if (separator < 1 || separator === accountKey.length - 1) throw new Error(`Invalid account model key '${accountKey}'`);
      const envName = accountKey.slice(0, separator);
      const accountName = accountKey.slice(separator + 1);
      const runtime = await loadCoreRuntime();
      const state = await runtime.readLegacyState(getLegacyOptions());
      const environment = state.envs[envName];
      const account = environment?.accounts[accountName];
      if (!account) throw new Error(`Account '${envName}/${accountName}' not found`);
      // Codex subscriptions already receive the bundled catalog natively. Keep
      // their explicit selection as-is; API-key accounts need a provider
      // qualified alias so the same bundled model cannot collide with the
      // official model slug in the gateway catalog.
      if (hasBundledSelection && account.authMode === "auth") {
        return store.setAccountBindings(accountKey, modelIds, undefined, true);
      }
      const catalogIdentity = resolveCatalogProviderIdentity(environment!, accountName, account);
      return store.setAccountBindingsFromCatalog({
        accountKey,
        modelIds,
        providerId: catalogIdentity.providerId,
        ...(catalogIdentity.providerDisplayName ? { providerDisplayName: catalogIdentity.providerDisplayName } : {}),
        protocol: account.authMode === "auth" ? "responses" : account.runtime.apiProtocol ?? "responses",
        preserveHistoricalBindings: true,
      });
    }
    return store.setAccountBindings(accountKey, modelIds, undefined, true);
  }, accountKey);
  return {
    snapshot: filterModelCatalogBindings(snapshot, await loadKnownAccountKeys()),
    appRefresh,
  } satisfies ModelCatalogMutationResult;
}

export async function setModelAccountBindings(
  modelId: string,
  accountKeys: string[],
  optionsByAccount?: Record<string, ModelBindingOptions>,
) {
  const { result: snapshot, appRefresh } = await mutateModelCatalog(
    () => getModelCatalogStore().setModelBindings(modelId, accountKeys, optionsByAccount),
  );
  return {
    snapshot: filterModelCatalogBindings(snapshot, await loadKnownAccountKeys()),
    appRefresh,
  } satisfies ModelCatalogMutationResult;
}

async function loadKnownAccountKeys(): Promise<ReadonlySet<string>> {
  const state = await (await loadCoreRuntime()).readLegacyState(getLegacyOptions());
  return new Set(
    Object.values(state.envs).flatMap((env) =>
      Object.keys(env.accounts).map((accountName) => accountModelBindingKey(env.name, accountName)),
    ),
  );
}

async function resynchronizeActiveModelCatalogs(
  accountKey?: string,
  options: { restartRunningApp?: boolean; updateAppHome?: boolean } = {},
): Promise<ModelCatalogAppRefreshRequirement> {
  return withAppTargetLifecycleLock(() => resynchronizeActiveModelCatalogsUnlocked(accountKey, options));
}

async function resynchronizeActiveModelCatalogsUnlocked(
  accountKey?: string,
  options: { restartRunningApp?: boolean; updateAppHome?: boolean } = {},
): Promise<ModelCatalogAppRefreshRequirement> {
  const runtime = await loadCoreRuntime();
  let state = await runtime.readLegacyState(getLegacyOptions());
  // Keep the live router's route records current after a catalog mutation,
  // but do not project the same state into the active App home while the user
  // is still deciding whether to restart Codex. Writing config.toml or the
  // catalog JSON here causes Codex App's file watcher to restart it.
  state = await resynchronizeActiveEnvironmentGatewaysUnlocked(runtime, state, undefined, {
    updateTargetHome: options.updateAppHome !== false,
  });
  const appEnvironmentName = state.targets.app.env;
  for (const target of ["cli", "app"] as const) {
    const pointer = state.targets[target];
    const targetKey = `${pointer.env}/${pointer.account}`;
    const gatewayActive = state.envs[pointer.env]?.gateway?.mode === "gateway";
    // The CLI and App may intentionally share one managed environment home.
    // Do not rewrite either target's projected files while a model mutation is
    // waiting for confirmation; Codex App watches those files and can restart
    // itself even when the switcher did not request a restart.
    if (options.updateAppHome === false && pointer.env === appEnvironmentName) continue;
    if (target === "app" && options.updateAppHome === false) continue;
    if (!accountKey || targetKey === accountKey || gatewayActive) {
      await applyTargetHomeStateWithHistoryUnlocked(
        runtime,
        state,
        target,
        target === "cli" ? "switch-cli" : "switch-app",
      );
    }
  }

  // Codex App Server caches model_catalog_json at startup. Report whether the
  // currently selected environment has a running App that needs confirmation;
  // only the explicit refresh action below passes restartRunningApp=true.
  let appRefresh: ModelCatalogAppRefreshRequirement = { required: false, runningWindows: 0 };
  if (state.envs[state.targets.app.env]) {
    const support = await loadCoreSupportModules();
    const paths = support.resolveManagedAppStatePaths(getStateDir());
    const runningCount = await support.reconcileManagedAppInstanceCount(paths, state.targets.app.env).catch(() => undefined);
    if (runningCount !== undefined && runningCount > 0) {
      appRefresh = {
        required: true,
        envName: state.targets.app.env,
        runningWindows: runningCount,
      };
    }
    if (options.restartRunningApp && appRefresh.required) {
      await launchAppTargetUnlocked(state, runtime, "reconcile");
    }
  }
  return appRefresh;
}

async function resynchronizeActiveEnvironmentGateways(
  runtime: Awaited<ReturnType<typeof loadCoreRuntime>>,
  initialState: Awaited<ReturnType<Awaited<ReturnType<typeof loadCoreRuntime>>["readLegacyState"]>>,
  onlyEnvName?: string,
): Promise<Awaited<ReturnType<Awaited<ReturnType<typeof loadCoreRuntime>>["readLegacyState"]>>> {
  return withAppTargetLifecycleLock(() => resynchronizeActiveEnvironmentGatewaysUnlocked(runtime, initialState, onlyEnvName));
}

/**
 * Rebuild the active target catalog and restart the currently managed Codex
 * App after the user explicitly confirms a model-list refresh.
 */
export async function refreshCodexAppModelCatalog(): Promise<DesktopActionResult> {
  const refresh = await resynchronizeActiveModelCatalogs(undefined, { restartRunningApp: true, updateAppHome: true });
  return {
    message: refresh.required
      ? `Codex App model catalog refreshed for ${refresh.envName ?? "the active environment"}`
      : "No running managed Codex App required a model catalog refresh",
  };
}

async function resynchronizeActiveEnvironmentGatewaysUnlocked(
  runtime: Awaited<ReturnType<typeof loadCoreRuntime>>,
  initialState: Awaited<ReturnType<Awaited<ReturnType<typeof loadCoreRuntime>>["readLegacyState"]>>,
  onlyEnvName?: string,
  options: { updateTargetHome?: boolean } = {},
): Promise<Awaited<ReturnType<Awaited<ReturnType<typeof loadCoreRuntime>>["readLegacyState"]>>> {
  let state = initialState;
  const activeGateways = (await getUsageRouterManager().listPersistedEnvironmentGateways())
    .filter((item) => item.enabled && (!onlyEnvName || item.envName === onlyEnvName));
  for (const activeGateway of activeGateways) {
    const environment = state.envs[activeGateway.envName];
    if (!environment) continue;
    const generated = await buildEnvironmentGatewayState(runtime, environment);
    const gateway: GatewayEnvironmentState = {
      ...generated,
      mode: "gateway",
      gatewayId: activeGateway.gatewayId ?? generated.gatewayId,
      // Reconciliation is a no-op when the compiled route/catalog is
      // unchanged. Keep the persisted version stable so repeated discovery
      // cannot create a restart loop in Codex App.
      catalogVersion: generated.catalogVersion,
    };
    await runtime.writeLegacyGateway({ stateDir: getStateDir(), envName: environment.name, gateway });
    state = await runtime.readLegacyState(getLegacyOptions());
    const accounts = await getEnvironmentGatewayRouteAccounts(state, environment.name, gateway);
    const updateBaseUrl = createEnvironmentRouteBaseUrlUpdater(runtime, environment.name, {
      applyTargetHome: options.updateTargetHome !== false,
    });
    await getUsageRouterManager().enableEnvironmentGateway(
      environment.name,
      accounts,
      updateBaseUrl,
      gateway.routeGroups,
      buildGatewayRouteBindings(state.envs[environment.name]!, gateway),
      gateway.routeRules ?? [],
      gateway.defaultRouteGroupId,
    );
    if (options.updateTargetHome !== false) {
      const bundledCatalog = await loadBundledCatalogForCurrentInstall();
      await synchronizeEnvironmentGatewayModelCatalog({
        homePath: environment.path,
        gateway,
        modelCatalog: await getModelCatalogStore().load(),
        environmentName: environment.name,
        diagnosticLogPath: resolveLogPath("switcher"),
        loadBundledCatalog: bundledCatalog ? async () => bundledCatalog : undefined,
      });
    }
  }
  return state;
}

async function getEffectiveCodexEnv(): Promise<NodeJS.ProcessEnv> {
  return buildEffectiveCodexEnv(await getCodexToolPaths(), process.env);
}

async function requireCodexCliPath(): Promise<string> {
  const status = await getCodexToolStatus("cli", getCodexToolPathOptions());
  if (!status.available) throw new Error("Codex CLI not found. Configure its installation path on the Operations page.");
  return status.path;
}

export async function logoutAccount(
  envName: string,
  accountName: string,
  target: "cli" | "app" | "both",
): Promise<DesktopActionResult> {
  return (await loadDesktopOperationsService()).logoutAccount({
    envName,
    accountName,
    target,
  });
}

export async function deleteAccount(envName: string, accountName: string): Promise<DesktopActionResult> {
  return (await loadDesktopOperationsService()).deleteAccount({
    envName,
    accountName,
  });
}

function resolveCopiedAccountName(
  existingNames: string[],
  sourceAccountName: string,
  preserveOriginalName: boolean,
): string {
  const existing = new Set(existingNames);
  if (preserveOriginalName && !existing.has(sourceAccountName)) return sourceAccountName;
  const base = `${sourceAccountName}-copy`;
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export async function copyAccount(
  sourceEnvName: string,
  sourceAccountName: string,
  targetEnvName: string,
): Promise<DesktopActionResult> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const source = state.envs[sourceEnvName]?.accounts[sourceAccountName];
  if (!source) throw new Error(`Account '${sourceEnvName}/${sourceAccountName}' not found`);
  const targetEnv = state.envs[targetEnvName];
  if (!targetEnv) throw new Error(`Env '${targetEnvName}' not found`);

  const targetAccountRoot = join(getStateDir(), "env-accounts", targetEnvName);
  const onDiskAccountNames = await readdir(targetAccountRoot).catch(() => []);
  const targetAccountName = resolveCopiedAccountName(
    [...Object.keys(targetEnv.accounts), ...onDiskAccountNames],
    sourceAccountName,
    targetEnvName !== sourceEnvName,
  );
  const sourceKey = `${sourceEnvName}/${sourceAccountName}`;
  const targetKey = `${targetEnvName}/${targetAccountName}`;
  const sourceDir = join(getStateDir(), "env-accounts", sourceEnvName, sourceAccountName);
  const targetDir = join(targetAccountRoot, targetAccountName);
  const routes = await getUsageRouterManager().listRoutesIfRunning().catch(() => []);
  const compatibilityEnabled = source.runtime.compatibilityRouteEnabled === true;
  const sourceRoute = routes.find((route) =>
    route.envName === sourceEnvName
      && route.accountName === sourceAccountName
      && (!compatibilityEnabled || route.protocol === "chat_completions"),
  );
  if (compatibilityEnabled && sourceRoute?.protocol !== "chat_completions") {
    throw new Error("The source compatibility route is unavailable. Reopen it before copying this account.");
  }
  const originalBaseUrl = sourceRoute?.originalBaseUrl
    ?? (source.runtime.openaiBaseUrlMode === "custom" ? source.runtime.openaiBaseUrl : "default")
    ?? "default";
  const copiedRuntime = {
    ...source.runtime,
    openaiBaseUrlMode: originalBaseUrl === "default" ? "default" as const : "custom" as const,
    openaiBaseUrl: originalBaseUrl === "default" ? undefined : originalBaseUrl,
    apiProtocol: compatibilityEnabled ? "responses" as const : source.runtime.apiProtocol,
    compatibilityRouteEnabled: false,
    compatibilityRouteBaseUrl: undefined,
    compatibilityRouteToken: undefined,
    compatibilityRouteProviderId: undefined,
  };
  const sourceDirExists = await lstat(sourceDir).then((entry) => entry.isDirectory()).catch(() => false);
  const sourceAuthFile = await resolveAuthFile(sourceEnvName, sourceAccountName, state.envs[sourceEnvName]!.path);
  const sourceAuthContent = sourceAuthFile ? await readFile(sourceAuthFile, "utf8") : undefined;

  try {
    if (sourceDirExists) {
      await cp(sourceDir, targetDir, { recursive: true, errorOnExist: true, force: false });
    } else {
      await mkdir(targetDir, { recursive: false });
    }
    if (sourceAuthContent) {
      await writeFile(join(targetDir, "auth.json"), sourceAuthContent, "utf8");
    }
    await runtime.writeLegacyRuntime({
      stateDir: getStateDir(),
      envName: targetEnvName,
      accountName: targetAccountName,
      runtime: copiedRuntime,
    });

    const catalog = await getModelCatalogStore().load();
    const sourceModelIds = catalog.accountBindings[sourceKey] ?? [];
    const sourceBindingOptions = Object.fromEntries(
      sourceModelIds
        .map((modelId) => [modelId, catalog.accountBindingOptions?.[sourceKey]?.[modelId] ?? {}] as const)
        .filter(([, options]) => Object.keys(options).length),
    );
    await getModelCatalogStore().setAccountBindings(
      targetKey,
      sourceModelIds,
      sourceBindingOptions,
    );

    await syncEnvironmentRouteIfEnabled(targetEnvName);
    if (compatibilityEnabled) {
      await enableAccountCompatibility({
        envName: targetEnvName,
        accountName: targetAccountName,
        upstreamModel: source.runtime.compatibilityUpstreamModel,
        reasoningProfile: source.runtime.compatibilityReasoningProfile,
        longConversationStrategy: source.runtime.compatibilityLongConversationStrategy,
        instructionRole: source.runtime.compatibilityInstructionRole,
        requestOverrides: source.runtime.compatibilityRequestOverrides,
      });
    }
  } catch (error) {
    await getUsageRouterManager().removeAccountRoutes(targetEnvName, targetAccountName).catch(() => undefined);
    await getModelCatalogStore().setAccountBindings(targetKey, []).catch(() => undefined);
    await rm(targetDir, { recursive: true, force: true });
    throw error;
  }

  return {
    message: `Copied account to ${targetKey}`,
    output: `${targetKey}\n`,
  };
}

export async function showProxy(): Promise<DesktopActionResult> {
  return (await loadDesktopOperationsService()).getProxyStatus();
}

export async function setProxy(value: string): Promise<DesktopActionResult> {
  return (await loadDesktopOperationsService()).setProxy({ value });
}

export async function restoreProxyAutoDetect(): Promise<DesktopActionResult> {
  return (await loadDesktopOperationsService()).restoreProxyAutoDetect();
}

export async function disableProxy(): Promise<DesktopActionResult> {
  return (await loadDesktopOperationsService()).disableProxy();
}

export async function testProxy(): Promise<DesktopActionResult> {
  return await loadDesktopOperationsService().then((service) => service.testProxy());
}

export async function startTokenRefresh(): Promise<DesktopActionResult> {
  return (await loadDesktopOperationsService()).startTokenRefreshGuard();
}

export async function stopTokenRefresh(): Promise<DesktopActionResult> {
  return (await loadDesktopOperationsService()).stopTokenRefreshGuard();
}

export async function readTokenRefreshStatus(): Promise<DesktopActionResult> {
  return (await loadDesktopOperationsService()).getTokenRefreshStatus();
}

export async function runTokenRefreshOnce(): Promise<DesktopActionResult> {
  return await loadDesktopOperationsService().then((service) => service.runTokenRefreshOnce());
}

export async function listOperations(): Promise<DesktopActionResult> {
  return (await loadDesktopOperationsService()).listOperations();
}

export async function importDefaultEnv(
  envName: string,
  options?: {
    withAuth?: boolean;
    force?: boolean;
  },
): Promise<DesktopActionResult> {
  const trimmedEnvName = envName.trim();
  if (!trimmedEnvName) {
    throw new Error("Env name is required");
  }
  const runtime = await loadCoreRuntime();
  await importDefaultEnvDirect(runtime, trimmedEnvName, options);
  return {
    message: `Imported default env into ${trimmedEnvName}`,
    output: `${trimmedEnvName}\n`,
  };
}

export async function launchCliInTerminal(): Promise<DesktopActionResult> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  await applyTargetHomeStateWithHistory(runtime, state, "cli", "switch-cli");
  const warning = await openCommandInPreferredTerminal(["cli", "launch-current"]);
  return {
    message: `${getCliLaunchSuccessMessage()}${warning ? `. ${warning}` : ""}`,
  };
}

export async function readAppStatus(): Promise<DesktopActionResult> {
  return (await loadDesktopOperationsService()).getAppStatus();
}

export async function logoutApp(accountName?: string): Promise<DesktopActionResult> {
  return (await loadDesktopOperationsService()).logoutApp({
    accountName: accountName?.trim() || undefined,
  });
}

export async function stopManagedApp(): Promise<DesktopActionResult> {
  return (await loadDesktopOperationsService()).stopManagedApp();
}

export async function runDoctor(): Promise<DesktopActionResult> {
  return await loadDesktopOperationsService().then((service) => service.runDoctor());
}

export async function runRecover(): Promise<DesktopActionResult> {
  return await loadDesktopOperationsService().then((service) => service.runRecover());
}

export async function readSwitcherLog(): Promise<{ kind: "switcher"; content: string }> {
  return {
    kind: "switcher",
    content: (await readTextFileOrEmpty(resolveLogPath("switcher"))) || "",
  };
}

export async function readTokenRefreshLog(): Promise<{ kind: "token-refresh"; content: string }> {
  return {
    kind: "token-refresh",
    content: (await readTextFileOrEmpty(resolveLogPath("token-refresh"))) || "",
  };
}

async function openCommandInPreferredTerminal(
  commandArgs: string[],
  strategy: "current-window" | "new-window" = "new-window",
  workingDirectory?: string,
): Promise<string | undefined> {
  const launchId = `${process.pid}-${++terminalLaunchSequence}`;
  const launchKey = JSON.stringify([strategy, workingDirectory?.trim() || ""]);
  await appendTerminalLaunchDebug(launchId, "request", { commandArgs, strategy, workingDirectory, launchKey });
  return terminalLaunchGate.run(launchKey, () => openCommandInPreferredTerminalOnce(commandArgs, strategy, workingDirectory, launchId));
}

async function openCommandInPreferredTerminalOnce(
  commandArgs: string[],
  strategy: "current-window" | "new-window",
  workingDirectory?: string,
  launchId = "unknown",
): Promise<string | undefined> {
  const repoRoot = getRepoRoot();
  const codexHome = await resolveCliTargetHome();
  const codexBin = await requireCodexCliPath();
  const launchRuntime = await loadCoreRuntime();
  const launchState = await launchRuntime.readLegacyState(getLegacyOptions());
  const launchPointer = launchState.targets.cli;
  const launchAccount = launchState.envs[launchPointer.env]?.accounts[launchPointer.account];
  const apiKeySourcePath = launchAccount?.authData && readAuthStringField(launchAccount.authData, "OPENAI_API_KEY")
    ? join(getStateDir(), "env-accounts", launchPointer.env, launchPointer.account, "auth.json")
    : undefined;
  const launchDirectory = strategy === "current-window"
    ? undefined
    : await resolveCliWorkingDirectory(workingDirectory);
  const effectiveWorkingDirectory = launchDirectory
    ?? await resolveCurrentTerminalWorkingDirectory()
    ?? await resolveCliWorkingDirectory(workingDirectory);
  const requestedArgs = commandArgs[0] === "cli" && commandArgs[1] === "launch-current" ? [] : commandArgs;
  const autoResume = await getCliAutoResumeSettings();
  let codexArgs = requestedArgs;
  let warning: string | undefined;
  if (requestedArgs.length === 0 && autoResume.enabled) {
    const session = await findCodexResumeSession(codexHome, effectiveWorkingDirectory, autoResume.sessionNumber);
    if (session) codexArgs = ["resume", session.id];
    else {
      warning = `Auto resume skipped: session ${autoResume.sessionNumber} was not found for this project`;
      await appendTerminalLaunchDebug(launchId, "auto-resume-warning", { message: warning });
    }
  }
  const terminalSettings = await getCliTerminalSettings();
  const launchEnv = terminalSettings.terminals.some((item) => item.id === "powershell7")
    ? { ...await getEffectiveCodexEnv(), CODEX_SWITCHER_WINDOWS_PWSH_AVAILABLE: "1" }
    : await getEffectiveCodexEnv();
  const plan = buildCliTerminalLaunchPlan({
    repoRoot,
    workingDirectory: launchDirectory,
    codexHome,
    codexBin,
    platform: process.platform,
    env: launchEnv,
    launchMode: strategy,
    args: codexArgs,
    terminalId: terminalSettings.selectedId,
    apiKeySourcePath,
  });
  await appendTerminalLaunchDebug(launchId, "plan", {
    platform: plan.platform,
    launchMode: plan.launchMode,
    effectiveWorkingDirectory,
    codexArgs,
    attempts: plan.attempts.map((attempt) => ({ command: attempt.command, args: attempt.args })),
  });

  let lastError: unknown = null;
  for (const attempt of plan.attempts) {
    try {
      const result = await execFileAsync(attempt.command, attempt.args, {
        cwd: repoRoot,
        env: launchEnv,
      });
      await appendTerminalLaunchDebug(launchId, "attempt-success", {
        command: attempt.command,
        stdout: result.stdout,
        stderr: result.stderr,
      });
      return warning;
    } catch (error) {
      lastError = error;
      await appendTerminalLaunchDebug(launchId, "attempt-error", {
        command: attempt.command,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (lastError) {
    if (typeof lastError === "object" && lastError && "stderr" in lastError) {
      const stderr = String((lastError as { stderr?: string }).stderr ?? "").trim();
      if (stderr) {
        throw new Error(stderr);
      }
    }
    throw lastError;
  }

  throw new Error("Unable to open CLI in a terminal on this platform");
}

async function appendTerminalLaunchDebug(
  launchId: string,
  stage: string,
  details: Record<string, unknown>,
): Promise<void> {
  const path = join(getStateDir(), "terminal-launch-debug.log");
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify({ at: new Date().toISOString(), launchId, stage, ...details })}\n`, "utf8");
}

function createTerminalLaunchGate(windowMs: number) {
  let recent: { key: string; startedAt: number; result: Promise<string | undefined> } | undefined;
  return {
    run(key: string, launch: () => Promise<string | undefined>, now = Date.now()): Promise<string | undefined> {
      if (recent && recent.key === key && now - recent.startedAt < windowMs) return recent.result;
      const result = launch();
      recent = { key, startedAt: now, result };
      return result;
    },
  };
}

async function resolveCliTargetHome(): Promise<string> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const pointer = state.targets.cli;
  const env = state.envs[pointer.env];
  if (!env) {
    throw new Error(`CLI env '${pointer.env}' not found`);
  }
  return env.path;
}

async function resolveCliWorkingDirectory(value?: string): Promise<string> {
  const path = value?.trim() || homedir();
  const info = await lstat(path).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`CLI working directory does not exist: ${path}`);
  return path;
}

async function resolveCurrentTerminalWorkingDirectory(): Promise<string | undefined> {
  if (process.platform !== "darwin") return undefined;
  const terminal = resolveMacOsTerminal(process.env);
  if (terminal === "iterm") {
    const script = `using terms from application "iTerm"
tell application "iTerm"
if (count of windows) is 0 then return ""
tell current session of current window
return variable named "session.path"
end tell
end tell
end using terms from`;
    const result = await execFileAsync("osascript", ["-e", script]).catch(() => undefined);
    const path = result?.stdout.trim();
    if (path && (await lstat(path).catch(() => null))?.isDirectory()) return path;
  }
  return undefined;
}

function buildCliTerminalLaunchPlan(input: {
  repoRoot: string;
  workingDirectory?: string;
  codexHome: string;
  codexBin: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  launchMode?: "current-window" | "new-window";
  args?: string[];
  terminalId?: CliTerminalId;
  apiKeySourcePath?: string;
}): CliTerminalLaunchPlan {
  const platform = detectPlatformLocal(input.platform);
  const codexArgs = input.args ?? [];
  const launchMode = input.launchMode ?? "new-window";

  if (platform === "windows") {
    return buildWindowsCliTerminalLaunchPlan({
      repoRoot: input.repoRoot,
      workingDirectory: input.workingDirectory,
      codexHome: input.codexHome,
      codexBin: input.codexBin,
      env: input.env,
      args: codexArgs,
      terminalId: input.terminalId,
      apiKeySourcePath: input.apiKeySourcePath,
    });
  }

  const shellCommand = buildUnixCliLaunchCommand({
    repoRoot: input.repoRoot,
    workingDirectory: input.workingDirectory,
    codexHome: input.codexHome,
    codexBin: input.codexBin,
    args: codexArgs,
    apiKeySourcePath: input.apiKeySourcePath,
  });

  if (platform === "macos") {
    const terminal = input.terminalId ?? resolveMacOsTerminal(input.env);
    if (terminal === "warp" || terminal === "ghostty") {
      const executable = terminal === "warp" ? "/Applications/Warp.app" : "/Applications/Ghostty.app";
      return { platform, launchMode: "new-window", attempts: [{ command: "open", args: ["-na", executable, "--args", "-e", "/bin/zsh", "-lc", shellCommand] }] };
    }
    const appleScript = terminal === "iterm"
      ? (launchMode === "current-window" ? buildCurrentITermAppleScript(shellCommand) : buildITermAppleScript(shellCommand))
      : (launchMode === "current-window" ? buildCurrentTerminalAppleScript(shellCommand) : buildTerminalAppleScript(shellCommand));
    return {
      platform,
      launchMode,
      attempts: [
        {
          command: "osascript",
          args: ["-e", appleScript],
        },
      ],
    };
  }

  return {
    platform,
    launchMode,
    attempts: [
      {
        command: "sh",
        args: ["-lc", shellCommand],
      },
    ],
  };
}

function resolveMacOsTerminal(env: NodeJS.ProcessEnv | undefined): "iterm" | "terminal" {
  const configured = env?.CODEX_SWITCHER_MACOS_TERMINAL?.trim().toLowerCase();
  if (configured === "terminal" || configured === "apple-terminal") return "terminal";
  if (configured === "iterm" || configured === "iterm2") return "iterm";
  return existsSync("/Applications/iTerm.app") ? "iterm" : "terminal";
}

function buildWindowsCliTerminalLaunchPlan(input: {
  repoRoot: string;
  workingDirectory?: string;
  codexHome: string;
  codexBin: string;
  env?: NodeJS.ProcessEnv;
  args: string[];
  terminalId?: CliTerminalId;
  apiKeySourcePath?: string;
}): CliTerminalLaunchPlan {
  const launcher = input.terminalId ?? (input.env?.CODEX_SWITCHER_WINDOWS_CLI_LAUNCHER || "powershell").toLowerCase();
  const cmdCommand = buildWindowsCmdLaunchCommand(input);
  const powerShellCommand = buildWindowsPowerShellLaunchCommand(input);
  if (launcher === "wt" || launcher === "windows-terminal" || launcher === "wt.exe") {
    const shell = input.env?.CODEX_SWITCHER_WINDOWS_PWSH_AVAILABLE === "1" ? "pwsh.exe" : "powershell.exe";
    return {
      platform: "windows",
      launchMode: "new-window",
      attempts: [
        {
          command: "wt.exe",
          args: [
            "-w",
            "new",
            shell,
            "-NoExit",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            powerShellCommand,
          ],
        },
      ],
    };
  }

  if (launcher === "powershell7" || launcher === "pwsh" || launcher === "pwsh.exe") {
    return {
      platform: "windows", launchMode: "new-window",
      attempts: [{ command: "pwsh.exe", args: ["-NoProfile", "-NoExit", "-Command", powerShellCommand] }],
    };
  }

  if (launcher === "windows-powershell" || launcher === "powershell" || launcher === "powershell.exe") {
    return {
      platform: "windows",
      launchMode: "new-window",
      attempts: [
        {
          command: "powershell.exe",
          args: [
            "-NoProfile",
            "-NoExit",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            buildWindowsPowerShellLaunchCommand(input),
          ],
        },
      ],
    };
  }

  return {
    platform: "windows",
    launchMode: "new-window",
    attempts: [
      {
        command: "cmd.exe",
        args: ["/d", "/k", cmdCommand],
      },
    ],
  };
}

function buildUnixCliLaunchCommand(input: {
  repoRoot: string;
  workingDirectory?: string;
  codexHome: string;
  codexBin: string;
  args: string[];
  apiKeySourcePath?: string;
}): string {
  const parts = [
    input.workingDirectory ? `cd ${quoteShellArg(input.workingDirectory)}` : "",
    `export CODEX_HOME=${quoteShellArg(input.codexHome)}`,
    buildUnixApiKeyExport(input.codexHome, input.apiKeySourcePath),
    [quoteShellArg(input.codexBin), ...input.args.map(quoteShellArg)].join(" "),
  ].filter(Boolean);
  return parts.join(" && ");
}

function buildUnixApiKeyExport(codexHome: string, apiKeySourcePath?: string): string {
  const script = 'const fs=require("node:fs");const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).OPENAI_API_KEY||"";process.stdout.write(String(value));';
  const command = ["node", "-e", quoteShellArg(script), quoteShellArg(apiKeySourcePath ?? join(codexHome, "auth.json"))].join(" ");
  return `export OPENAI_API_KEY="$(${command})"`;
}

function buildWindowsCmdLaunchCommand(input: {
  repoRoot: string;
  workingDirectory?: string;
  codexHome: string;
  codexBin: string;
  args: string[];
  apiKeySourcePath?: string;
}): string {
  const authPath = input.apiKeySourcePath ?? join(input.codexHome, "auth.json");
  return [
    `cd /d "${escapeCmdDoubleQuoted(input.workingDirectory ?? input.repoRoot)}"`,
    `set "CODEX_HOME=${escapeCmdDoubleQuoted(input.codexHome)}"`,
    `for /f "usebackq delims=" %A in (\`powershell.exe -NoProfile -Command "(Get-Content -Raw '${escapePowerShellSingleQuoted(authPath)}' | ConvertFrom-Json).OPENAI_API_KEY"\`) do set "OPENAI_API_KEY=%A"`,
    [quoteCmdArg(input.codexBin), ...input.args.map(quoteCmdArg)].join(" "),
  ].join(" && ");
}

function buildWindowsPowerShellLaunchCommand(input: {
  repoRoot: string;
  workingDirectory?: string;
  codexHome: string;
  codexBin: string;
  args: string[];
  apiKeySourcePath?: string;
}): string {
  const authPath = input.apiKeySourcePath ?? join(input.codexHome, "auth.json");
  const invocation = [
    `& '${escapePowerShellSingleQuoted(input.codexBin)}'`,
    ...input.args.map((arg) => `'${escapePowerShellSingleQuoted(arg)}'`),
  ].join(" ");
  return [
    `Set-Location '${escapePowerShellSingleQuoted(input.workingDirectory ?? input.repoRoot)}'`,
    `$env:CODEX_HOME='${escapePowerShellSingleQuoted(input.codexHome)}'`,
    `$env:OPENAI_API_KEY=(Get-Content -Raw '${escapePowerShellSingleQuoted(authPath)}' | ConvertFrom-Json).OPENAI_API_KEY`,
    invocation,
  ].join("; ");
}

async function readTextFileOrEmpty(path: string): Promise<string> {
  return readFile(path, "utf8").catch(() => "");
}

async function writeTextFileRaw(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function applyTargetHomeStateWithHistory(
  runtime: CoreRuntime,
  state: Awaited<ReturnType<CoreRuntime["readLegacyState"]>>,
  target: "cli" | "app",
  source: EnvFileHistorySource,
  authProjection?: "selected" | "preserve" | "clear",
): Promise<void> {
  await withAppTargetLifecycleLock(() => applyTargetHomeStateWithHistoryUnlocked(runtime, state, target, source, authProjection));
}

async function applyTargetHomeStateWithHistoryUnlocked(
  runtime: CoreRuntime,
  state: Awaited<ReturnType<CoreRuntime["readLegacyState"]>>,
  target: "cli" | "app",
  source: EnvFileHistorySource,
  authProjection?: "selected" | "preserve" | "clear",
): Promise<void> {
  const envName = state.targets[target].env;
  const env = state.envs[envName];
  if (!env) {
    throw new Error(`Env '${envName}' not found`);
  }

  const pointer = state.targets[target];
  await inferLegacyProviderId(runtime, state, pointer.env, pointer.account);
  const gatewayBaseUrl = await resolveEnvironmentGatewayBaseUrl(envName);

  const before = await readEnvFileSnapshot(env.path);
  try {
    await runtime.applyTargetHomeState({
      state,
      target,
      authProjection: authProjection ?? resolveTargetHomeAuthProjection(state, target),
      ...(gatewayBaseUrl ? { gatewayBaseUrl } : {}),
    });
    await synchronizeTargetModelCatalog(runtime, state, target, env.path);
  } catch (error) {
    await restoreEnvFileSnapshot(env.path, before);
    throw error;
  }
  const after = await readEnvFileSnapshot(env.path);
  await recordEnvFileDiffHistory(envName, before, after, source);
}

function resolveTargetHomeAuthProjection(
  state: Awaited<ReturnType<CoreRuntime["readLegacyState"]>>,
  target: "cli" | "app",
): "selected" | "preserve" {
  const pointer = state.targets[target];
  const account = state.envs[pointer.env]?.accounts[pointer.account];
  // Official ChatGPT accounts are the model identity and must be projected.
  // API-key/provider accounts only change model routing; keep the existing
  // official auth cache available for remote connections.
  return account?.authMode === "auth" ? "selected" : "preserve";
}

/**
 * A direct Codex home cannot represent two AUTH identities: auth.json is both
 * the model login cache and the identity the desktop host uses for remote
 * control. API-key accounts and gateway routes do not have that limitation.
 */
function assertDirectRemoteIdentityCompatibility(
  state: Awaited<ReturnType<CoreRuntime["readLegacyState"]>>,
  envName: string,
  accountName: string,
): void {
  const environment = state.envs[envName];
  const selected = environment?.accounts[accountName];
  const remoteAccountName = environment?.remoteControl?.accountName;
  if (!environment || !selected || !remoteAccountName) return;
  if (environment.gateway?.mode === "gateway") return;
  if (selected.authMode === "auth" && selected.name !== remoteAccountName) {
    throw new Error("同一环境的订阅账号与手机远程账号必须一致，请拆分环境");
  }
}

async function synchronizeTargetModelCatalog(
  runtime: CoreRuntime,
  state: Awaited<ReturnType<CoreRuntime["readLegacyState"]>>,
  target: "cli" | "app",
  homePath: string,
): Promise<void> {
  const pointer = state.targets[target];
  const env = state.envs[pointer.env];
  const account = env?.accounts[pointer.account];
  if (!env || !account) return;

  const catalogBaseUrl = account.runtime.independentModelEnabled
    ? account.runtime.independentModelBaseUrl ?? account.runtime.openaiBaseUrl
    : account.runtime.openaiBaseUrl;
  const catalogPreset = account.runtime.independentModelEnabled
    ? resolveProviderDefaultPreset(catalogBaseUrl)
    : resolveProviderModelPreset({ baseUrl: catalogBaseUrl, model: account.runtime.model });
  const bundledCatalog = await loadBundledCatalogForCurrentInstall();
  const loadBundledCatalog = bundledCatalog ? async () => bundledCatalog : undefined;

  if (env.gateway?.mode === "gateway") {
    // Rebuild from the current model catalog instead of trusting a gateway
    // snapshot that may have been written before the last account binding
    // change. The generated route groups and the Codex-facing catalog must
    // describe the same set of models before the App is launched.
    const gateway = await buildEnvironmentGatewayState(runtime, env);
    await synchronizeEnvironmentGatewayModelCatalog({
      homePath,
      gateway,
      modelCatalog: await getModelCatalogStore().load(),
      environmentName: env.name,
      diagnosticLogPath: resolveLogPath("switcher"),
      loadBundledCatalog,
    });
    return;
  }

  await synchronizeAccountModelCatalog({
    envName: pointer.env,
    accountName: pointer.account,
    homePath,
    store: getModelCatalogStore(),
    providerId: account.runtime.providerId,
    baseUrl: catalogBaseUrl,
    model: catalogPreset?.entries[0]?.slug
      ?? account.runtime.model
      ?? (account.runtime.independentModelEnabled
        ? getProviderDefaultModelSlug(account.runtime.independentModelProviderId) ?? DEEPSEEK_DEFAULT_MODEL_SLUG
        : undefined),
    environmentName: pointer.env,
    diagnosticLogPath: resolveLogPath("switcher"),
    loadBundledCatalog,
  });
}

/**
 * Return the ingress URL for an active environment gateway.
 *
 * The selected account's runtime URL is intentionally not used here: it can
 * be a direct account route and must not replace the environment gateway in a
 * target home. When no gateway is active this returns undefined, preserving
 * the existing direct-route behavior.
 */
async function resolveEnvironmentGatewayBaseUrl(envName: string): Promise<string | undefined> {
  const [status] = await getUsageRouterManager()
    .getEnvironmentStatuses([envName])
    .catch(() => []);
  return status?.gatewayEnabled && status.localGatewayBaseUrl
    ? status.localGatewayBaseUrl
    : undefined;
}

async function inferLegacyProviderId(
  runtime: CoreRuntime,
  state: Awaited<ReturnType<CoreRuntime["readLegacyState"]>>,
  envName: string,
  accountName: string,
): Promise<void> {
  const account = state.envs[envName]?.accounts[accountName];
  if (!account || account.runtime.providerId) return;

  const snapshot = await getModelCatalogStore().load();
  const boundIds = snapshot.accountBindings[accountModelBindingKey(envName, accountName)] ?? [];
  const boundSlugs = boundIds
    .map((id) => snapshot.models.find((model) => model.id === id)?.entry.slug)
    .filter((slug): slug is string => Boolean(slug));
  if (boundSlugs.some((slug) => MIMO_DEFAULT_MODEL_SLUGS.includes(slug))) {
    account.runtime.providerId = "mimo";
  } else if (boundSlugs.some((slug) => KIMI_DEFAULT_MODEL_SLUGS.includes(slug))) {
    account.runtime.providerId = "kimi";
  } else if (boundSlugs.some((slug) => ZAI_DEFAULT_MODEL_SLUGS.includes(slug))) {
    account.runtime.providerId = "zai";
  } else if (boundSlugs.some((slug) => DEEPSEEK_DEFAULT_MODEL_SLUGS.includes(slug))) {
    account.runtime.providerId = "deepseek";
  } else {
    return;
  }
  await runtime.writeLegacyRuntime({
    stateDir: getStateDir(),
    envName,
    accountName,
    runtime: account.runtime,
  });
}

async function restoreEnvFileSnapshot(
  homePath: string,
  snapshot: { configToml: string; authJson: string },
): Promise<void> {
  for (const [fileName, content] of [
    ["config.toml", snapshot.configToml],
    ["auth.json", snapshot.authJson],
  ] as const) {
    const path = join(homePath, fileName);
    if (content) await writeTextFileRaw(path, content);
    else await rm(path, { force: true });
  }
}

async function recordEnvFileDiffHistory(
  envName: string,
  before: { configToml: string; authJson: string },
  after: { configToml: string; authJson: string },
  source: EnvFileHistorySource,
): Promise<void> {
  const writes: Promise<EnvFileHistoryEntry>[] = [];
  if (before.configToml !== after.configToml) {
    writes.push(
      appendEnvFileHistoryEntry({
        stateDir: getStateDir(),
        envName,
        fileType: "config.toml",
        source,
        content: before.configToml,
      }),
    );
  }
  if (before.authJson !== after.authJson) {
    writes.push(
      appendEnvFileHistoryEntry({
        stateDir: getStateDir(),
        envName,
        fileType: "auth.json",
        source,
        content: before.authJson,
      }),
    );
  }
  await Promise.all(writes);
}

async function updateEnvEditableFilesDirect(
  envName: string,
  files: { configToml: string; authJson: string },
): Promise<void> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const env = state.envs[envName];
  if (!env) {
    throw new Error(`Env '${envName}' not found`);
  }

  const nextConfig = normalizeEditableFileContent(files.configToml);
  const nextAuth = normalizeEditableFileContent(files.authJson);
  const before = await readEnvFileSnapshot(env.path);

  if (before.configToml !== nextConfig) {
    await appendEnvFileHistoryEntry({
      stateDir: getStateDir(),
      envName,
      fileType: "config.toml",
      source: "manual",
      content: before.configToml,
    });
    await writeTextFileRaw(join(env.path, "config.toml"), nextConfig);
  }

  if (before.authJson !== nextAuth) {
    await appendEnvFileHistoryEntry({
      stateDir: getStateDir(),
      envName,
      fileType: "auth.json",
      source: "manual",
      content: before.authJson,
    });
    await writeTextFileRaw(join(env.path, "auth.json"), nextAuth);
  }
}

function normalizeEditableFileContent(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

async function runSwitcherCommand(
  args: string[],
  options?: {
    successMessage: string;
    timeoutMs?: number;
  },
): Promise<DesktopActionResult> {
  const output = await runSwitcher(args, { timeoutMs: options?.timeoutMs });
  return {
    message: options?.successMessage ?? args.join(" "),
    output,
  };
}

async function runSwitcher(
  args: string[],
  options?: {
    timeoutMs?: number;
  },
): Promise<string> {
  const plan = buildSwitcherExecutionPlan({
    repoRoot: getRepoRoot(),
    platform: process.platform,
    env: process.env,
    args,
  });
  try {
    const output = await executeCommandPlan(plan, {
      cwd: getRepoRoot(),
      timeout: options?.timeoutMs,
      killSignal: "SIGKILL",
    });
    return output.stdout;
  } catch (error) {
    if (typeof error === "object" && error && "killed" in error && (error as { killed?: boolean }).killed) {
      throw new Error(`Command timed out after ${options?.timeoutMs ?? 0}ms: codex-sw ${args.join(" ")}`);
    }
    if (typeof error === "object" && error && "stderr" in error) {
      const stderr = String((error as { stderr?: string }).stderr ?? "").trim();
      if (stderr) {
        throw new Error(stderr);
      }
    }
    throw error;
  }
}

function buildSwitcherExecutionPlan(input: {
  repoRoot: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  args: string[];
}): CommandExecutionPlan {
  const env = {
    ...process.env,
    ...input.env,
  };
  if (detectPlatformLocal(input.platform) === "windows") {
    return {
      command: "node",
      args: [join(input.repoRoot, "scripts", "bin", "codex-sw-node.cjs"), ...input.args],
      env,
    };
  }

  return {
    command: "bash",
    args: [join(input.repoRoot, "plugins", "codex-switcher", "scripts", "codex-switcher"), ...input.args],
    env,
  };
}

async function nativeAuthLogin(request: {
  account: string;
  envName: string;
  target: "cli" | "app" | "both" | "none";
  relogin: boolean;
  sync?: boolean;
}): Promise<DesktopActionResult> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const env = state.envs[request.envName];
  if (!env) {
    throw new Error(`Env '${request.envName}' not found`);
  }
  assertDirectRemoteIdentityCompatibility(state, request.envName, request.account);

  await mkdir(env.path, { recursive: true });
  const codexBin = await requireCodexCliPath();
  await execFileAsync(codexBin, ["login"], {
    cwd: getRepoRoot(),
    env: {
      ...await getEffectiveCodexEnv(),
      CODEX_HOME: env.path,
    },
  });

  const authPath = join(env.path, "auth.json");
  const authRaw = await readFile(authPath, "utf8");
  await saveAccountArtifacts({
    envName: request.envName,
    account: request.account,
    runtime: {
      preferredAuthMethod: "chatgpt",
      openaiBaseUrlMode: "default",
      openaiBaseUrl: undefined,
    },
    authJsonContent: authRaw,
    target: request.target,
    authProjection: "selected",
  });
  await discoverAccountModels(request.envName, request.account);

  return {
    message: `Logged in ${request.envName}/${request.account}`,
    output: `Logged in account: ${request.envName}/${request.account}`,
  };
}

async function nativeApiKeyLogin(request: {
  providerId?: string;
  account: string;
  envName: string;
  target: "cli" | "app" | "both" | "none";
  apiKey?: string;
  baseUrlMode?: "default" | "custom";
  baseUrl?: string;
  apiProtocol?: "responses" | "chat_completions" | "anthropic";
  compatibilityEnabled?: boolean;
  upstreamModel?: string;
  reasoningProfile?: "auto" | "standard" | "reasoning_content" | "think_tags";
  longConversationStrategy?: "safe" | "continuity";
  instructionRole?: "auto" | "system" | "developer";
  requestOverrides?: Record<string, unknown>;
}): Promise<DesktopActionResult> {
  if (!request.apiKey?.trim()) {
    throw new Error("API key is required");
  }

  const providerId = normalizeProviderId(request.providerId);
  const providerProtocol = getProviderDefaultApiProtocol(providerId);
  const isPresetProvider = providerProtocol !== undefined;
  const providerBaseUrl = getProviderDefaultBaseUrl(providerId);
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const env = state.envs[request.envName];
  if (!env) {
    throw new Error(`Env '${request.envName}' not found`);
  }

  const existing = state.envs[request.envName]?.accounts[request.account];
  const existingRoutes = await getUsageRouterManager().listRoutesIfRunning().catch(() => []);
  const existingCompatibilityRoute = existingRoutes.find((route) =>
    route.envName === request.envName
      && route.accountName === request.account
      && route.protocol === "chat_completions",
  );
  const requestedBaseUrl = request.baseUrl?.trim() || undefined;
  const effectiveBaseUrl = providerBaseUrl ?? (requestedBaseUrl && requestedBaseUrl === existing?.runtime.compatibilityRouteBaseUrl
    ? existingCompatibilityRoute?.originalBaseUrl ?? requestedBaseUrl
    : requestedBaseUrl);
  const hasCustomBaseUrl = providerBaseUrl !== undefined || request.baseUrlMode === "custom";
  const isOfficialApiKeyLogin = !hasCustomBaseUrl && (!providerId || providerId === "openai");
  // Keep the environment's explicitly selected ChatGPT identity in auth.json
  // when this API-key account is also used for model calls. The key itself is
  // injected through OPENAI_API_KEY for direct launches, or hydrated by the
  // environment gateway; projecting it into auth.json would log the desktop
  // host out of the account used for remote control.
  const authProjection = env.remoteControl?.accountName
    ? "preserve" as const
    : isOfficialApiKeyLogin
      ? "selected" as const
      : "preserve" as const;
  if (existing?.runtime.compatibilityRouteEnabled === true || existingCompatibilityRoute) {
    await disableAccountCompatibility(request.envName, request.account);
  }

  await saveAccountArtifacts({
    envName: request.envName,
    account: request.account,
    runtime: {
      providerId,
      providerAuthMethod: "api_key",
      preferredAuthMethod: "apikey",
      openaiBaseUrlMode: hasCustomBaseUrl ? "custom" : "default",
      openaiBaseUrl: hasCustomBaseUrl ? effectiveBaseUrl : undefined,
      apiProtocol: providerProtocol ?? request.apiProtocol ?? "responses",
      compatibilityRouteEnabled: false,
      compatibilityUpstreamModel: request.upstreamModel?.trim() || undefined,
      compatibilityReasoningProfile: isPresetProvider ? "auto" : request.reasoningProfile ?? "auto",
      compatibilityLongConversationStrategy: isPresetProvider ? "safe" : request.longConversationStrategy ?? "safe",
      compatibilityInstructionRole: isPresetProvider ? "auto" : request.instructionRole ?? "auto",
      compatibilityRequestOverrides: request.requestOverrides,
    },
    authJsonContent: `${JSON.stringify({ OPENAI_API_KEY: request.apiKey.trim() }, null, 2)}\n`,
    target: request.target,
    authProjection,
  });

  await ensureProviderDefaultModels(getModelCatalogStore(), providerId);

  if (
    (providerProtocol === "chat_completions"
      || (!isPresetProvider && request.apiProtocol === "chat_completions" && request.compatibilityEnabled === true))
  ) {
    await enableAccountCompatibility({
      envName: request.envName,
      accountName: request.account,
      upstreamModel: request.upstreamModel?.trim() || undefined,
      reasoningProfile: request.reasoningProfile ?? "auto",
      longConversationStrategy: request.longConversationStrategy ?? "safe",
      instructionRole: request.instructionRole ?? "auto",
      requestOverrides: request.requestOverrides,
    });
  }

  await discoverAccountModels(request.envName, request.account);

  return {
    message: `Saved API key for ${request.envName}/${request.account}`,
    output: `API key saved successfully for account: ${request.envName}/${request.account}`,
  };
}

async function nativeExternalCredentialLogin(request: {
  account: string;
  envName: string;
  target: "cli" | "app" | "both" | "none";
  credentialPayload?: string;
  sub2apiPayload?: string;
}, source: ExternalCodexCredentialSource): Promise<DesktopActionResult> {
  const credentials = parseExternalCodexCredentials(
    request.credentialPayload ?? request.sub2apiPayload,
    source,
  );
  const accountNames = buildImportedAccountNames(request.account, credentials.length);
  const authJsonDocuments = credentials.map((credential) =>
    `${JSON.stringify(buildCodexChatGptAuthJson(credential), null, 2)}\n`
  );

  for (const [index, account] of accountNames.entries()) {
    await saveAccountArtifacts({
      envName: request.envName,
      account,
      runtime: {
        providerId: undefined,
        preferredAuthMethod: "chatgpt",
        openaiBaseUrlMode: "default",
        openaiBaseUrl: undefined,
      },
      authJsonContent: authJsonDocuments[index]!,
      target: request.target,
    });
    // Imported batches are independent environment accounts.  Discover each
    // credential separately so one account never inherits another account's
    // model list or routing metadata.
    await discoverAccountModels(request.envName, account);
  }

  return {
    message: `Imported ${accountNames.length} ${source === "cpa" ? "CPA" : "Sub2API"} account${accountNames.length === 1 ? "" : "s"}`,
    output: accountNames.map((account) => `${request.envName}/${account}`).join("\n"),
  };
}

async function saveAccountArtifacts(options: {
  envName: string;
  account: string;
  runtime: {
    providerId?: string;
    providerAuthMethod?: ProviderAuthMethod;
    providerRequestHeaders?: Record<string, string>;
    preferredAuthMethod: "chatgpt" | "apikey";
    openaiBaseUrlMode: "default" | "custom";
    openaiBaseUrl?: string;
    apiProtocol?: "responses" | "chat_completions" | "anthropic";
    compatibilityRouteEnabled?: boolean;
    compatibilityUpstreamModel?: string;
    compatibilityReasoningProfile?: "auto" | "standard" | "reasoning_content" | "think_tags";
    compatibilityLongConversationStrategy?: "safe" | "continuity";
    compatibilityInstructionRole?: "auto" | "system" | "developer";
    compatibilityRequestOverrides?: Record<string, unknown>;
  };
  authJsonContent: string;
  target: "cli" | "app" | "both" | "none";
  authProjection?: "selected" | "preserve" | "clear";
}): Promise<void> {
  const runtime = await loadCoreRuntime();
  let state = await runtime.readLegacyState(getLegacyOptions());
  const env = state.envs[options.envName];
  if (!env) {
    throw new Error(`Env '${options.envName}' not found`);
  }

  const accountDir = join(getStateDir(), "env-accounts", options.envName, options.account);
  await mkdir(accountDir, { recursive: true });
  await writeFile(join(accountDir, "auth.json"), options.authJsonContent, "utf8");
  await runtime.writeLegacyRuntime({
    stateDir: getStateDir(),
    envName: options.envName,
    accountName: options.account,
    runtime: options.runtime,
  });

  state = await runtime.readLegacyState(getLegacyOptions());
  const activeTargets = (["cli", "app"] as const).filter((target) =>
    state.targets[target].env === options.envName && state.targets[target].account === options.account,
  );
  const targets = options.target === "none" ? activeTargets : expandTargets(options.target);
  for (const target of targets) {
    const next = runtime.createCoreApi({ getState: () => state }).selectAccount({
      envName: options.envName,
      accountName: options.account,
      target,
      now: new Date().toISOString(),
    });
    await runtime.writeLegacyPointers({
      stateDir: getStateDir(),
      target,
      env: next.targets[target].env,
      account: next.targets[target].account,
    });
    await applyTargetHomeStateWithHistory(
      runtime,
      next,
      target,
      target === "cli" ? "switch-cli" : "switch-app",
      options.authProjection,
    );
    state = next;
  }

  await synchronizeAuthIdentityAcrossEnvironments(
    runtime,
    options.envName,
    options.account,
    options.authJsonContent,
  ).catch(() => undefined);
}

async function ensureProviderDefaultModels(
  store: ReturnType<typeof getModelCatalogStore>,
  providerId?: string,
): Promise<string[]> {
  const providerIds = providerId ? [providerId] : ["deepseek", "mimo", "kimi", "zai"];
  const snapshot = await store.load();
  const modelIds: string[] = [];
  const providerRuntime = providerId ? await loadGatewayProviderRuntime() : undefined;

  for (const currentProviderId of providerIds) {
    const presetEntries = getProviderDefaultModelEntries(currentProviderId);
    const definition = providerRuntime?.providerDefinitions().find((item) => item.id === currentProviderId);
    const entries = presetEntries?.length
      ? presetEntries
      : (definition?.presets ?? []).map((slug) => normalizeCustomModelInput({
          slug,
          display_name: `${definition?.displayName ?? currentProviderId} · ${slug}`,
          description: `Provider preset model for ${definition?.displayName ?? currentProviderId}`,
        }));
    if (!entries.length) continue;
    for (const entry of entries) {
      const existing = snapshot.models.find((model) => model.entry.slug === entry.slug);
      if (existing) {
        modelIds.push(existing.id);
        continue;
      }
      const created = await store.saveModel({ entry });
      snapshot.models.push(created);
      modelIds.push(created.id);
    }
  }

  return modelIds;
}

/**
 * Keep the installed Codex App's bundled models available as global picker
 * candidates.  These records intentionally have no provider model key: they
 * describe the App's supported model surface and are rebound to the current
 * account provider when selected.
 */
async function ensureBundledModelCatalog(
  store: ReturnType<typeof getModelCatalogStore>,
): Promise<void> {
  const bundled = await loadBundledCatalogForCurrentInstall();
  if (!bundled?.models.length) return;

  const snapshot = await store.load();
  const existingBySlug = new Map(snapshot.models.map((model) => [model.entry.slug, model]));
  for (const rawEntry of bundled.models) {
    if (rawEntry.supported_in_api === false) continue;
    const entry = normalizeBundledModelEntry(rawEntry);
    const existing = existingBySlug.get(entry.slug);
    if (!existing) {
      const created = await store.saveModel({ entry });
      existingBySlug.set(created.entry.slug, created);
      continue;
    }
    if (existing.entry.model_source === "bundled") {
      const updated = await store.saveModel({ id: existing.id, entry });
      existingBySlug.set(updated.entry.slug, updated);
    }
  }
}

async function ensureIndependentModelSlug(homePath: string, slug: string): Promise<void> {
  const configPath = join(homePath, "config.toml");
  const content = await readFile(configPath, "utf8").catch(() => "");
  if (!content || !content.includes('model = "gpt-5.4"')) return;
  const next = content.replace('model = "gpt-5.4"', `model = "${slug}"`);
  if (next !== content) {
    await writeFile(configPath, next, "utf8");
  }
}

function normalizeProviderId(value?: string): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === "deepseek") return "deepseek";
  if (trimmed === "mimo") return "mimo";
  if (trimmed === "openai") return "openai";
  return trimmed;
}

function expandTargets(target: "cli" | "app" | "both"): Array<"cli" | "app"> {
  return target === "both" ? ["cli", "app"] : [target];
}

function resolveCodexBin(): string {
  return resolveCodexBinFromEnv(process.env, process.platform);
}

function resolveCodexBinFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): string {
  const explicit = env.CODEX_SWITCHER_CODEX_BIN || env.CODEX_BIN;
  if (explicit?.trim()) {
    return explicit.trim();
  }

  return codexCliCandidatePathsLocal(env, platform)[0] || "codex";
}

function buildApiKeyLoginExecutionPlan(input: {
  repoRoot: string;
  codexHome: string;
  codexBin: string;
  apiKey: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}): CommandExecutionPlan {
  return {
    command: input.codexBin,
    args: ["login", "--with-api-key"],
    env: {
      ...process.env,
      ...input.env,
      CODEX_HOME: input.codexHome,
    },
    stdin: `${input.apiKey}\n`,
  };
}

async function executeCommandPlan(
  plan: CommandExecutionPlan,
  options?: {
    cwd?: string;
    timeout?: number;
    killSignal?: NodeJS.Signals | number;
  },
): Promise<{ stdout: string; stderr: string }> {
  if (!plan.stdin) {
    return execFileAsync(plan.command, plan.args, {
      cwd: options?.cwd,
      env: plan.env,
      timeout: options?.timeout,
      killSignal: options?.killSignal,
    });
  }

  return new Promise((resolve, reject) => {
    const child = execFile(
      plan.command,
      plan.args,
      {
        cwd: options?.cwd,
        env: plan.env,
        timeout: options?.timeout,
        killSignal: options?.killSignal,
      },
      (error, stdout, stderr) => {
        if (error) {
          const enriched = error as Error & { stdout?: string; stderr?: string };
          enriched.stdout = stdout;
          enriched.stderr = stderr;
          reject(enriched);
          return;
        }
        resolve({
          stdout,
          stderr,
        });
      },
    );
    child.stdin?.end(plan.stdin);
  });
}

function resolveLogPath(kind: string): string {
  switch (kind) {
    case "switcher":
      return process.env.CODEX_SWITCHER_SWITCH_LOG || join(getStateDir(), "switcher.log");
    case "token-refresh":
      return process.env.CODEX_SWITCHER_TOKEN_REFRESH_LOG || join(getStateDir(), "token-refresh.log");
    default:
      throw new Error(`unsupported log kind: ${kind}`);
  }
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function quoteAppleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function quoteCmdArg(value: string): string {
  return `"${escapeCmdDoubleQuoted(value)}"`;
}

function escapeCmdDoubleQuoted(value: string): string {
  return value.replace(/"/g, '""');
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

async function enrichTargetOverviewStatus(
  state: Awaited<ReturnType<CoreRuntime["readLegacyState"]>>,
  target: "cli" | "app",
  status: Record<string, unknown>,
): Promise<Record<string, unknown> & {
  email?: string;
  usage5h?: string;
  usageWeekly?: string;
}> {
  const pointer = state.targets[target];
  const env = state.envs[pointer.env];
  const account = env?.accounts[pointer.account];
  if (!env || !account) {
    return status;
  }

  const authFile = await resolveAuthFile(pointer.env, pointer.account, env.path);
  const usageProxy = await resolveUsageProxy();
  const metrics = authFile
    ? await collectProfileMetricsCached(pointer.env, pointer.account, authFile, env.path, usageProxy)
    : null;
  const isApiKeyAccount = account.runtime.preferredAuthMethod === "apikey";

  return {
    ...status,
    email: isApiKeyAccount ? undefined : metrics?.email ?? "-",
    usage5h: isApiKeyAccount ? undefined : metrics?.usage5h ?? "-",
    usageWeekly: isApiKeyAccount ? undefined : metrics?.usageWeekly ?? "-",
    apiKeyPreview: isApiKeyAccount
      ? maskApiKey(readAuthStringField(account.authData, "OPENAI_API_KEY"))
      : undefined,
    baseUrl: isApiKeyAccount ? describeBaseUrl(account.runtime) : undefined,
  };
}

async function enrichAccountOverviewList(
  state: Awaited<ReturnType<CoreRuntime["readLegacyState"]>>,
  accounts: OverviewAccountRecord[],
): Promise<OverviewAccountRecord[]> {
  const usageProxy = await resolveUsageProxy();

  return Promise.all(
    accounts.map(async (accountSummary) => {
      const envName = accountSummary.envName;
      const accountName = accountSummary.name;
      const authMode = String(accountSummary.authMode ?? "");
      const env = state.envs[envName];
      const account = env?.accounts[accountName];

      if (!env || !account || authMode !== "auth") {
        return accountSummary;
      }

      const authFile = await resolveAuthFile(envName, accountName, env.path);
      const metrics = authFile
        ? await collectProfileMetricsCached(envName, accountName, authFile, env.path, usageProxy)
        : null;

      return {
        ...accountSummary,
        authProfile: {
          plan: metrics?.plan ?? "unknown",
          usage5h: metrics?.usage5h ?? "-",
          usageWeekly: metrics?.usageWeekly ?? "-",
        },
      };
    }),
  );
}

async function collectProfileMetricsCached(
  envName: string,
  accountName: string,
  authFile: string,
  homePath: string,
  usageProxy: string,
): Promise<Awaited<ReturnType<typeof collectProfileMetrics>>> {
  const cacheKey = `${envName}/${accountName}`;
  const now = Date.now();
  const cached = authMetricsCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const inflight = authMetricsInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const task = collectProfileMetrics(accountName, authFile, homePath, usageProxy)
    .then((value) => {
      authMetricsCache.set(cacheKey, {
        expiresAt: Date.now() + AUTH_METRICS_TTL_MS,
        value,
      });
      return value;
    })
    .finally(() => {
      authMetricsInflight.delete(cacheKey);
    });

  authMetricsInflight.set(cacheKey, task);
  return task;
}

async function resolveAuthFile(envName: string, accountName: string, homePath: string): Promise<string | null> {
  const accountAuthPath = join(getStateDir(), "env-accounts", envName, accountName, "auth.json");
  if (existsSync(accountAuthPath)) {
    return accountAuthPath;
  }

  const homeAuthPath = join(homePath, "auth.json");
  if (existsSync(homeAuthPath)) {
    return homeAuthPath;
  }

  return null;
}

async function resolveUsageProxy(): Promise<string> {
  const support = await loadCoreSupportModules();
  const proxy = await support.readUsageProxyState(getStateDir(), process.env, process.platform);
  return proxy.source === "off" ? "" : proxy.value;
}

async function collectProfileMetrics(
  accountName: string,
  authFile: string,
  homePath: string,
  usageProxy: string,
): Promise<{
  email: string;
  plan: string;
  usage5h: string;
  usageWeekly: string;
} | null> {
  const scriptPath = resolveBundledPath(join("plugins", "codex-switcher", "scripts", "profile-metrics.py"));
  if (!existsSync(scriptPath)) {
    return null;
  }

  const args = [
    scriptPath,
    "--account-name",
    accountName,
    "--auth-file",
    authFile,
    "--data-path",
    homePath,
  ];
  if (usageProxy) {
    args.push("--usage-proxy", usageProxy);
  }

  try {
    const output = await execFileAsync(resolvePythonCommand(process.env, process.platform), args, {
      cwd: getRepoRoot(),
      env: process.env,
    });
    const [email = "-", plan = "unknown", usage5h = "-", usageWeekly = "-"] = output.stdout.trim().split("\t");
    return {
      email: email || "-",
      plan: plan || "unknown",
      usage5h: usage5h || "-",
      usageWeekly: usageWeekly || "-",
    };
  } catch {
    return null;
  }
}

function describeBaseUrl(runtime: {
  preferredAuthMethod: "chatgpt" | "apikey";
  openaiBaseUrlMode: "default" | "custom";
  openaiBaseUrl?: string;
}): string | undefined {
  if (runtime.preferredAuthMethod !== "apikey") {
    return undefined;
  }

  if (runtime.openaiBaseUrlMode === "custom" && runtime.openaiBaseUrl?.trim()) {
    return runtime.openaiBaseUrl.trim();
  }

  return "default";
}

function resolvePythonCommand(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): string {
  const explicit = env.CODEX_SWITCHER_PYTHON_BIN || env.PYTHON || env.PYTHON_BIN;
  if (explicit?.trim()) {
    return explicit.trim();
  }

  return detectPlatformLocal(platform) === "windows" ? "python" : "python3";
}

function maskApiKey(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value.length <= 7) {
    return "***";
  }

  return `${value.slice(0, 3)}***${value.slice(-4)}`;
}

function getLegacyOptions() {
  return resolveLegacyOptions(process.env, process.platform);
}

function getStateDir(): string {
  return getLegacyOptions().stateDir;
}

function getEnvsDir(): string {
  return getLegacyOptions().envsDir;
}

function getDefaultHome(): string {
  return getLegacyOptions().defaultHome;
}

function resolveLegacyOptions(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): {
  stateDir: string;
  envsDir: string;
  defaultHome: string;
} {
  const paths = resolveRuntimePathsLocal(env, platform);
  return {
    stateDir: paths.stateDir,
    envsDir: paths.envsDir,
    defaultHome: paths.defaultHome,
  };
}

function resolveBundledPath(relativePath: string): string {
  return resolveRuntimeResource(relativePath, {
    currentFile: join(currentDir, "bridge.cjs"),
    resourcesPath: getConfiguredResourcesPath(),
  });
}

function getRepoRoot(): string {
  return resolveRuntimeRoot({
    currentFile: join(currentDir, "bridge.cjs"),
    resourcesPath: getConfiguredResourcesPath(),
  });
}

function getAppDir(): string {
  return dirname(currentDir);
}

function getSwitcherPath(): string {
  return resolveBundledPath(join("plugins", "codex-switcher", "scripts", "codex-switcher"));
}

function shouldRestartAppAfterAccountSwitch(target: "cli" | "app"): boolean {
  return target === "app";
}

function shouldLaunchCliAfterAccountSwitch(target: "cli" | "app"): boolean {
  return target === "cli";
}

function getCliLaunchSuccessMessage(): string {
  return "Opened CLI session";
}

function buildPostSwitchActions(target: "cli" | "app"): Array<
  | {
      kind: "switcher";
      args: string[];
    }
  | {
      kind: "terminal";
      args: string[];
    }
> {
  if (shouldRestartAppAfterAccountSwitch(target)) {
    return [
      {
        kind: "switcher",
        args: ["app", "restart-current"],
      },
    ];
  }
  if (shouldLaunchCliAfterAccountSwitch(target)) {
    return [
      {
        kind: "terminal",
        args: ["cli", "launch-current"],
      },
    ];
  }
  return [];
}

function buildITermAppleScript(command: string): string {
  return `set iTermWasRunning to application "iTerm" is running
tell application "iTerm"
if iTermWasRunning then
create window with default profile
else
launch
repeat 50 times
if (count of windows) > 0 then exit repeat
delay 0.1
end repeat
if (count of windows) is 0 then error "iTerm did not create its initial window"
end if
tell current session of current window
write text ${quoteAppleScriptString(command)}
end tell
activate
end tell`;
}

function buildCurrentITermAppleScript(command: string): string {
  return `tell application "iTerm"
activate
if (count of windows) is 0 then
create window with default profile
end if
set targetSession to current session of current window
set targetTty to tty of targetSession
${buildAppleScriptCurrentSessionRestart("targetTty")}
tell targetSession to write text ${quoteAppleScriptString(command)} newline yes
end tell`;
}

function buildTerminalAppleScript(command: string): string {
  const quotedCommand = quoteAppleScriptString(command);
  return `set terminalWasRunning to application "Terminal" is running
tell application "Terminal"
set windowsBefore to count of windows
set launchBranch to ""
set targetTty to ""
if terminalWasRunning then
set targetTab to selected tab of front window
set targetTty to tty of targetTab
if busy of targetTab then
set launchBranch to "warm-busy-new-window"
do script ${quotedCommand}
else
set launchBranch to "warm-idle-current-tab"
do script ${quotedCommand} in targetTab
end if
else
set launchBranch to "cold-initial-tab"
launch
repeat 50 times
if exists front window then exit repeat
delay 0.1
end repeat
if not (exists front window) then error "Terminal did not create its initial window"
set targetTab to selected tab of front window
set targetTty to tty of targetTab
do script ${quotedCommand} in targetTab
end if
activate
delay 0.2
return "branch=" & launchBranch & ";runningBefore=" & terminalWasRunning & ";windowsBefore=" & windowsBefore & ";windowsAfter=" & (count of windows) & ";targetTty=" & targetTty
end tell`;
}

function buildCurrentTerminalAppleScript(command: string): string {
  return `tell application "Terminal"
activate
if not (exists front window) then
do script ${quoteAppleScriptString(command)}
else
set targetTab to selected tab of front window
set targetTty to tty of targetTab
${buildAppleScriptCurrentSessionRestart("targetTty")}
do script ${quoteAppleScriptString(command)} in targetTab
end if
end tell`;
}

function buildAppleScriptCurrentSessionRestart(ttyVariable: string): string {
  const processQuerySuffix = quoteAppleScriptString(
    " -o command= | awk '$0 !~ /codex-switcher|codex-code-mode-host/ && ($1 ~ /\\/codex$/ || ($1 ~ /\\/node$/ && $2 ~ /\\/codex$/)) { print }'",
  );
  const foregroundProcessGroupSuffix = quoteAppleScriptString(" -o tpgid= | awk 'NF { print $1; exit }'");
  return `set existingCodexProcesses to do shell script ("ps -t " & quoted form of ${ttyVariable} & ${processQuerySuffix})
if existingCodexProcesses is not "" then
set foregroundProcessGroup to do shell script ("ps -t " & quoted form of ${ttyVariable} & ${foregroundProcessGroupSuffix})
if foregroundProcessGroup is "" or foregroundProcessGroup is "-1" then error "Unable to resolve the current terminal foreground process group"
do shell script ("kill -TERM -- -" & foregroundProcessGroup)
set codexExited to false
repeat 50 times
delay 0.1
try
set codexProcesses to do shell script ("ps -t " & quoted form of ${ttyVariable} & ${processQuerySuffix})
if codexProcesses is "" then
set codexExited to true
exit repeat
end if
end try
end repeat
if codexExited is false then error "Codex CLI did not exit in the current terminal session"
end if
`;
}

export const __testUtils = {
  resolveLogPath,
  deriveAuthIdentityKey,
  resolveCatalogProviderIdentityForTest: resolveCatalogProviderIdentity,
  resolvePreviewModelIdForTest: resolvePreviewModelId,
  selectGatewayRouteBindingForModelForTest: selectGatewayRouteBindingForModel,
  extractProviderAccessTokenForTest: extractProviderAccessTokenFromAuthData,
  shouldDisableClaudeAutoModeServerForTest: shouldDisableClaudeAutoModeServer,
  saveAccountArtifactsForTest: saveAccountArtifacts,
  parseExternalCodexCredentials,
  buildCodexChatGptAuthJson,
  buildImportedAccountNames,
  expandTargets,
  quoteShellArg,
  quoteCmdArg,
  shouldRestartAppAfterAccountSwitch,
  shouldLaunchCliAfterAccountSwitch,
  getCliLaunchSuccessMessage,
  buildPostSwitchActions,
  buildSwitcherExecutionPlan,
  buildApiKeyLoginExecutionPlan,
  buildCliTerminalLaunchPlan,
  resolveLegacyOptionsForTest: resolveLegacyOptions,
  resolveCodexBinForTest: resolveCodexBinFromEnv,
  resolvePythonCommandForTest: resolvePythonCommand,
  resolveUsageProxyForTest: resolveUsageProxy,
  buildITermAppleScript,
  buildCurrentITermAppleScript,
  buildTerminalAppleScript,
  createTerminalLaunchGate,
  buildCurrentTerminalAppleScript,
  readTextFileOrEmpty,
  writeTextFileRaw,
  shouldCopyEnvClonePathForTest: shouldCopyEnvClonePath,
  setDesktopOperationsLoaderForTest(loader: typeof desktopOperationsLoaderForTest) {
    desktopOperationsLoaderForTest = loader;
  },
  resetUsageRouterManagerForTest() {
    const current = usageRouterManager;
    usageRouterManager = undefined;
    usageRouterManagerStateDir = undefined;
    // Tests can start a real router or its loopback admission server. Make
    // the reset tear down those handles instead of orphaning listeners that
    // keep the isolated Node test worker alive indefinitely.
    void current?.stopService().catch(() => undefined);
  },
  formatSubscriptionUsageMetric,
};

async function loadDesktopOperationsService(): Promise<DesktopOperationsServiceLike> {
  if (desktopOperationsLoaderForTest) {
    return desktopOperationsLoaderForTest();
  }

  const [{ createDesktopOperationsService }, runtime] = await Promise.all([
    loadDesktopOperationsModule(),
    loadCoreRuntime(),
  ]);
  const support = await loadCoreSupportModules();

  return createDesktopOperationsService({
    tasks: support.createTaskRunner(),
    removeAccount: async (input: { envName: string; accountName: string }) =>
      removeAccountDirect(runtime, input),
    logoutAccount: async (input: {
      envName: string;
      accountName: string;
      target: "cli" | "app" | "both";
    }) => logoutAccountDirect(runtime, input),
    readProxyState: async () =>
      support.readUsageProxyState(getStateDir(), process.env, process.platform),
    setManualProxy: async (value: string) => {
      const result = await support.setManualUsageProxy(getStateDir(), value);
      await getUsageRouterManager().refreshDefaultProxy();
      return result;
    },
    clearManualProxy: async () => {
      const result = await support.clearManualUsageProxy(getStateDir());
      await getUsageRouterManager().refreshDefaultProxy();
      return result;
    },
    disableProxy: async () => {
      await support.disableUsageProxy(getStateDir());
      await getUsageRouterManager().refreshDefaultProxy();
    },
    runProxyCheck: async () => runProxyCheckDirect(),
    getTokenRefreshStatus: async () => readTokenRefreshStatusDirect(),
    startTokenRefreshGuard: async () => tokenRefreshCommandDirect("start"),
    stopTokenRefreshGuard: async () => tokenRefreshCommandDirect("stop"),
    runTokenRefreshOnce: async () => tokenRefreshRunOnceDirect(),
    getAppStatus: async () => readAppStatusDirect(),
    logoutApp: async (input?: { accountName?: string }) =>
      logoutAppDirect(runtime, input?.accountName),
    stopManagedApp: async () => support.stopManagedCodexApp({ stateDir: getStateDir() }),
    listOperations: async () => listOperationsDirect(),
    runDoctor: async () => doctorDirect(),
    runRecover: async () => recoverDirect(runtime),
  }) as DesktopOperationsServiceLike;
}

async function removeAccountDirect(
  runtime: CoreRuntime,
  input: { envName: string; accountName: string },
): Promise<void> {
  const state = await runtime.readLegacyState(getLegacyOptions());
  const support = await loadCoreSupportModules();
  const next = support.createAccountService().removeAccount(state, {
    envName: input.envName,
    accountName: input.accountName,
    now: new Date().toISOString(),
  });

  await getUsageRouterManager().removeAccountRoutes(input.envName, input.accountName);

  await getModelCatalogStore().removeAccountModelDiscovery(
    accountModelBindingKey(input.envName, input.accountName),
  );

  await rm(join(getStateDir(), "env-accounts", input.envName, input.accountName), {
    recursive: true,
    force: true,
  });

  // Keep the legacy environment metadata in sync with the canonical state.
  // Otherwise deleting the selected remote account would make the next read
  // resurrect a dangling remoteControl.accountName from env-meta.
  if (state.envs[input.envName]?.remoteControl?.accountName === input.accountName) {
    await runtime.setLegacyEnvRemoteAccount({
      stateDir: getStateDir(),
      envName: input.envName,
    });
  }

  await syncEnvironmentRouteIfEnabled(input.envName);

  for (const target of ["cli", "app"] as const) {
    await runtime.writeLegacyPointers({
      stateDir: getStateDir(),
      target,
      env: next.targets[target].env,
      account: next.targets[target].account,
    });
    await applyTargetHomeStateWithHistory(runtime, next, target, target === "cli" ? "switch-cli" : "switch-app");
  }
}

async function removeEnvDirect(runtime: CoreRuntime, envName: string): Promise<void> {
  const state = await runtime.readLegacyState(getLegacyOptions());
  const support = await loadCoreSupportModules();
  const next = support.createEnvService().removeEnv(state, {
    envName,
  });

  await getUsageRouterManager().removeAccountPoolConfiguration(envName);
  await getUsageRouterManager().removeEnvironmentRoutes(envName);

  const catalog = await getModelCatalogStore().load();
  for (const accountKey of Object.keys(catalog.accountModelDiscoveries ?? {})) {
    if (accountKey.startsWith(`${envName}/`)) {
      await getModelCatalogStore().removeAccountModelDiscovery(accountKey);
    }
  }

  await rm(join(getEnvsDir(), envName), { recursive: true, force: true });
  await rm(join(getStateDir(), "env-accounts", envName), {
    recursive: true,
    force: true,
  });
  await removeAppWindowCount(getCodexToolPathOptions().settingsPath, envName);
  await syncTargetsDirect(runtime, next, ["cli", "app"]);
}

async function importDefaultEnvDirect(
  runtime: CoreRuntime,
  envName: string,
  options?: {
    withAuth?: boolean;
    force?: boolean;
  },
): Promise<void> {
  if (envName === "default") {
    throw new Error("cannot import into reserved env 'default'");
  }

  const state = await runtime.readLegacyState(getLegacyOptions());
  if (state.envs[envName]) {
    if (!options?.force) {
      throw new Error(`env '${envName}' already exists. use --force to overwrite`);
    }
    await rm(join(getEnvsDir(), envName), { recursive: true, force: true });
    await rm(join(getStateDir(), "env-accounts", envName), { recursive: true, force: true });
  }

  await runtime.createLegacyEnv({
    envsDir: getEnvsDir(),
    envName,
  });

  if (!options?.withAuth) {
    return;
  }

  const defaultAccount = state.envs.default?.accounts.default;
  const defaultAuthPath = join(getStateDir(), "env-accounts", "default", "default", "auth.json");
  const targetAccountDir = join(getStateDir(), "env-accounts", envName, "default");

  try {
    const authRaw = await readFile(defaultAuthPath, "utf8");
    await mkdir(targetAccountDir, { recursive: true });
    await writeFile(join(targetAccountDir, "auth.json"), authRaw, "utf8");
    await runtime.writeLegacyRuntime({
      stateDir: getStateDir(),
      envName,
      accountName: "default",
      runtime: defaultAccount?.runtime ?? {
        preferredAuthMethod: "chatgpt",
        openaiBaseUrlMode: "default",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }
}

async function logoutAccountDirect(
  runtime: CoreRuntime,
  input: { envName: string; accountName: string; target: "cli" | "app" | "both" },
): Promise<void> {
  const stateBeforeLogout = await runtime.readLegacyState(getLegacyOptions());
  const accountBeforeLogout = stateBeforeLogout.envs[input.envName]?.accounts[input.accountName];
  await rm(join(getStateDir(), "env-accounts", input.envName, input.accountName, "auth.json"), {
    force: true,
  });
  await rm(
    join(getStateDir(), "env-accounts", input.envName, input.accountName, "runtime.json"),
    { force: true },
  );

  await getModelCatalogStore().saveAccountModelDiscovery({
    accountKey: accountModelBindingKey(input.envName, input.accountName),
    providerId: accountBeforeLogout?.runtime.providerId ?? (accountBeforeLogout?.authMode === "auth" ? "chatgpt" : "openai"),
    state: "stale",
    lastError: "Account credentials are not available; reauthorize to refresh models",
  });

  const state = stateBeforeLogout;
  for (const target of expandTargets(input.target)) {
    if (
      state.targets[target].env === input.envName &&
      state.targets[target].account === input.accountName
    ) {
      await runtime.writeLegacyPointers({
        stateDir: getStateDir(),
        target,
        env: input.envName,
        account: "default",
      });
    }
  }

  const next = await runtime.readLegacyState(getLegacyOptions());
  for (const target of ["cli", "app"] as const) {
      await applyTargetHomeStateWithHistory(runtime, next, target, target === "cli" ? "switch-cli" : "switch-app");
  }
}

async function runProxyCheckDirect() {
  const state = await (await loadCoreRuntime()).readLegacyState(getLegacyOptions());
  const support = await loadCoreSupportModules();
  const proxy = await support.readUsageProxyState(getStateDir(), process.env, process.platform);
  if (proxy.source === "off" || !proxy.value) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "usage API proxy is off and no auto proxy detected. run: codex-sw proxy <host:port>",
    };
  }
  const envName = state.targets.cli.env;
  const accountName = state.targets.cli.account;
  const authData =
    state.envs[envName]?.accounts[accountName]?.authData ??
    state.envs[envName]?.accounts.default?.authData;
  const token = extractAccessTokenFromAuthData(authData);
  if (!token) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `access_token missing for current CLI env/account: ${envName}/${accountName}`,
    };
  }

  const bodyFile = `${getStateDir()}/proxy-test-body.tmp`;
  try {
    const { stdout } = await execFileAsync("curl", [
      "-sS",
      "-o",
      bodyFile,
      "-w",
      "%{http_code}",
      "-H",
      `Authorization: Bearer ${token}`,
      "-H",
      "Accept: application/json",
      "-H",
      "User-Agent: Mozilla/5.0",
      "https://chatgpt.com/backend-api/wham/usage",
    ], {
      env: {
        ...process.env,
        HTTPS_PROXY: proxy.value,
        HTTP_PROXY: proxy.value,
      },
    });
    const statusCode = Number(stdout.trim() || "0");
    const bodyPreview = (await readFile(bodyFile, "utf8").catch(() => "")).slice(0, 160);
    if (statusCode === 200) {
      return {
        exitCode: 0,
        stdout: `usage_api_proxy_test: ok (http=200, source=${proxy.source}, proxy=${proxy.value}, env/account=${envName}/${accountName})\n`,
        stderr: "",
      };
    }
    return {
      exitCode: 1,
      stdout: "",
      stderr: `usage_api_proxy_test: failed (http=${statusCode || 0}, source=${proxy.source}, proxy=${proxy.value}, env/account=${envName}/${accountName})\nresponse_preview: ${bodyPreview}\n`,
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await rm(bodyFile, { force: true });
  }
}

function extractAccessTokenFromAuthData(authData: Record<string, unknown> | undefined): string {
  const rawTokens = authData?.tokens;
  if (!rawTokens) {
    return "";
  }
  try {
    const parsed =
      typeof rawTokens === "string"
        ? (JSON.parse(rawTokens) as { access_token?: string })
        : (rawTokens as { access_token?: string });
    return parsed.access_token?.trim() || "";
  } catch {
    return "";
  }
}

function extractProviderAccessTokenFromAuthData(authData: Record<string, unknown> | undefined): string {
  // Claude Code accepts both Anthropic's bearer-style AUTH_TOKEN and its
  // x-api-key API key. Prefer the native Anthropic fields before legacy
  // provider fields so imported/manual account files do not silently select a
  // stale OpenAI-compatible token.
  const direct = readAuthStringField(authData, "ANTHROPIC_AUTH_TOKEN")
    ?? readAuthStringField(authData, "ANTHROPIC_API_KEY")
    ?? readAuthStringField(authData, "OPENAI_API_KEY")
    ?? readAuthStringField(authData, "access_token");
  if (direct) return direct;
  const rawTokens = authData?.tokens;
  if (!rawTokens) return "";
  try {
    const parsed = typeof rawTokens === "string"
      ? JSON.parse(rawTokens) as Record<string, unknown>
      : rawTokens as Record<string, unknown>;
    return readAuthStringField(parsed, "ANTHROPIC_AUTH_TOKEN")
      ?? readAuthStringField(parsed, "ANTHROPIC_API_KEY")
      ?? readAuthStringField(parsed, "OPENAI_API_KEY")
      ?? readAuthStringField(parsed, "access_token")
      ?? "";
  } catch {
    return "";
  }
}

function readAuthStringField(
  authData: Record<string, unknown> | undefined,
  field: string,
): string | undefined {
  const value = authData?.[field];
  return typeof value === "string" && value.trim() ? value : undefined;
}

async function readTokenRefreshStatusDirect(): Promise<string> {
  const platform = detectPlatformLocal(process.platform);
  const lines: string[] = [];

  if (platform === "windows") {
    lines.push(
      `token_refresh_guard: ${await queryWindowsTokenRefreshGuardStatusDirect()}`,
      `token_refresh_task: ${resolveWindowsTokenRefreshTaskNameDirect()}`,
    );
    return `${lines.join("\n")}\n`;
  }

  lines.push(`token_refresh_guard: ${await formatTokenRefreshGuardStatusDirect()}`);
  if (platform === "macos") {
    const plistPath = resolveTokenRefreshPlistPathDirect();
    if (existsSync(plistPath)) {
      lines.push(`token_refresh_plist: ${plistPath}`);
      lines.push(`token_refresh_log: ${resolveTokenRefreshLogPathDirect()}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function tokenRefreshCommandDirect(action: "start" | "stop"): Promise<string> {
  const platform = detectPlatformLocal(process.platform);
  if (platform === "windows") {
    await configureWindowsTokenRefreshTaskDirect(action);
    if (action === "start") {
      return `token_refresh_guard: enabled (task=${resolveWindowsTokenRefreshTaskNameDirect()}, interval=${resolveTokenRefreshIntervalSecondsDirect()}s)\ntoken_refresh_log: ${resolveTokenRefreshLogPathDirect()}\n`;
    }
    return "token_refresh_guard: disabled\n";
  }

  if (platform !== "macos") {
    throw new Error("token refresh guard requires macOS launchd");
  }

  if (action === "start") {
    const intervalSeconds = resolveTokenRefreshIntervalSecondsDirect();
    const plistPath = resolveTokenRefreshPlistPathDirect();
    const logPath = resolveTokenRefreshLogPathDirect();
    await mkdir(getStateDir(), { recursive: true });
    await writeFile(logPath, "", "utf8").catch(() => undefined);
    await writeTokenRefreshLaunchdPlistDirect(plistPath, intervalSeconds);
    await execFileAsync("launchctl", ["unload", plistPath]).catch(() => undefined);
    await execFileAsync("launchctl", ["load", "-w", plistPath]).catch((error) => {
      throw new Error(
        error instanceof Error
          ? `failed to load launchd job from ${plistPath}: ${error.message}`
          : `failed to load launchd job from ${plistPath}`,
      );
    });
    await execFileAsync("launchctl", ["start", resolveTokenRefreshLaunchdLabelDirect()]).catch(
      () => undefined,
    );
    return `token_refresh_guard: enabled (label=${resolveTokenRefreshLaunchdLabelDirect()}, interval=${intervalSeconds}s)\ntoken_refresh_log: ${logPath}\n`;
  }

  const plistPath = resolveTokenRefreshPlistPathDirect();
  if (existsSync(plistPath)) {
    await execFileAsync("launchctl", ["unload", plistPath]).catch(() => undefined);
    await rm(plistPath, { force: true });
  }
  return "token_refresh_guard: disabled\n";
}

async function tokenRefreshRunOnceDirect() {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const codexBin = await resolveCodexBinaryPathDirect();
  if (!codexBin) {
    throw new Error("codex binary not found. install Codex CLI or set CODEX_SWITCHER_CODEX_BIN");
  }

  let scanned = 0;
  let fresh = 0;
  let checked = 0;
  let refreshed = 0;
  let failed = 0;
  let relogin = 0;
  const startedAt = Date.now();
  const lines = [
    "",
    `Token refresh run  ${formatTokenRefreshLocalTimeDirect(new Date())}`,
    `UTC: ${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}`,
    `  ${padTokenRefreshCellDirect("ACCOUNT", 22)} ${padTokenRefreshCellDirect("EMAIL", 34)} ${padTokenRefreshCellDirect("EXPIRES", 20)} ${padTokenRefreshCellDirect("REMAINING", 12)} STATUS`,
    `  ${padTokenRefreshCellDirect("----------------------", 22)} ${padTokenRefreshCellDirect("----------------------------------", 34)} ${padTokenRefreshCellDirect("--------------------", 20)} ${padTokenRefreshCellDirect("------------", 12)} ----------------`,
  ];

  for (const envName of Object.keys(state.envs).sort()) {
    const envState = state.envs[envName];
    for (const accountName of Object.keys(envState.accounts).sort()) {
      scanned += 1;
      const accountState = envState.accounts[accountName];
      if (accountState.authMode !== "auth") {
        continue;
      }

      const authFile = join(getStateDir(), "env-accounts", envName, accountName, "auth.json");
      let beforeRaw = "";
      try {
        beforeRaw = await readFile(authFile, "utf8");
      } catch {
        continue;
      }
      if (!beforeRaw.trim()) {
        continue;
      }

      const beforeAuth = safeParseAuthJsonDirect(beforeRaw);
      const email = beforeAuth.email || "-";
      const expires = beforeAuth.expired || "-";
      const remaining = formatTokenRefreshRemainingDirect(expires);

      checked += 1;
      const result = await refreshAccountTokenOnceNativeDirect(runtime, {
        authFile,
        authRaw: beforeRaw,
        codexBin,
        envName,
        accountName,
      });

      let statusLabel = "checked";
      if (result === "changed") {
        refreshed += 1;
        statusLabel = "refreshed";
      } else if (result === "need_relogin") {
        failed += 1;
        relogin += 1;
        statusLabel = "relogin required";
      } else if (result === "failed") {
        failed += 1;
        statusLabel = "failed";
      }

      lines.push(
        `  ${padTokenRefreshCellDirect(`${envName}/${accountName}`, 22)} ${padTokenRefreshCellDirect(email, 34)} ${padTokenRefreshCellDirect(expires, 20)} ${padTokenRefreshCellDirect(remaining, 12)} ${statusLabel}`,
      );
    }
  }

  const durationSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  lines.push(
    `Summary: scanned=${scanned}  fresh=${fresh}  checked=${checked}  refreshed=${refreshed}  failed=${failed}  relogin=${relogin}  duration=${durationSeconds}s`,
  );

  return {
    exitCode: 0,
    stdout: `${lines.join("\n")}\n`,
    stderr: "",
  };
}

async function readAppStatusDirect(): Promise<string> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const support = await loadCoreSupportModules();
  const pid = await support.readManagedAppPid(support.resolveManagedAppStatePaths(getStateDir())).catch(
    () => null,
  );
  return `app_current: ${state.targets.app.env}/${state.targets.app.account}\napp_process: ${pid === null ? "not-running" : `running(pid=${pid})`}\n`;
}

async function logoutAppDirect(runtime: CoreRuntime, accountName?: string): Promise<void> {
  const state = await runtime.readLegacyState(getLegacyOptions());
  await logoutAccountDirect(runtime, {
    envName: state.targets.app.env,
    accountName: accountName || state.targets.app.account,
    target: "app",
  });
}

async function listOperationsDirect(): Promise<string> {
  const support = await loadCoreSupportModules();
  const proxy = await support.readUsageProxyState(getStateDir(), process.env, process.platform);
  const appStatus = await readAppStatusDirect();
  const tokenStatus = await readTokenRefreshStatusDirect();
  return `proxy: ${proxy.source === "off" ? "off" : proxy.value}\n${tokenStatus}${appStatus}`;
}

async function doctorDirect() {
  const effectiveEnv = await getEffectiveCodexEnv();
  const runtime = resolveRuntimePathsLocal(effectiveEnv, process.platform);
  const state = await (await loadCoreRuntime()).readLegacyState(getLegacyOptions());
  const support = await loadCoreSupportModules();
  let issues = 0;
  const codexCli = await support.resolveCommandPath("codex", effectiveEnv, process.platform);
  const codexApp = await support.resolveCodexAppPath(effectiveEnv, process.platform);
  const windowsReadiness = await support.getWindowsReadinessSnapshot(process.env, "win32");
  const launcher =
    detectPlatformLocal(process.platform) === "windows"
      ? resolveWindowsAppLauncherLocal(process.env)
      : `${resolveWindowsAppLauncherLocal(process.env)} (windows override: ${resolveWindowsAppLauncherLocal(process.env)})`;
  const lines = [
    `platform: ${detectPlatformLocal(process.platform)}`,
    `state_dir: ${runtime.stateDir}`,
    `envs_dir: ${runtime.envsDir}`,
    `default_home: ${runtime.defaultHome}`,
    `cli_current: ${state.targets.cli.env}/${state.targets.cli.account}`,
    `app_current: ${state.targets.app.env}/${state.targets.app.account}`,
    `app launcher: ${launcher}`,
  ];

  if (codexCli) {
    lines.push(`- codex binary: ok (${codexCli.path})`);
  } else {
    lines.push("- codex binary: missing");
    issues = 1;
  }

  if (codexApp) {
    lines.push(`- codex app binary: ok (${codexApp})`);
  } else {
    lines.push("- codex app binary: missing");
    issues = 1;
  }

  for (const item of windowsReadiness.launchers) {
    lines.push(
      item.resolved
        ? `- windows launcher ${item.command}: ok (${item.resolved.path})`
        : `- windows launcher ${item.command}: missing`,
    );
  }
  lines.push("windows cli candidates:");
  lines.push(...windowsReadiness.cliCandidates.map((candidate) => `- ${candidate}`));
  lines.push("windows app candidates:");
  lines.push(...windowsReadiness.appCandidates.map((candidate) => `- ${candidate}`));
  lines.push("windows shell init files:");
  lines.push(...windowsReadiness.shellInitFiles.map((file) => `- ${file}`));
  lines.push(issues === 0 ? "doctor: ok" : "doctor: issues found");
  return {
    exitCode: issues === 0 ? 0 : 1,
    stdout: `${lines.join("\n")}\n`,
    stderr: "",
  };
}

async function recoverDirect(runtime: CoreRuntime) {
  const state = await runtime.readLegacyState(getLegacyOptions());
  const nextState = {
    ...state,
    generatedAt: new Date().toISOString(),
    targets: {
      cli: {
        env: state.envs[state.targets.cli.env] ? state.targets.cli.env : "default",
        account:
          state.envs[state.targets.cli.env]?.accounts[state.targets.cli.account]
            ? state.targets.cli.account
            : "default",
      },
      app: {
        env: state.envs[state.targets.app.env] ? state.targets.app.env : "default",
        account:
          state.envs[state.targets.app.env]?.accounts[state.targets.app.account]
            ? state.targets.app.account
            : "default",
      },
    },
  };
  for (const target of ["cli", "app"] as const) {
    await runtime.writeLegacyPointers({
      stateDir: getStateDir(),
      target,
      env: nextState.targets[target].env,
      account: nextState.targets[target].account,
    });
    await applyTargetHomeStateWithHistory(runtime, nextState, target, target === "cli" ? "switch-cli" : "switch-app");
  }
  return {
    exitCode: 0,
    stdout: `recover(cli): ${nextState.targets.cli.env}/${nextState.targets.cli.account}\nrecover(app): ${nextState.targets.app.env}/${nextState.targets.app.account}\n`,
    stderr: "",
  };
}

function resolveTokenRefreshLaunchdLabelDirect(): string {
  return process.env.CODEX_SWITCHER_LAUNCHD_REFRESH_LABEL || "com.wangxt.codex-switcher.token-refresh";
}

function resolveTokenRefreshPlistPathDirect(): string {
  return join(
    resolveRuntimePathsLocal(process.env, process.platform).homeDir,
    "Library",
    "LaunchAgents",
    `${resolveTokenRefreshLaunchdLabelDirect()}.plist`,
  );
}

function resolveTokenRefreshLogPathDirect(): string {
  return process.env.CODEX_SWITCHER_TOKEN_REFRESH_LOG || join(getStateDir(), "token-refresh.log");
}

function resolveWindowsTokenRefreshTaskNameDirect(): string {
  return process.env.CODEX_SWITCHER_WINDOWS_TOKEN_REFRESH_TASK || "CodexSwitcherTokenRefresh";
}

function resolveTokenRefreshIntervalSecondsDirect(): number {
  const raw = process.env.CODEX_SWITCHER_TOKEN_REFRESH_INTERVAL_SECONDS || "900";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 60) {
    throw new Error(`invalid TOKEN_REFRESH_INTERVAL_SECONDS='${raw}'`);
  }
  return Math.floor(parsed);
}

async function formatTokenRefreshGuardStatusDirect(): Promise<string> {
  const platform = detectPlatformLocal(process.platform);
  if (platform === "windows") {
    return `disabled (task=${resolveWindowsTokenRefreshTaskNameDirect()})`;
  }
  if (platform !== "macos") {
    return "unsupported (requires macOS launchd)";
  }
  const plistPath = resolveTokenRefreshPlistPathDirect();
  if (!existsSync(plistPath)) {
    return "disabled";
  }
  try {
    await execFileAsync("launchctl", ["list", resolveTokenRefreshLaunchdLabelDirect()]);
    return `enabled(running), interval=${resolveTokenRefreshIntervalSecondsDirect()}s`;
  } catch {
    return `enabled(not-running), interval=${resolveTokenRefreshIntervalSecondsDirect()}s`;
  }
}

async function queryWindowsTokenRefreshGuardStatusDirect(): Promise<string> {
  const taskName = resolveWindowsTokenRefreshTaskNameDirect();
  return new Promise<string>((resolve, reject) => {
    const child = spawn("schtasks.exe", ["/Query", "/TN", taskName], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`schtasks query terminated by signal ${signal}`));
        return;
      }
      if ((code ?? 1) !== 0) {
        resolve(`disabled (task=${taskName})`);
        return;
      }
      const normalized = `${stdout}\n${stderr}`.toLowerCase();
      resolve(
        normalized.includes("running")
          ? `enabled(running), task=${taskName}`
          : `enabled(not-running), task=${taskName}`,
      );
    });
  });
}

async function configureWindowsTokenRefreshTaskDirect(
  action: "start" | "stop",
): Promise<void> {
  const taskName = resolveWindowsTokenRefreshTaskNameDirect();
  const args =
    action === "start"
      ? [
          "/Create",
          "/SC",
          "MINUTE",
          "/MO",
          String(Math.max(1, Math.floor(resolveTokenRefreshIntervalSecondsDirect() / 60))),
          "/TN",
          taskName,
          "/TR",
          `node "${join(getRepoRoot(), "scripts", "bin", "codex-sw-node.cjs")}" ops token-refresh run-once`,
          "/F",
        ]
      : ["/Delete", "/TN", taskName, "/F"];
  await new Promise<void>((resolve, reject) => {
    const child = spawn("schtasks.exe", args, {
      env: process.env,
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`schtasks terminated by signal ${signal}`));
        return;
      }
      if ((code ?? 1) !== 0) {
        reject(new Error(`schtasks ${action} failed with exit code ${code ?? 1}`));
        return;
      }
      resolve();
    });
  });
}

async function writeTokenRefreshLaunchdPlistDirect(
  plistPath: string,
  intervalSeconds: number,
): Promise<void> {
  const scriptPath = resolveBundledPath(join("plugins", "codex-switcher", "scripts", "codex-switcher"));
  const envsDir = getStateDir().replace(/\/?\.codex-switcher$/, "");
  const uid = String(process.getuid?.() ?? "");
  await mkdir(dirname(plistPath), { recursive: true });
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${resolveTokenRefreshLaunchdLabelDirect()}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${scriptPath}</string>
    <string>ops</string>
    <string>token-refresh</string>
    <string>run-once</string>
  </array>
  <key>StartInterval</key>
  <integer>${intervalSeconds}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${resolveTokenRefreshLogPathDirect()}</string>
  <key>StandardErrorPath</key>
  <string>${resolveTokenRefreshLogPathDirect()}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CODEX_SWITCHER_STATE_DIR</key>
    <string>${getStateDir()}</string>
    <key>CODEX_SWITCHER_ENVS_DIR</key>
    <string>${getEnvsDir()}</string>
    <key>CODEX_SWITCHER_ACCOUNTS_DIR</key>
    <string>${join(getStateDir(), "env-accounts")}</string>
    <key>CODEX_SWITCHER_DEFAULT_HOME</key>
    <string>${getDefaultHome()}</string>
    <key>CODEX_SWITCHER_SKIP_UPDATE_CHECK</key>
    <string>true</string>
    <key>CODEX_SWITCHER_TOKEN_REFRESH_INTERVAL_SECONDS</key>
    <string>${intervalSeconds}</string>
    <key>PATH</key>
    <string>${process.env.PATH || ""}</string>
    <key>HOME</key>
    <string>${process.env.HOME || ""}</string>
    <key>USER</key>
    <string>${process.env.USER || ""}</string>
    <key>UID</key>
    <string>${uid}</string>
  </dict>
</dict>
</plist>
`;
  await writeFile(plistPath, content, "utf8");
}

async function resolveCodexBinaryPathDirect(): Promise<string | null> {
  const status = await getCodexToolStatus("cli", getCodexToolPathOptions());
  return status.available ? status.path : null;
}

function safeParseAuthJsonDirect(raw: string): {
  email: string;
  expired: string;
} {
  try {
    const parsed = JSON.parse(raw) as { email?: string; expired?: string };
    return {
      email: parsed.email?.trim() || "-",
      expired: parsed.expired?.trim() || "-",
    };
  } catch {
    return {
      email: "-",
      expired: "-",
    };
  }
}

function formatTokenRefreshLocalTimeDirect(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}:${byType.second} ${byType.timeZoneName ?? ""}`.trim();
}

function formatTokenRefreshRemainingDirect(expiredAt: string): string {
  const parsed = Date.parse(expiredAt);
  if (!Number.isFinite(parsed)) {
    return "-";
  }
  const totalSeconds = Math.floor((parsed - Date.now()) / 1000);
  if (totalSeconds < 0) {
    return "expired";
  }
  if (totalSeconds < 3600) {
    return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
  }
  if (totalSeconds < 86400) {
    return `${Math.floor(totalSeconds / 3600)}h ${Math.floor((totalSeconds % 3600) / 60)}m`;
  }
  return `${Math.floor(totalSeconds / 86400)}d ${Math.floor((totalSeconds % 86400) / 3600)}h`;
}

function padTokenRefreshCellDirect(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width, " ");
}

async function refreshAccountTokenOnceNativeDirect(
  runtime: CoreRuntime,
  input: {
    authFile: string;
    authRaw: string;
    codexBin: string;
    envName: string;
    accountName: string;
  },
): Promise<"changed" | "unchanged" | "failed" | "need_relogin"> {
  const tempHome = await mkdtemp(join(tmpdir(), "codex-sw-token-refresh-"));
  const tempAuthPath = join(tempHome, "auth.json");

  try {
    await writeFile(tempAuthPath, input.authRaw, "utf8");
    const execution = await runCodexExecRefreshDirect({
      codexBin: input.codexBin,
      codexHome: tempHome,
    });

    let afterRaw = "";
    try {
      afterRaw = await readFile(tempAuthPath, "utf8");
      JSON.parse(afterRaw);
    } catch {
      return "failed";
    }

    if (afterRaw !== input.authRaw) {
      await writeFile(input.authFile, afterRaw, "utf8");
      await synchronizeAuthIdentityAcrossEnvironments(runtime, input.envName, input.accountName, afterRaw)
        .catch(() => undefined);
      return "changed";
    }

    if (execution.exitCode !== 0) {
      return /refresh token.*(expired|revoked|reused)|please log out and sign in again|not logged in/i.test(
        execution.output,
      )
        ? "need_relogin"
        : "failed";
    }

    return "unchanged";
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
}

async function runCodexExecRefreshDirect(input: {
  codexBin: string;
  codexHome: string;
}): Promise<{
  exitCode: number;
  output: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.codexBin, ["exec", "--skip-git-repo-check", "reply with: ok"], {
      env: {
        ...buildCodexExecutionEnvironment(process.env, input.codexBin),
        CODEX_HOME: input.codexHome,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
    }, 20_000);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        resolve({
          exitCode: 124,
          output: `${output}\n[signal:${signal}]`,
        });
        return;
      }
      resolve({
        exitCode: code ?? 1,
        output,
      });
    });
  });
}

async function syncUpdatedAuthToActiveTargetsDirect(
  runtime: CoreRuntime,
  envName: string,
  accountName: string,
): Promise<void> {
  const state = await runtime.readLegacyState(getLegacyOptions());
  for (const target of ["cli", "app"] as const) {
    if (state.targets[target].env === envName && state.targets[target].account === accountName) {
      await applyTargetHomeStateWithHistory(runtime, state, target, target === "cli" ? "switch-cli" : "switch-app");
    }
  }
}

const authIdentitySyncLocks = new Map<string, Promise<void>>();

async function synchronizeAuthIdentityAcrossEnvironments(
  runtime: CoreRuntime,
  sourceEnvName: string,
  sourceAccountName: string,
  authJsonContent: string,
): Promise<void> {
  const sourceAuthData = parseAuthJsonRecord(authJsonContent);
  const sourceIdentityKey = deriveAuthIdentityKey(sourceAuthData);
  if (!sourceAuthData || !sourceIdentityKey) {
    await appendAuthIdentitySyncLog({
      sourceEnvName,
      sourceAccountName,
      status: "skipped",
      reason: "identity-unavailable",
      matched: [],
      updated: [],
    });
    await syncEnvironmentRouteIfEnabled(sourceEnvName).catch(() => undefined);
    return;
  }

  const previous = authIdentitySyncLocks.get(sourceIdentityKey) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => synchronizeAuthIdentityNow(runtime, sourceEnvName, sourceAccountName, authJsonContent, sourceAuthData, sourceIdentityKey));
  authIdentitySyncLocks.set(sourceIdentityKey, current);
  try {
    await current;
  } finally {
    if (authIdentitySyncLocks.get(sourceIdentityKey) === current) {
      authIdentitySyncLocks.delete(sourceIdentityKey);
    }
  }
}

async function synchronizeAuthIdentityNow(
  runtime: CoreRuntime,
  sourceEnvName: string,
  sourceAccountName: string,
  authJsonContent: string,
  sourceAuthData: Record<string, unknown>,
  sourceIdentityKey: string,
): Promise<void> {
  const state = await runtime.readLegacyState(getLegacyOptions());
  const sourceKey = `${sourceEnvName}/${sourceAccountName}`;
  const matched: string[] = [];
  const updated: string[] = [];
  const affectedEnvironments = new Set<string>();

  for (const [envName, env] of Object.entries(state.envs)) {
    for (const [accountName, account] of Object.entries(env.accounts)) {
      if (account.authMode !== "auth") continue;
      const accountKey = `${envName}/${accountName}`;
      const identityKey = accountKey === sourceKey
        ? deriveAuthIdentityKey(sourceAuthData)
        : deriveAuthIdentityKey(account.authData, account.runtime.providerId ?? "chatgpt");
      if (identityKey !== sourceIdentityKey) continue;

      matched.push(accountKey);
      affectedEnvironments.add(envName);
      if (accountKey === sourceKey) continue;

      const authPath = join(getStateDir(), "env-accounts", envName, accountName, "auth.json");
      const currentAuth = await readTextFileOrEmpty(authPath);
      if (currentAuth === authJsonContent) continue;
      await mkdir(dirname(authPath), { recursive: true });
      await writeFileAtomically(authPath, authJsonContent, { encoding: "utf8", mode: 0o600 });
      updated.push(accountKey);
    }
  }

  if (!affectedEnvironments.size) {
    affectedEnvironments.add(sourceEnvName);
  }

  let refreshedState = await runtime.readLegacyState(getLegacyOptions());
  const gatewayEnvironments = new Set(
    [...affectedEnvironments].filter((envName) => refreshedState.envs[envName]?.gateway?.mode === "gateway"),
  );
  if (gatewayEnvironments.size) {
    refreshedState = await resynchronizeActiveEnvironmentGateways(runtime, refreshedState);
  }

  for (const envName of affectedEnvironments) {
    if (gatewayEnvironments.has(envName)) continue;
    await syncEnvironmentRouteIfEnabled(envName).catch(async (error) => {
      await appendAuthIdentitySyncLog({
        sourceEnvName,
        sourceAccountName,
        status: "partial",
        reason: `route-sync-failed:${error instanceof Error ? error.message : String(error)}`,
        matched,
        updated,
      });
    });
  }

  const projectedTargets = new Set<string>();
  for (const target of ["cli", "app"] as const) {
    const pointer = refreshedState.targets[target];
    const targetKey = `${pointer.env}/${pointer.account}`;
    if (!matched.includes(targetKey) || projectedTargets.has(targetKey)) continue;
    projectedTargets.add(targetKey);
    await applyTargetHomeStateWithHistory(runtime, refreshedState, target, "auth-sync").catch(async (error) => {
      await appendAuthIdentitySyncLog({
        sourceEnvName,
        sourceAccountName,
        status: "partial",
        reason: `target-sync-failed:${error instanceof Error ? error.message : String(error)}`,
        matched,
        updated,
      });
    });
  }

  await appendAuthIdentitySyncLog({
    sourceEnvName,
    sourceAccountName,
    status: "synced",
    identity: hashAuthIdentityKey(sourceIdentityKey),
    matched,
    updated,
  });
}

function parseAuthJsonRecord(content: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

async function appendAuthIdentitySyncLog(details: {
  sourceEnvName: string;
  sourceAccountName: string;
  status: "synced" | "partial" | "skipped";
  reason?: string;
  identity?: string;
  matched: string[];
  updated: string[];
}): Promise<void> {
  await appendFile(resolveLogPath("switcher"), `${JSON.stringify({
    at: new Date().toISOString(),
    event: "auth_identity_sync",
    ...details,
  })}\n`, "utf8").catch(() => undefined);
}

async function syncTargetsDirect(
  runtime: CoreRuntime,
  state: Awaited<ReturnType<CoreRuntime["readLegacyState"]>>,
  targets: Array<"cli" | "app">,
): Promise<void> {
  for (const target of targets) {
    await runtime.writeLegacyPointers({
      stateDir: getStateDir(),
      target,
      env: state.targets[target].env,
      account: state.targets[target].account,
    });
    await applyTargetHomeStateWithHistory(runtime, state, target, target === "cli" ? "switch-cli" : "switch-app");
  }
}

async function cloneEnvHomeExcludingAuth(sourcePath: string, targetPath: string): Promise<void> {
  const entries = await readdir(sourcePath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === "auth.json") {
      continue;
    }
    await cp(join(sourcePath, entry.name), join(targetPath, entry.name), {
      recursive: true,
      force: true,
      filter: (path) => shouldCopyEnvClonePath(path, process.platform),
    });
  }
}

async function shouldCopyEnvClonePath(path: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (info.isSocket() || info.isFIFO() || info.isCharacterDevice() || info.isBlockDevice()) {
      return false;
    }
    if (platform === "win32" && info.isSymbolicLink()) {
      return false;
    }
    return info.isFile() || info.isDirectory() || info.isSymbolicLink();
  } catch {
    return false;
  }
}

async function launchAppTarget(
  state: Awaited<ReturnType<CoreRuntime["readLegacyState"]>>,
  runtime: CoreRuntime,
  mode: AppWindowLaunchMode = "reconcile",
): Promise<void> {
  await withAppTargetLifecycleLock(() => launchAppTargetUnlocked(state, runtime, mode));
}

async function launchAppTargetUnlocked(
  state: Awaited<ReturnType<CoreRuntime["readLegacyState"]>>,
  runtime: CoreRuntime,
  mode: AppWindowLaunchMode = "reconcile",
): Promise<void> {
  // Refresh an active gateway before the final catalog write. This keeps the
  // route service and the catalog generated below on the same model-binding
  // revision when the App is launched immediately after an account switch.
  if (state.envs[state.targets.app.env]?.gateway?.mode === "gateway") {
    state = await resynchronizeActiveEnvironmentGatewaysUnlocked(runtime, state, state.targets.app.env);
  }
  const env = state.envs[state.targets.app.env];
  if (!env) {
    throw new Error(`App env '${state.targets.app.env}' not found`);
  }
  const catalogPath = join(env.path, "model-catalogs", "codex-switcher-gateway-models.json");
  const accountName = state.targets.app.account;
  await appendAppLifecycleLog({
    event: "app_launch_started",
    envName: state.targets.app.env,
    accountName,
    mode,
    codexHome: env.path,
    catalogPath,
  });
  // A gateway catalog is consumed and cached by the Codex App Server during
  // process startup. Make one final, awaited synchronization immediately
  // before launching so a binding change cannot leave the server with the
  // previous Plus-only catalog while config.toml points at the new one.
  await synchronizeTargetModelCatalog(runtime, state, "app", env.path);
  await appendAppLifecycleLog({
    event: "app_catalog_ready",
    envName: state.targets.app.env,
    accountName,
    mode,
    codexHome: env.path,
    catalogPath,
  });
  const support = await loadCoreSupportModules();
  const account = state.envs[state.targets.app.env]?.accounts[state.targets.app.account];
  const apiKey = account?.runtime.apiProtocol === "chat_completions" && account.runtime.compatibilityRouteEnabled
    ? account.runtime.compatibilityRouteToken
    : readAuthStringField(account?.authData, "OPENAI_API_KEY");
  const effectiveEnv: NodeJS.ProcessEnv = {
    ...await getEffectiveCodexEnv(),
    ...(apiKey ? { OPENAI_API_KEY: apiKey } : {}),
  };
  const packagedTarget = process.platform === "win32"
    ? normalizeWindowsPackagedAppTarget(effectiveEnv.CODEX_SWITCHER_APP_BIN ?? "")
    : "";
  const desiredCount = mode === "additional" ? 1 : await readDesiredAppWindowCount(state.targets.app.env);
  const plan = buildAppWindowLaunchPlan({ mode, desiredCount, packagedWindowsTarget: Boolean(packagedTarget) });
  if (packagedTarget) {
    const defaultHome = resolveRuntimePathsLocal(process.env, process.platform).defaultHome;
    if (plan.stopPackagedProcesses) {
      await stopWindowsPackagedAppProcesses();
    }
    if (plan.materializePackagedHome) {
      await prepareWindowsPackagedAppHome({
        stateDir: getStateDir(),
        defaultHome,
        sourceHome: env.path,
        materialize: async (projectionHome) => {
          const projectionState = {
            ...state,
            envs: {
              ...state.envs,
              [state.targets.app.env]: { ...env, path: projectionHome },
            },
          };
          const gatewayBaseUrl = await resolveEnvironmentGatewayBaseUrl(state.targets.app.env);
          await runtime.applyTargetHomeState({
            state: projectionState,
            target: "app",
            authProjection: resolveTargetHomeAuthProjection(projectionState, "app"),
            ...(gatewayBaseUrl ? { gatewayBaseUrl } : {}),
            localRouterAuthMode: "static",
          });
          // Microsoft Store Codex does not reliably consume CODEX_HOME from
          // Explorer activation. Its effective home is the projected default
          // home, so regenerate the account or gateway catalog there after
          // projecting config.toml and auth.json.
          await synchronizeTargetModelCatalog(runtime, projectionState, "app", projectionHome);
        },
      });
    }
    const launchNew = async () => {
      await support.launchNewCodexApp({
        codexHome: defaultHome,
        stateDir: getStateDir(),
        targetKey: state.targets.app.env,
        env: { ...effectiveEnv, CODEX_SWITCHER_APP_BIN: packagedTarget },
      });
    };
    try {
      await executeAppWindowLaunchPlan(plan, {
        restart: async () => { throw new Error("Invalid packaged App window launch plan"); },
        launchNew,
      });
      await appendAppLifecycleLog({
        event: "app_launch_completed",
        envName: state.targets.app.env,
        accountName,
        mode,
        codexHome: defaultHome,
        catalogPath: join(defaultHome, "model-catalogs", "codex-switcher-gateway-models.json"),
        desiredCount,
      });
      scheduleAppEnvironmentBadgeSync();
    } catch (error) {
      await appendAppLifecycleLog({
        event: "app_launch_failed",
        envName: state.targets.app.env,
        accountName,
        mode,
        codexHome: defaultHome,
        catalogPath: join(defaultHome, "model-catalogs", "codex-switcher-gateway-models.json"),
        desiredCount,
        error: error instanceof Error ? error.message : String(error),
      });
      await persistPartialWindowCount(state.targets.app.env, mode, error);
      throw error;
    }
    return;
  }

  const launchInput = {
    codexHome: env.path,
    stateDir: getStateDir(),
    targetKey: state.targets.app.env,
    env: effectiveEnv,
  };
  try {
    await executeAppWindowLaunchPlan(plan, {
      restart: async () => { await support.restartCurrentCodexApp(launchInput); },
      launchNew: async () => { await support.launchNewCodexApp(launchInput); },
    });
    await appendAppLifecycleLog({
      event: "app_launch_completed",
      envName: state.targets.app.env,
      accountName,
      mode,
      codexHome: env.path,
      catalogPath,
      desiredCount,
    });
    scheduleAppEnvironmentBadgeSync();
  } catch (error) {
    await appendAppLifecycleLog({
      event: "app_launch_failed",
      envName: state.targets.app.env,
      accountName,
      mode,
      codexHome: env.path,
      catalogPath,
      desiredCount,
      error: error instanceof Error ? error.message : String(error),
    });
    await persistPartialWindowCount(state.targets.app.env, mode, error);
    throw error;
  }
}

async function readDesiredAppWindowCount(envName: string): Promise<number> {
  const settingsPath = getCodexToolPathOptions().settingsPath;
  const persistedCount = (await readAppWindowSettings(settingsPath)).counts[envName] ?? 1;
  const support = await loadCoreSupportModules();
  const trackedCount = await support.reconcileManagedAppInstanceCount(
    support.resolveManagedAppStatePaths(getStateDir()),
    envName,
  );
  const currentCount = resolveCurrentAppWindowCount(persistedCount, trackedCount);
  if (trackedCount !== undefined && currentCount !== persistedCount) {
    await saveAppWindowCount(settingsPath, envName, currentCount);
  }
  return currentCount;
}

async function persistPartialWindowCount(envName: string, mode: AppWindowLaunchMode, error: unknown): Promise<void> {
  if (mode !== "reconcile" || !(error instanceof AppWindowLaunchError) || error.launchedCount < 1) return;
  await saveAppWindowCount(getCodexToolPathOptions().settingsPath, envName, error.launchedCount);
}
