import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { access, appendFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { getUiLanguage, setUiLanguage, type UiLanguage } from "./ui-language.js";
import {
  loadCoreRuntime,
  loadCoreSupportModules,
  loadDesktopOperationsModule,
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
import { UsageRouterManager } from "./usage-router-manager.js";
import { isLocalRouterBaseUrl, resolveRouteDisplayBaseUrl, selectCompatibilityUpstreamBaseUrl, type PricingProfile, type UsageFilter, type UsageRequestQuery } from "./usage-routing-model.js";
import {
  buildEffectiveCodexEnv,
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
  readAppEnvironmentBadgeSettings,
  readRouterLifecycleSettings,
  readRouterPortSettings,
  saveCliAutoResumeSettings,
  saveAppWindowCount,
  renameAppWindowCount,
  removeAppWindowCount,
  saveEnvHistoryRetentionSettings,
  saveGeneratedImageRecoverySettings,
  saveAppEnvironmentBadgeSettings,
  saveRouterLifecycleSettings,
  saveRouterPortSettings,
  type CliAutoResumeSettings,
  type EnvHistoryRetentionSettings,
  type GeneratedImageRecoverySettings,
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
  type SaveCustomModelInput,
} from "./model-catalog-store.js";
import {
  loadBundledModelCatalog,
  synchronizeAccountModelCatalog,
} from "./account-model-catalog.js";
import {
  DEEPSEEK_DEFAULT_MODEL_SLUG,
  isDeepSeekOfficialBaseUrl,
  resolveProviderDefaultPreset,
  resolveProviderModelPreset,
} from "./provider-model-presets.js";
import {
  SkillManager,
  type CreateSkillProviderInput,
  type InstallSkillInput,
  type SetProviderBindingInput,
  type SkillProviderId,
  type UpdateSkillInput,
} from "./skill-manager.js";
import {
  inspectGeneratedImageRecoverySkill,
  reconcileGeneratedImageRecoverySkill,
  type CodexSkillEnvironment,
} from "./generated-image-recovery-skill.js";
import { AppEnvironmentBadgeManager, createUnsupportedBadgeAdapter, type AppEnvironmentBadgeStatus } from "./app-environment-badges.js";
import { MacDockBadgeAdapter, WindowsTaskbarBadgeAdapter } from "./app-environment-badge-adapters.js";
import {
  buildCodexChatGptAuthJson,
  buildImportedAccountNames,
  parseExternalCodexCredentials,
  type ExternalCodexCredentialSource,
} from "./external-codex-credential-import.js";

const execFileAsync = promisify(execFile);
const currentDir = resolveCurrentDir();

const AUTH_METRICS_TTL_MS = 60_000;

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

export function getSkillSnapshot(refreshMarketplace = false) {
  return getSkillManager().getSnapshot({ refreshMarketplace });
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
    });
    usageRouterManagerStateDir = stateDir;
  }
  return usageRouterManager;
}

export async function getEnvironmentRouteStatuses() {
  await synchronizeEnabledEnvironmentRoutes();
  const state = await (await loadCoreRuntime()).readLegacyState(getLegacyOptions());
  return getUsageRouterManager().getEnvironmentStatuses(Object.keys(state.envs).sort());
}

function getEnvironmentRouteAccounts(state: Awaited<ReturnType<Awaited<ReturnType<typeof loadCoreRuntime>>["readLegacyState"]>>, envName: string) {
  const env = state.envs[envName];
  if (!env) throw new Error(`Environment '${envName}' not found`);
  return Object.entries(env.accounts).map(([accountName, account]) => ({
    envName,
    accountName,
    authMode: account.authMode,
    apiKey: account.authMode === "auth"
      ? extractAccessTokenFromAuthData(account.authData)
      : readAuthStringField(account.authData, "OPENAI_API_KEY"),
    authAccountId: extractAccountIdFromAuthData(account.authData),
    protocol: account.authMode === "auth"
      ? "responses" as const
      : account.runtime.apiProtocol === "chat_completions" ? "chat_completions" as const : "responses" as const,
    upstreamModel: account.runtime.compatibilityUpstreamModel,
    baseUrl: account.runtime.openaiBaseUrlMode === "custom" && account.runtime.openaiBaseUrl
      ? account.runtime.openaiBaseUrl
      : "default",
  }));
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

async function resolveAccountUpstreamBaseUrl(
  envName: string,
  accountName: string,
  runtime: { openaiBaseUrlMode: string; openaiBaseUrl?: string },
): Promise<string> {
  const routes = await getUsageRouterManager().listRoutesIfRunning().catch(() => []);
  const runtimeBaseUrl = runtime.openaiBaseUrlMode === "custom" && runtime.openaiBaseUrl ? runtime.openaiBaseUrl : "default";
  return selectCompatibilityUpstreamBaseUrl(routes, envName, accountName, runtimeBaseUrl);
}

function createEnvironmentRouteBaseUrlUpdater(
  runtime: Awaited<ReturnType<typeof loadCoreRuntime>>,
  envName: string,
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
  };
}

