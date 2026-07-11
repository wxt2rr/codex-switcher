import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
import type { PricingProfile, UsageFilter } from "./usage-routing-model.js";
import {
  getConfiguredResourcesPath,
  resolveRuntimeResource,
  resolveRuntimeRoot,
} from "./runtime-paths.js";

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
let desktopOperationsLoaderForTest:
  | (() => Promise<DesktopOperationsServiceLike>)
  | undefined;
let usageRouterManager: UsageRouterManager | undefined;

function getUsageRouterManager(): UsageRouterManager {
  usageRouterManager ??= new UsageRouterManager({
    stateDir: getStateDir(),
    serviceEntryPath: join(currentDir, "usage-router-service-main.cjs"),
  });
  return usageRouterManager;
}

export async function getEnvironmentRouteStatuses() {
  const state = await (await loadCoreRuntime()).readLegacyState(getLegacyOptions());
  return getUsageRouterManager().getEnvironmentStatuses(Object.keys(state.envs).sort());
}

export async function toggleEnvironmentRoute(envName: string, enabled: boolean) {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const env = state.envs[envName];
  if (!env) throw new Error(`Environment '${envName}' not found`);
  const accounts = Object.entries(env.accounts).map(([accountName, account]) => ({
    envName,
    accountName,
    authMode: account.authMode,
    baseUrl: account.runtime.openaiBaseUrlMode === "custom" && account.runtime.openaiBaseUrl
      ? account.runtime.openaiBaseUrl
      : "default",
  }));
  const updateBaseUrl = async (accountName: string, baseUrl: string) => {
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
    await syncUpdatedAuthToActiveTargetsDirect(runtime, envName, accountName);
  };
  return enabled
    ? getUsageRouterManager().enableEnvironment(envName, accounts, updateBaseUrl)
    : getUsageRouterManager().disableEnvironment(envName, updateBaseUrl);
}

