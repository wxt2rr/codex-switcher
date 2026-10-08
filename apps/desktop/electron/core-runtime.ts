import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  getConfiguredResourcesPath,
  resolveRuntimeResource,
  resolveRuntimeRoot,
} from "./runtime-paths.js";

export interface CoreRuntime {
  createCoreApi: typeof import("../../../packages/core/dist/api/core-api.js").createCoreApi;
  createLegacyEnv: typeof import("../../../packages/core/dist/state/legacy.js").createLegacyEnv;
  readLegacyState: typeof import("../../../packages/core/dist/state/legacy.js").readLegacyState;
  updateLegacyEnv: typeof import("../../../packages/core/dist/state/legacy.js").updateLegacyEnv;
  writeLegacyPointers: typeof import("../../../packages/core/dist/state/legacy.js").writeLegacyPointers;
  writeLegacyRuntime: typeof import("../../../packages/core/dist/state/legacy.js").writeLegacyRuntime;
  writeLegacyGateway: typeof import("../../../packages/core/dist/state/legacy.js").writeLegacyGateway;
  writeLegacyGatewayV2: typeof import("../../../packages/core/dist/state/legacy.js").writeLegacyGatewayV2;
  readLegacyGatewayV2: typeof import("../../../packages/core/dist/state/legacy.js").readLegacyGatewayV2;
  clearLegacyGateway: typeof import("../../../packages/core/dist/state/legacy.js").clearLegacyGateway;
  buildLegacyGatewayEnvironmentState: typeof import("../../../packages/core/dist/gateway/legacy-adapter.js").buildLegacyGatewayEnvironmentState;
  applyTargetHomeState: typeof import("../../../packages/core/dist/system/target-home.js").applyTargetHomeState;
  repairLegacyTargetHomeConfigs: typeof import("../../../packages/core/dist/system/target-home.js").repairLegacyTargetHomeConfigs;
}

export interface GatewayProviderRuntime {
  createBuiltInProviderAdapters: typeof import("../../../packages/gateway/dist/provider/adapters.js").createBuiltInProviderAdapters;
}

export interface GatewayPluginRuntime {
  ProviderPluginManager: typeof import("../../../packages/gateway/dist/plugin/manager.js").ProviderPluginManager;
  PluginMarket: typeof import("../../../packages/gateway/dist/plugin/market.js").PluginMarket;
  verifyPluginManifestSignature: typeof import("../../../packages/gateway/dist/plugin/signing.js").verifyPluginManifestSignature;
}

export interface GatewayAgentRuntime {
  createAgentAdapter: typeof import("../../../packages/gateway/dist/agent/adapter.js").createAgentAdapter;
  createNodeAgentFileSystem: typeof import("../../../packages/gateway/dist/agent/adapter.js").createNodeAgentFileSystem;
  BUILT_IN_AGENT_PROFILES: typeof import("../../../packages/gateway/dist/agent/profiles.js").BUILT_IN_AGENT_PROFILES;
}

type CoreApiModule = typeof import("../../../packages/core/dist/api/core-api.js");
type LegacyModule = typeof import("../../../packages/core/dist/state/legacy.js");
type GatewayLegacyAdapterModule = typeof import("../../../packages/core/dist/gateway/legacy-adapter.js");
type GatewayPluginRuntimeModule = typeof import("../../../packages/gateway/dist/plugin/manager.js");
type GatewayPluginMarketModule = typeof import("../../../packages/gateway/dist/plugin/market.js");
type GatewayPluginSigningModule = typeof import("../../../packages/gateway/dist/plugin/signing.js");
type GatewayAgentAdapterModule = typeof import("../../../packages/gateway/dist/agent/adapter.js");
type GatewayAgentProfilesModule = typeof import("../../../packages/gateway/dist/agent/profiles.js");
type TargetHomeModule = typeof import("../../../packages/core/dist/system/target-home.js");
type OsModule = typeof import("../../../packages/core/dist/platform/os.js");
type CommandDiscoveryModule = typeof import("../../../packages/core/dist/platform/command-discovery.js");
type ProxyModule = typeof import("../../../packages/core/dist/platform/proxy.js");
type RuntimeModule = typeof import("../../../packages/core/dist/platform/runtime.js");
type TaskRunnerModule = typeof import("../../../packages/core/dist/tasks/task-runner.js");
type AccountServiceModule = typeof import("../../../packages/core/dist/domain/account-service.js");
type EnvServiceModule = typeof import("../../../packages/core/dist/domain/env-service.js");
type CodexAppModule = typeof import("../../../packages/core/dist/platform/codex-app.js");
type CodexAppRuntimeModule = typeof import("../../../packages/core/dist/platform/codex-app-runtime.js");
type DesktopOperationsFactory = {
  createDesktopOperationsService(options: unknown): unknown;
};