function createAccountPoolRuntimeUpdater(
  runtime: Awaited<ReturnType<typeof loadCoreRuntime>>,
  envName: string,
  protocol: "responses" | "chat_completions",
) {
  if (protocol === "responses") return createEnvironmentRouteBaseUrlUpdater(runtime, envName);
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
  const before = await readEnvFileSnapshot(env.path);
  try {
    await runtime.applyTargetHomeState({ state, target });
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
  if (!routes.length && !pools.length) return;

  const runtime = await loadCoreRuntime();
  const initialState = await runtime.readLegacyState(getLegacyOptions());
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
    }, poolAccounts, createAccountPoolRuntimeUpdater(runtime, pool.envName, pool.protocol));
  }
  const responseEnvNames = Array.from(new Set(
    routes.filter((route) => route.protocol === "responses").map((route) => route.envName),
  ));
  for (const envName of responseEnvNames) {
    if (!initialState.envs[envName]) {
      await manager.removeEnvironmentRoutes(envName);
      continue;
    }
    await manager.enableEnvironment(
      envName,
      getEnvironmentRouteAccounts(initialState, envName),
      createEnvironmentRouteBaseUrlUpdater(runtime, envName),
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
      baseUrl: route.originalBaseUrl || account.runtime.openaiBaseUrl || "default",
      apiKey,
      upstreamModel: account.runtime.compatibilityUpstreamModel ?? route.upstreamModel,
      reasoningProfile: account.runtime.compatibilityReasoningProfile ?? route.reasoningProfile,
      longConversationStrategy: account.runtime.compatibilityLongConversationStrategy ?? route.longConversationStrategy,
      instructionRole: account.runtime.compatibilityInstructionRole ?? route.instructionRole,
      requestOverrides: account.runtime.compatibilityRequestOverrides ?? route.requestOverrides,
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
          baseUrl, apiKey, upstreamModel: selected.runtime.compatibilityUpstreamModel,
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
    baseUrl, apiKey, upstreamModel: input.upstreamModel,
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
  if (request.enabled && isDeepSeekOfficialBaseUrl(request.baseUrl)) {
    await ensureDeepSeekIndependentModelSlug(state.envs[request.envName]!.path);
  }

  return {
    message: `Updated independent model for ${request.envName}/${request.accountName}`,
    output: `${request.envName}/${request.accountName} ${request.enabled ? "enabled" : "disabled"}\n`,
  };
}

export async function nativeLogin(request: {
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
  return saveCodexToolPath(kind, path, getCodexToolPathOptions());
}

export async function clearCodexToolPath(kind: CodexToolKind) {
  return resetCodexToolPath(kind, getCodexToolPathOptions());
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

export async function listCustomModels() {
  return getModelCatalogStore().load();
}

export async function saveCustomModel(input: SaveCustomModelInput) {
  await getModelCatalogStore().saveModel(input);
  await resynchronizeActiveModelCatalogs();
  return getModelCatalogStore().load();
}

export async function deleteCustomModel(id: string) {
  await getModelCatalogStore().deleteModel(id);
  await resynchronizeActiveModelCatalogs();
  return getModelCatalogStore().load();
}

export async function setAccountModelBindings(accountKey: string, modelIds: string[]) {
  const snapshot = await getModelCatalogStore().setAccountBindings(accountKey, modelIds);
  await resynchronizeActiveModelCatalogs(accountKey);
  return snapshot;
}

export async function setModelAccountBindings(modelId: string, accountKeys: string[]) {
  const snapshot = await getModelCatalogStore().setModelBindings(modelId, accountKeys);
  await resynchronizeActiveModelCatalogs();
  return snapshot;
}

async function resynchronizeActiveModelCatalogs(accountKey?: string): Promise<void> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  for (const target of ["cli", "app"] as const) {
    const pointer = state.targets[target];
    if (!accountKey || `${pointer.env}/${pointer.account}` === accountKey) {
      await applyTargetHomeStateWithHistory(
        runtime,
        state,
        target,
        target === "cli" ? "switch-cli" : "switch-app",
      );
    }
  }
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
    await getModelCatalogStore().setAccountBindings(
      targetKey,
      catalog.accountBindings[sourceKey] ?? [],
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
    ? { ...process.env, CODEX_SWITCHER_WINDOWS_PWSH_AVAILABLE: "1" }
    : process.env;
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
        env: process.env,
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
    });
  }

  const shellCommand = buildUnixCliLaunchCommand({
    repoRoot: input.repoRoot,
    workingDirectory: input.workingDirectory,
    codexHome: input.codexHome,
    codexBin: input.codexBin,
    args: codexArgs,
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
}): string {
  const parts = [
    input.workingDirectory ? `cd ${quoteShellArg(input.workingDirectory)}` : "",
    `export CODEX_HOME=${quoteShellArg(input.codexHome)}`,
    buildUnixApiKeyExport(input.codexHome),
    [quoteShellArg(input.codexBin), ...input.args.map(quoteShellArg)].join(" "),
  ].filter(Boolean);
  return parts.join(" && ");
}

function buildUnixApiKeyExport(codexHome: string): string {
  const script = 'const fs=require("node:fs");const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).OPENAI_API_KEY||"";process.stdout.write(String(value));';
  const command = ["node", "-e", quoteShellArg(script), quoteShellArg(join(codexHome, "auth.json"))].join(" ");
  return `export OPENAI_API_KEY="$(${command})"`;
}

function buildWindowsCmdLaunchCommand(input: {
  repoRoot: string;
  workingDirectory?: string;
  codexHome: string;
  codexBin: string;
  args: string[];
}): string {
  return [
    `cd /d "${escapeCmdDoubleQuoted(input.workingDirectory ?? input.repoRoot)}"`,
    `set "CODEX_HOME=${escapeCmdDoubleQuoted(input.codexHome)}"`,
    `for /f "usebackq delims=" %A in (\`powershell.exe -NoProfile -Command "(Get-Content -Raw '${escapePowerShellSingleQuoted(join(input.codexHome, "auth.json"))}' | ConvertFrom-Json).OPENAI_API_KEY"\`) do set "OPENAI_API_KEY=%A"`,
    [quoteCmdArg(input.codexBin), ...input.args.map(quoteCmdArg)].join(" "),
  ].join(" && ");
}

function buildWindowsPowerShellLaunchCommand(input: {
  repoRoot: string;
  workingDirectory?: string;
  codexHome: string;
  codexBin: string;
  args: string[];
}): string {
  const invocation = [
    `& '${escapePowerShellSingleQuoted(input.codexBin)}'`,
    ...input.args.map((arg) => `'${escapePowerShellSingleQuoted(arg)}'`),
  ].join(" ");
  return [
    `Set-Location '${escapePowerShellSingleQuoted(input.workingDirectory ?? input.repoRoot)}'`,
    `$env:CODEX_HOME='${escapePowerShellSingleQuoted(input.codexHome)}'`,
    `$env:OPENAI_API_KEY=(Get-Content -Raw '${escapePowerShellSingleQuoted(join(input.codexHome, "auth.json"))}' | ConvertFrom-Json).OPENAI_API_KEY`,
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
): Promise<void> {
  const envName = state.targets[target].env;
  const env = state.envs[envName];
  if (!env) {
    throw new Error(`Env '${envName}' not found`);
  }

  const before = await readEnvFileSnapshot(env.path);
  try {
    await runtime.applyTargetHomeState({ state, target });
    const pointer = state.targets[target];
    const account = state.envs[pointer.env]?.accounts[pointer.account];
    const cliStatus = await getCodexToolStatus("cli", getCodexToolPathOptions());
    const catalogBaseUrl = account?.runtime.independentModelEnabled
      ? account.runtime.independentModelBaseUrl ?? account.runtime.openaiBaseUrl
      : account?.runtime.openaiBaseUrl;
    const catalogPreset = account?.runtime.independentModelEnabled
      ? resolveProviderDefaultPreset(catalogBaseUrl)
      : resolveProviderModelPreset({ baseUrl: catalogBaseUrl, model: account?.runtime.model });
    await synchronizeAccountModelCatalog({
      envName: pointer.env,
      accountName: pointer.account,
      homePath: env.path,
      store: getModelCatalogStore(),
      baseUrl: catalogBaseUrl,
      model: catalogPreset?.entries[0]?.slug
        ?? account?.runtime.model
        ?? (account?.runtime.independentModelEnabled ? DEEPSEEK_DEFAULT_MODEL_SLUG : undefined),
      loadBundledCatalog: async () => {
        if (!cliStatus.available) {
          throw new Error("Codex CLI is required to generate the merged model catalog");
        }
        return loadBundledModelCatalog(cliStatus.path);
      },
    });
  } catch (error) {
    await restoreEnvFileSnapshot(env.path, before);
    throw error;
  }
  const after = await readEnvFileSnapshot(env.path);
  await recordEnvFileDiffHistory(envName, before, after, source);
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

  await mkdir(env.path, { recursive: true });
  const codexBin = await requireCodexCliPath();
  await execFileAsync(codexBin, ["login"], {
    cwd: getRepoRoot(),
    env: {
      ...process.env,
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
  });

  return {
    message: `Logged in ${request.envName}/${request.account}`,
    output: `Logged in account: ${request.envName}/${request.account}`,
  };
}

async function nativeApiKeyLogin(request: {
  account: string;
  envName: string;
  target: "cli" | "app" | "both" | "none";
  apiKey?: string;
  baseUrlMode?: "default" | "custom";
  baseUrl?: string;
  apiProtocol?: "responses" | "chat_completions";
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
  const effectiveBaseUrl = requestedBaseUrl && requestedBaseUrl === existing?.runtime.compatibilityRouteBaseUrl
    ? existingCompatibilityRoute?.originalBaseUrl ?? requestedBaseUrl
    : requestedBaseUrl;
  if (existing?.runtime.compatibilityRouteEnabled === true || existingCompatibilityRoute) {
    await disableAccountCompatibility(request.envName, request.account);
  }

  await saveAccountArtifacts({
    envName: request.envName,
    account: request.account,
    runtime: {
      preferredAuthMethod: "apikey",
      openaiBaseUrlMode: request.baseUrlMode === "custom" ? "custom" : "default",
      openaiBaseUrl: request.baseUrlMode === "custom" ? effectiveBaseUrl : undefined,
      apiProtocol: "responses",
      compatibilityRouteEnabled: false,
      compatibilityUpstreamModel: request.upstreamModel?.trim() || undefined,
      compatibilityReasoningProfile: request.reasoningProfile ?? "auto",
      compatibilityLongConversationStrategy: request.longConversationStrategy ?? "safe",
      compatibilityInstructionRole: request.instructionRole ?? "auto",
      compatibilityRequestOverrides: request.requestOverrides,
    },
    authJsonContent: `${JSON.stringify({ OPENAI_API_KEY: request.apiKey.trim() }, null, 2)}\n`,
    target: request.target,
  });

  if (request.apiProtocol === "chat_completions" && request.compatibilityEnabled === true) {
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
        preferredAuthMethod: "chatgpt",
        openaiBaseUrlMode: "default",
        openaiBaseUrl: undefined,
      },
      authJsonContent: authJsonDocuments[index]!,
      target: request.target,
    });
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
    preferredAuthMethod: "chatgpt" | "apikey";
    openaiBaseUrlMode: "default" | "custom";
    openaiBaseUrl?: string;
    apiProtocol?: "responses" | "chat_completions";
    compatibilityRouteEnabled?: boolean;
    compatibilityUpstreamModel?: string;
    compatibilityReasoningProfile?: "auto" | "standard" | "reasoning_content" | "think_tags";
    compatibilityLongConversationStrategy?: "safe" | "continuity";
    compatibilityInstructionRole?: "auto" | "system" | "developer";
    compatibilityRequestOverrides?: Record<string, unknown>;
  };
  authJsonContent: string;
  target: "cli" | "app" | "both" | "none";
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
    await applyTargetHomeStateWithHistory(runtime, next, target, target === "cli" ? "switch-cli" : "switch-app");
    state = next;
  }

  await syncEnvironmentRouteIfEnabled(options.envName);
}