export async function loadUsageSnapshot(filter: UsageFilter) {
  return getUsageRouterManager().queryUsage(filter);
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

  const accounts = overview.accounts.map((accountSummary) => {
    const account = state.envs[accountSummary.envName]?.accounts[accountSummary.name];
    const route = routes.find((candidate) =>
      candidate.enabled && candidate.envName === accountSummary.envName && candidate.accountName === accountSummary.name);
    const isApiKeyAccount =
      account?.runtime.preferredAuthMethod === "apikey" || accountSummary.authMode === "apikey";

    return {
      ...accountSummary,
      apiKeyValue: isApiKeyAccount
        ? readAuthStringField(account?.authData, "OPENAI_API_KEY")
        : undefined,
      route: route
        ? {
            enabled: true as const,
            originalBaseUrl: route.originalBaseUrl,
            localBaseUrl: account?.runtime.openaiBaseUrl ?? "",
          }
        : undefined,
    };
  });

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

  const accountMetrics = await enrichAccountOverviewList(state, overview.accounts);
  const cliStatus = await enrichTargetOverviewStatus(state, "cli", overview.status.cli);
  const appStatus = await enrichTargetOverviewStatus(state, "app", overview.status.app);

  const payload = {
    accounts: Object.fromEntries(
      accountMetrics
        .filter((account) => account.authProfile)
        .map((account) => [`${account.envName}/${account.name}`, account.authProfile]),
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

  await runtime.writeLegacyPointers({
    stateDir: getStateDir(),
    target,
    env: next.targets[target].env,
    account: next.targets[target].account,
  });
  await applyTargetHomeStateWithHistory(runtime, next, target, target === "cli" ? "switch-cli" : "switch-app");
  return {
    message: `Switched ${target.toUpperCase()} env to ${next.targets[target].env}`,
    output: `${next.targets[target].env}/${next.targets[target].account}\n`,
  };
}

export async function switchAccount(
  target: "cli" | "app",
  envName: string,
  accountName: string,
  strategy?: "replace-current" | "current-window" | "new-window",
): Promise<DesktopActionResult> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
  const next = runtime.createCoreApi({ getState: () => state }).selectAccount({
    envName,
    accountName,
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
  if (target === "app") {
    await launchAppTarget(next, runtime, strategy === "new-window" ? "new-window" : "replace-current");
  } else {
    await openCommandInPreferredTerminal(
      ["cli", "launch-current"],
      strategy === "current-window" ? "current-window" : "new-window",
    );
  }
  return {
    message: `Switched ${target.toUpperCase()} account to ${next.targets[target].env}/${next.targets[target].account}`,
    output: `${next.targets[target].env}/${next.targets[target].account}\n`,
  };
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

  return `${next.envs[envName]?.name ?? envName}\n`;
}

export async function updateEnv(
  envName: string,
  nextEnvName: string,
  homePath: string,
): Promise<DesktopActionResult> {
  const runtime = await loadCoreRuntime();
  const state = await runtime.readLegacyState(getLegacyOptions());
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

  return {
    message: `Updated independent model for ${request.envName}/${request.accountName}`,
    output: `${request.envName}/${request.accountName} ${request.enabled ? "enabled" : "disabled"}\n`,
  };
}

export async function nativeLogin(request: {
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
}): Promise<DesktopActionResult> {
  switch (request.mode) {
    case "auth":
      return nativeAuthLogin(request);
    case "apikey":
      return nativeApiKeyLogin(request);
    case "sub2api":
      return nativeSub2ApiLogin(request);
    default:
      throw new Error(`unsupported login mode: ${request.mode}`);
  }
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
  await openCommandInPreferredTerminal(["cli", "launch-current"]);
  return {
    message: getCliLaunchSuccessMessage(),
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
): Promise<void> {
  const repoRoot = getRepoRoot();
  const codexHome = await resolveCliTargetHome();
  const codexBin = resolveCodexBin();
  const plan = buildCliTerminalLaunchPlan({
    repoRoot,
    codexHome,
    codexBin,
    platform: process.platform,
    env: process.env,
    launchMode: strategy,
    args: commandArgs[0] === "cli" && commandArgs[1] === "launch-current" ? [] : commandArgs,
  });

  let lastError: unknown = null;
  for (const attempt of plan.attempts) {
    try {
      await execFileAsync(attempt.command, attempt.args, {
        cwd: repoRoot,
        env: process.env,
      });
      return;
    } catch (error) {
      lastError = error;
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

function buildCliTerminalLaunchPlan(input: {
  repoRoot: string;
  codexHome: string;
  codexBin: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  launchMode?: "current-window" | "new-window";
  args?: string[];
}): CliTerminalLaunchPlan {
  const platform = detectPlatformLocal(input.platform);
  const codexArgs = input.args ?? [];
  const launchMode = input.launchMode ?? "new-window";

  if (platform === "windows") {
    return buildWindowsCliTerminalLaunchPlan({
      repoRoot: input.repoRoot,
      codexHome: input.codexHome,
      codexBin: input.codexBin,
      env: input.env,
      args: codexArgs,
    });
  }

  const shellCommand = buildUnixCliLaunchCommand({
    repoRoot: input.repoRoot,
    codexHome: input.codexHome,
    codexBin: input.codexBin,
    args: codexArgs,
  });

  if (platform === "macos") {
    return {
      platform,
      launchMode,
      attempts: [
        {
          command: "osascript",
          args: ["-e", launchMode === "current-window" ? buildCurrentITermAppleScript(shellCommand) : buildITermAppleScript(shellCommand)],
        },
        {
          command: "osascript",
          args: ["-e", launchMode === "current-window" ? buildCurrentTerminalAppleScript(shellCommand) : buildTerminalAppleScript(shellCommand)],
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

function buildWindowsCliTerminalLaunchPlan(input: {
  repoRoot: string;
  codexHome: string;
  codexBin: string;
  env?: NodeJS.ProcessEnv;
  args: string[];
}): CliTerminalLaunchPlan {
  const launcher = (input.env?.CODEX_SWITCHER_WINDOWS_CLI_LAUNCHER || "powershell").toLowerCase();
  const cmdCommand = buildWindowsCmdLaunchCommand(input);
  const powerShellCommand = buildWindowsPowerShellLaunchCommand(input);
  if (launcher === "wt" || launcher === "windows-terminal" || launcher === "wt.exe") {
    return {
      platform: "windows",
      launchMode: "new-window",
      attempts: [
        {
          command: "wt.exe",
          args: [
            "-w",
            "new",
            "powershell.exe",
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

  if (launcher === "powershell" || launcher === "pwsh" || launcher === "powershell.exe") {
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
  codexHome: string;
  codexBin: string;
  args: string[];
}): string {
  const parts = [
    `cd ${quoteShellArg(input.repoRoot)}`,
    `export CODEX_HOME=${quoteShellArg(input.codexHome)}`,
    [quoteShellArg(input.codexBin), ...input.args.map(quoteShellArg)].join(" "),
  ];
  return parts.join(" && ");
}

function buildWindowsCmdLaunchCommand(input: {
  repoRoot: string;
  codexHome: string;
  codexBin: string;
  args: string[];
}): string {
  return [
    `cd /d "${escapeCmdDoubleQuoted(input.repoRoot)}"`,
    `set "CODEX_HOME=${escapeCmdDoubleQuoted(input.codexHome)}"`,
    [quoteCmdArg(input.codexBin), ...input.args.map(quoteCmdArg)].join(" "),
  ].join(" && ");
}

function buildWindowsPowerShellLaunchCommand(input: {
  repoRoot: string;
  codexHome: string;
  codexBin: string;
  args: string[];
}): string {
  const invocation = [
    `& '${escapePowerShellSingleQuoted(input.codexBin)}'`,
    ...input.args.map((arg) => `'${escapePowerShellSingleQuoted(arg)}'`),
  ].join(" ");
  return [
    `Set-Location '${escapePowerShellSingleQuoted(input.repoRoot)}'`,
    `$env:CODEX_HOME='${escapePowerShellSingleQuoted(input.codexHome)}'`,
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
  await runtime.applyTargetHomeState({ state, target });
  const after = await readEnvFileSnapshot(env.path);
  await recordEnvFileDiffHistory(envName, before, after, source);
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
  target: "cli" | "app" | "both";
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
  const codexBin = resolveCodexBin();
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
  target: "cli" | "app" | "both";
  apiKey?: string;
  baseUrlMode?: "default" | "custom";
  baseUrl?: string;
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

  await mkdir(env.path, { recursive: true });
  const codexBin = resolveCodexBin();
  const loginPlan = buildApiKeyLoginExecutionPlan({
    repoRoot: getRepoRoot(),
    codexHome: env.path,
    codexBin,
    apiKey: request.apiKey,
    platform: process.platform,
    env: process.env,
  });
  await executeCommandPlan(loginPlan, {
    cwd: getRepoRoot(),
  });

  const authPath = join(env.path, "auth.json");
  const authRaw = await readFile(authPath, "utf8");
  await saveAccountArtifacts({
    envName: request.envName,
    account: request.account,
    runtime: {
      preferredAuthMethod: "apikey",
      openaiBaseUrlMode: request.baseUrlMode === "custom" ? "custom" : "default",
      openaiBaseUrl: request.baseUrlMode === "custom" ? request.baseUrl?.trim() || undefined : undefined,
    },
    authJsonContent: authRaw,
    target: request.target,
  });

  return {
    message: `Saved API key for ${request.envName}/${request.account}`,
    output: `API key saved successfully for account: ${request.envName}/${request.account}`,
  };
}

async function nativeSub2ApiLogin(request: {
  account: string;
  envName: string;
  target: "cli" | "app" | "both";
  sub2apiPayload?: string;
}): Promise<DesktopActionResult> {
  const payload = parseSub2ApiPayload(request.sub2apiPayload);
  const authJson = buildSub2ApiAuthJson(payload);
  await saveAccountArtifacts({
    envName: request.envName,
    account: request.account,
    runtime: {
      preferredAuthMethod: "chatgpt",
      openaiBaseUrlMode: "default",
      openaiBaseUrl: undefined,
    },
    authJsonContent: `${JSON.stringify(authJson, null, 2)}\n`,
    target: request.target,
  });

  return {
    message: `Logged in ${request.envName}/${request.account}`,
    output: `Logged in account: ${request.envName}/${request.account}`,
  };
}

async function saveAccountArtifacts(options: {
  envName: string;
  account: string;
  runtime: {
    preferredAuthMethod: "chatgpt" | "apikey";
    openaiBaseUrlMode: "default" | "custom";
    openaiBaseUrl?: string;
  };
  authJsonContent: string;
  target: "cli" | "app" | "both";
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
  for (const target of expandTargets(options.target)) {
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

function parseSub2ApiPayload(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) {
    throw new Error("sub2api JSON is required");
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`invalid sub2api JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function buildSub2ApiAuthJson(data: Record<string, unknown>) {
  const accessToken = String(data.access_token ?? "").trim();
  const idToken = String(data.id_token ?? "").trim();
  if (!accessToken) {
    throw new Error("sub2api JSON missing access_token");
  }
  if (!idToken) {
    throw new Error("sub2api JSON missing id_token");
  }

  const payload: Record<string, unknown> = {
    auth_mode: "chatgpt",
    tokens: {
      access_token: accessToken,
      id_token: idToken,
    },
  };

  for (const key of ["refresh_token", "last_refresh", "email", "account_id", "expired"] as const) {
    const value = String(data[key] ?? "").trim();
    if (value) {
      payload[key] = value;
    }
  }

  return payload;
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
  return `tell application "iTerm"
activate
create window with default profile
tell current session of current window
write text ${quoteAppleScriptString(command)}
end tell
end tell`;
}

function buildCurrentITermAppleScript(command: string): string {
  return `tell application "iTerm"
activate
if (count of windows) is 0 then
create window with default profile
end if
tell current session of current window
write text ${quoteAppleScriptString(command)}
end tell
end tell`;
}

function buildTerminalAppleScript(command: string): string {
  return `tell application "Terminal"
activate
do script ${quoteAppleScriptString(command)}
end tell`;
}

function buildCurrentTerminalAppleScript(command: string): string {
  return `tell application "Terminal"
activate
if not (exists front window) then
do script ${quoteAppleScriptString(command)}
else
do script ${quoteAppleScriptString(command)} in front window
end if
end tell`;
}

export const __testUtils = {
  resolveLogPath,
  parseSub2ApiPayload,
  buildSub2ApiAuthJson,
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
  buildCurrentTerminalAppleScript,
  readTextFileOrEmpty,
  writeTextFileRaw,
  setDesktopOperationsLoaderForTest(loader: typeof desktopOperationsLoaderForTest) {
    desktopOperationsLoaderForTest = loader;
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

  await rm(join(getStateDir(), "env-accounts", input.envName, input.accountName), {
    recursive: true,
    force: true,
  });

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

  await rm(join(getEnvsDir(), envName), { recursive: true, force: true });
  await rm(join(getStateDir(), "env-accounts", envName), {
    recursive: true,
    force: true,
  });
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
  const runtime = resolveRuntimePathsLocal(process.env, process.platform);
  const state = await (await loadCoreRuntime()).readLegacyState(getLegacyOptions());
  const support = await loadCoreSupportModules();
  let issues = 0;
  const codexCli = await support.resolveCommandPath("codex", process.env, process.platform);
  const codexApp = await support.resolveCodexAppPath(process.env, process.platform);
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
  const explicit = process.env.CODEX_BIN || process.env.CODEX_SWITCHER_CODEX_BIN;
  if (explicit) {
    return explicit;
  }
  const support = await loadCoreSupportModules();
  const resolved = await support.resolveCommandPath("codex", process.env, process.platform);
  return resolved?.path ?? null;
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
    });
  }
}

async function launchAppTarget(
  state: Awaited<ReturnType<CoreRuntime["readLegacyState"]>>,
  _runtime: CoreRuntime,
  strategy: "replace-current" | "new-window",
): Promise<void> {
  const env = state.envs[state.targets.app.env];
  if (!env) {
    throw new Error(`App env '${state.targets.app.env}' not found`);
  }
  const support = await loadCoreSupportModules();
  const action = strategy === "new-window" ? support.launchNewCodexApp : support.restartCurrentCodexApp;
  await action({
    codexHome: env.path,
    stateDir: getStateDir(),
  });
}