export interface CoreSupportModules {
  detectPlatform: OsModule["detectPlatform"];
  codexCliCandidatePaths: CommandDiscoveryModule["codexCliCandidatePaths"];
  getWindowsReadinessSnapshot: CommandDiscoveryModule["getWindowsReadinessSnapshot"];
  resolveCodexAppPath: CommandDiscoveryModule["resolveCodexAppPath"];
  resolveCommandPath: CommandDiscoveryModule["resolveCommandPath"];
  clearManualUsageProxy: ProxyModule["clearManualUsageProxy"];
  disableUsageProxy: ProxyModule["disableUsageProxy"];
  readUsageProxyState: ProxyModule["readUsageProxyState"];
  setManualUsageProxy: ProxyModule["setManualUsageProxy"];
  createTaskRunner: TaskRunnerModule["createTaskRunner"];
  createAccountService: AccountServiceModule["createAccountService"];
  createEnvService: EnvServiceModule["createEnvService"];
  launchNewCodexApp: CodexAppModule["launchNewCodexApp"];
  resolveWindowsAppLauncher: CodexAppModule["resolveWindowsAppLauncher"];
  restartCurrentCodexApp: CodexAppModule["restartCurrentCodexApp"];
  stopManagedCodexApp: CodexAppModule["stopManagedCodexApp"];
  readManagedAppPid: CodexAppRuntimeModule["readManagedAppPid"];
  listManagedAppInstances: CodexAppRuntimeModule["listManagedAppInstances"];
  reconcileManagedAppInstanceCount: CodexAppRuntimeModule["reconcileManagedAppInstanceCount"];
  resolveManagedAppStatePaths: CodexAppRuntimeModule["resolveManagedAppStatePaths"];
  resolveRuntimePaths: RuntimeModule["resolveRuntimePaths"];
}

let desktopOperationsModuleOverride:
  | DesktopOperationsFactory
  | undefined;
let coreSupportModulesPromise: Promise<CoreSupportModules> | undefined;

export async function loadCoreRuntime(): Promise<CoreRuntime> {
  const baseDir = getCoreDist();

  const [apiModule, legacyModule, gatewayLegacyAdapterModule, targetHomeModule] = await Promise.all([
    importModule<CoreApiModule>(join(baseDir, "api", "core-api.js")),
    importModule<LegacyModule>(join(baseDir, "state", "legacy.js")),
    importFirstExisting<GatewayLegacyAdapterModule>([
      join(baseDir, "gateway", "legacy-adapter.js"),
      join(getSourceRepoRoot(), "packages", "core", "src", "gateway", "legacy-adapter.ts"),
    ]),
    importModule<TargetHomeModule>(join(baseDir, "system", "target-home.js")),
  ]);

  return {
    createCoreApi: apiModule.createCoreApi,
    createLegacyEnv: legacyModule.createLegacyEnv,
    readLegacyState: legacyModule.readLegacyState,
    updateLegacyEnv: legacyModule.updateLegacyEnv,
    writeLegacyPointers: legacyModule.writeLegacyPointers,
    writeLegacyRuntime: legacyModule.writeLegacyRuntime,
    writeLegacyGateway: legacyModule.writeLegacyGateway,
    writeLegacyGatewayV2: legacyModule.writeLegacyGatewayV2,
    readLegacyGatewayV2: legacyModule.readLegacyGatewayV2,
    clearLegacyGateway: legacyModule.clearLegacyGateway,
    buildLegacyGatewayEnvironmentState: gatewayLegacyAdapterModule.buildLegacyGatewayEnvironmentState,
    applyTargetHomeState: targetHomeModule.applyTargetHomeState,
    repairLegacyTargetHomeConfigs: targetHomeModule.repairLegacyTargetHomeConfigs,
  };
}

export async function loadGatewayProviderRuntime(): Promise<GatewayProviderRuntime> {
  const runtimePath = resolveRuntimeResource(join("packages", "gateway", "dist", "provider", "adapters.js"), {
    currentFile: resolveCurrentFile(),
    resourcesPath: getConfiguredResourcesPath(),
  });
  const sourcePath = join(getSourceRepoRoot(), "packages", "gateway", "src", "provider", "adapters.ts");
  const module = await importFirstExisting<typeof import("../../../packages/gateway/dist/provider/adapters.js")>([runtimePath, sourcePath]);
  return { createBuiltInProviderAdapters: module.createBuiltInProviderAdapters };
}