async function ensureDeepSeekIndependentModelSlug(homePath: string): Promise<void> {
  const configPath = join(homePath, "config.toml");
  const content = await readFile(configPath, "utf8").catch(() => "");
  if (!content || !content.includes('model = "gpt-5.4"')) return;
  const next = content.replace('model = "gpt-5.4"', `model = "${DEEPSEEK_DEFAULT_MODEL_SLUG}"`);
  if (next !== content) {
    await writeFile(configPath, next, "utf8");
  }
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
    usageRouterManager = undefined;
    usageRouterManagerStateDir = undefined;
  },
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
    setManualProxy: async (value: string) => support.setManualUsageProxy(getStateDir(), value),
    clearManualProxy: async () => support.clearManualUsageProxy(getStateDir()),
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

  await rm(join(getStateDir(), "env-accounts", input.envName, input.accountName), {
    recursive: true,
    force: true,
  });

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
  await rm(join(getStateDir(), "env-accounts", input.envName, input.accountName, "auth.json"), {
    force: true,
  });
  await rm(
    join(getStateDir(), "env-accounts", input.envName, input.accountName, "runtime.json"),
    { force: true },
  );

  const state = await runtime.readLegacyState(getLegacyOptions());
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
      await syncUpdatedAuthToActiveTargetsDirect(runtime, input.envName, input.accountName);
      await syncEnvironmentRouteIfEnabled(input.envName);
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
        ...process.env,
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
  const env = state.envs[state.targets.app.env];
  if (!env) {
    throw new Error(`App env '${state.targets.app.env}' not found`);
  }
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
          await runtime.applyTargetHomeState({ state: projectionState, target: "app" });
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
      scheduleAppEnvironmentBadgeSync();
    } catch (error) {
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
    scheduleAppEnvironmentBadgeSync();
  } catch (error) {
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