export async function loadGatewayPluginRuntime(): Promise<GatewayPluginRuntime> {
  const runtimeRoot = resolveRuntimeResource(join("packages", "gateway", "dist", "plugin"), {
    currentFile: resolveCurrentFile(),
    resourcesPath: getConfiguredResourcesPath(),
  });
  const sourceRoot = join(getSourceRepoRoot(), "packages", "gateway", "src", "plugin");
  const [manager, market, signing] = await Promise.all([
    importFirstExisting<GatewayPluginRuntimeModule>([
      join(runtimeRoot, "manager.js"),
      join(sourceRoot, "manager.ts"),
    ]),
    importFirstExisting<GatewayPluginMarketModule>([
      join(runtimeRoot, "market.js"),
      join(sourceRoot, "market.ts"),
    ]),
    importFirstExisting<GatewayPluginSigningModule>([
      join(runtimeRoot, "signing.js"),
      join(sourceRoot, "signing.ts"),
    ]),
  ]);
  return {
    ProviderPluginManager: manager.ProviderPluginManager,
    PluginMarket: market.PluginMarket,
    verifyPluginManifestSignature: signing.verifyPluginManifestSignature,
  };
}

export async function loadGatewayAgentRuntime(): Promise<GatewayAgentRuntime> {
  const adapterRuntimePath = resolveRuntimeResource(join("packages", "gateway", "dist", "agent", "adapter.js"), {
    currentFile: resolveCurrentFile(),
    resourcesPath: getConfiguredResourcesPath(),
  });
  const profilesRuntimePath = resolveRuntimeResource(join("packages", "gateway", "dist", "agent", "profiles.js"), {
    currentFile: resolveCurrentFile(),
    resourcesPath: getConfiguredResourcesPath(),
  });
  const sourceRoot = join(getSourceRepoRoot(), "packages", "gateway", "src", "agent");
  const [adapter, profiles] = await Promise.all([
    importFirstExisting<GatewayAgentAdapterModule>([adapterRuntimePath, join(sourceRoot, "adapter.ts")]),
    importFirstExisting<GatewayAgentProfilesModule>([profilesRuntimePath, join(sourceRoot, "profiles.ts")]),
  ]);
  return {
    createAgentAdapter: adapter.createAgentAdapter,
    createNodeAgentFileSystem: adapter.createNodeAgentFileSystem,
    BUILT_IN_AGENT_PROFILES: profiles.BUILT_IN_AGENT_PROFILES,
  };
}

export async function loadDesktopOperationsModule(): Promise<
  DesktopOperationsFactory
> {
  if (desktopOperationsModuleOverride) {
    return desktopOperationsModuleOverride;
  }

  const baseDir = getCoreDist();

  const candidates = [join(baseDir, "services", "desktop-operations.js")];
  if (!existsSync(candidates[0])) {
    candidates.push(
      join(getSourceRepoRoot(), "packages", "core", "src", "services", "desktop-operations.ts"),
    );
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return importModule<DesktopOperationsFactory>(candidate);
    }
  }

  throw new Error("Unable to resolve desktop operations module");
}

export function setDesktopOperationsModuleOverrideForTest(
  moduleOverride: DesktopOperationsFactory | undefined,
): void {
  desktopOperationsModuleOverride = moduleOverride;
}

export async function loadCoreSupportModules(): Promise<CoreSupportModules> {
  if (!coreSupportModulesPromise) {
    coreSupportModulesPromise = loadCoreSupportModulesImpl();
  }
  return coreSupportModulesPromise;
}

async function loadCoreSupportModulesImpl(): Promise<CoreSupportModules> {
  const distBaseDir = getCoreDist();
  const srcBaseDir = existsSync(join(distBaseDir, "platform", "os.js"))
    ? undefined
    : join(getSourceRepoRoot(), "packages", "core", "src");

  const moduleCandidates = (distPath: string, srcPath: string): string[] => {
    const candidates = [join(distBaseDir, distPath)];
    if (srcBaseDir) {
      candidates.push(join(srcBaseDir, srcPath));
    }
    return candidates;
  };

  const [
    osModule,
    commandDiscoveryModule,
    proxyModule,
    taskRunnerModule,
    accountServiceModule,
    envServiceModule,
    codexAppModule,
    codexAppRuntimeModule,
    runtimeModule,
  ] = await Promise.all([
    importFirstExisting<OsModule>(moduleCandidates("platform/os.js", "platform/os.ts")),
    importFirstExisting<CommandDiscoveryModule>(moduleCandidates("platform/command-discovery.js", "platform/command-discovery.ts")),
    importFirstExisting<ProxyModule>(moduleCandidates("platform/proxy.js", "platform/proxy.ts")),
    importFirstExisting<TaskRunnerModule>(moduleCandidates("tasks/task-runner.js", "tasks/task-runner.ts")),
    importFirstExisting<AccountServiceModule>(moduleCandidates("domain/account-service.js", "domain/account-service.ts")),
    importFirstExisting<EnvServiceModule>(moduleCandidates("domain/env-service.js", "domain/env-service.ts")),
    importFirstExisting<CodexAppModule>(moduleCandidates("platform/codex-app.js", "platform/codex-app.ts")),
    importFirstExisting<CodexAppRuntimeModule>(moduleCandidates("platform/codex-app-runtime.js", "platform/codex-app-runtime.ts")),
    importFirstExisting<RuntimeModule>(moduleCandidates("platform/runtime.js", "platform/runtime.ts")),
  ]);

  return {
    detectPlatform: osModule.detectPlatform,
    codexCliCandidatePaths: commandDiscoveryModule.codexCliCandidatePaths,
    getWindowsReadinessSnapshot: commandDiscoveryModule.getWindowsReadinessSnapshot,
    resolveCodexAppPath: commandDiscoveryModule.resolveCodexAppPath,
    resolveCommandPath: commandDiscoveryModule.resolveCommandPath,
    clearManualUsageProxy: proxyModule.clearManualUsageProxy,
    disableUsageProxy: proxyModule.disableUsageProxy,
    readUsageProxyState: proxyModule.readUsageProxyState,
    setManualUsageProxy: proxyModule.setManualUsageProxy,
    createTaskRunner: taskRunnerModule.createTaskRunner,
    createAccountService: accountServiceModule.createAccountService,
    createEnvService: envServiceModule.createEnvService,
    launchNewCodexApp: codexAppModule.launchNewCodexApp,
    resolveWindowsAppLauncher: codexAppModule.resolveWindowsAppLauncher,
    restartCurrentCodexApp: codexAppModule.restartCurrentCodexApp,
    stopManagedCodexApp: codexAppModule.stopManagedCodexApp,
    readManagedAppPid: codexAppRuntimeModule.readManagedAppPid,
    listManagedAppInstances: codexAppRuntimeModule.listManagedAppInstances,
    reconcileManagedAppInstanceCount: codexAppRuntimeModule.reconcileManagedAppInstanceCount,
    resolveManagedAppStatePaths: codexAppRuntimeModule.resolveManagedAppStatePaths,
    resolveRuntimePaths: runtimeModule.resolveRuntimePaths,
  };
}

async function importModule<T>(modulePath: string): Promise<T> {
  return Function("specifier", "return import(specifier)")(
    pathToFileURL(modulePath).href,
  ) as Promise<T>;
}

async function importFirstExisting<T>(candidates: string[]): Promise<T> {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return importModule<T>(candidate);
    }
  }

  throw new Error(`Unable to resolve module from candidates: ${candidates.join(", ")}`);
}

function resolveCurrentFile(): string {
  if (typeof __filename === "string") {
    return __filename;
  }

  try {
    const metaUrl = (0, eval)("import.meta.url") as string | undefined;
    if (typeof metaUrl === "string" && metaUrl) {
      return fileURLToPath(metaUrl);
    }
  } catch {
    // Ignore and fall through to the explicit error below.
  }

  const candidates = [
    join(process.cwd(), "electron"),
    join(process.cwd(), "apps", "desktop", "electron"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return join(candidate, "core-runtime.ts");
    }
  }

  throw new Error("Unable to resolve current bridge file path");
}

function getRepoRoot(): string {
  return resolveRuntimeRoot({
    currentFile: resolveCurrentFile(),
    resourcesPath: getConfiguredResourcesPath(),
  });
}

function getSourceRepoRoot(): string {
  // Packaged Electron builds keep the compiled Core/Gateway runtime in
  // process.resourcesPath. The source fallback is still needed in development,
  // but resolving it eagerly must not fail before the packaged dist module is
  // selected.
  return resolveRuntimeRoot({
    currentFile: resolveCurrentFile(),
    resourcesPath: getConfiguredResourcesPath(),
  });
}

function getCoreDist(): string {
  return resolveRuntimeResource(join("packages", "core", "dist"), {
    currentFile: resolveCurrentFile(),
    resourcesPath: getConfiguredResourcesPath(),
  });
}
