import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface CoreRuntime {
  createCoreApi: typeof import("../../../packages/core/dist/api/core-api.js").createCoreApi;
  createLegacyEnv: typeof import("../../../packages/core/dist/state/legacy.js").createLegacyEnv;
  readLegacyState: typeof import("../../../packages/core/dist/state/legacy.js").readLegacyState;
  updateLegacyEnv: typeof import("../../../packages/core/dist/state/legacy.js").updateLegacyEnv;
  writeLegacyPointers: typeof import("../../../packages/core/dist/state/legacy.js").writeLegacyPointers;
  writeLegacyRuntime: typeof import("../../../packages/core/dist/state/legacy.js").writeLegacyRuntime;
  applyTargetHomeState: typeof import("../../../packages/core/dist/system/target-home.js").applyTargetHomeState;
}

type CoreApiModule = typeof import("../../../packages/core/dist/api/core-api.js");
type LegacyModule = typeof import("../../../packages/core/dist/state/legacy.js");
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
  resolveManagedAppStatePaths: CodexAppRuntimeModule["resolveManagedAppStatePaths"];
  resolveRuntimePaths: RuntimeModule["resolveRuntimePaths"];
}

let desktopOperationsModuleOverride:
  | DesktopOperationsFactory
  | undefined;
let coreSupportModulesPromise: Promise<CoreSupportModules> | undefined;

export async function loadCoreRuntime(): Promise<CoreRuntime> {
  const bundledCoreDist = getBundledCoreDist();
  const workspaceCoreDist = getWorkspaceCoreDist();
  const baseDir = existsSync(bundledCoreDist) ? bundledCoreDist : workspaceCoreDist;

  const [apiModule, legacyModule, targetHomeModule] = await Promise.all([
    importModule<CoreApiModule>(join(baseDir, "api", "core-api.js")),
    importModule<LegacyModule>(join(baseDir, "state", "legacy.js")),
    importModule<TargetHomeModule>(join(baseDir, "system", "target-home.js")),
  ]);

  return {
    createCoreApi: apiModule.createCoreApi,
    createLegacyEnv: legacyModule.createLegacyEnv,
    readLegacyState: legacyModule.readLegacyState,
    updateLegacyEnv: legacyModule.updateLegacyEnv,
    writeLegacyPointers: legacyModule.writeLegacyPointers,
    writeLegacyRuntime: legacyModule.writeLegacyRuntime,
    applyTargetHomeState: targetHomeModule.applyTargetHomeState,
  };
}

export async function loadDesktopOperationsModule(): Promise<
  DesktopOperationsFactory
> {
  if (desktopOperationsModuleOverride) {
    return desktopOperationsModuleOverride;
  }

  const bundledCoreDist = getBundledCoreDist();
  const workspaceCoreDist = getWorkspaceCoreDist();
  const baseDir = existsSync(bundledCoreDist) ? bundledCoreDist : workspaceCoreDist;

  const candidates = [
    join(baseDir, "services", "desktop-operations.js"),
    join(getRepoRoot(), "packages", "core", "src", "services", "desktop-operations.ts"),
  ];

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
  const bundledCoreDist = getBundledCoreDist();
  const workspaceCoreDist = getWorkspaceCoreDist();
  const distBaseDir = existsSync(bundledCoreDist) ? bundledCoreDist : workspaceCoreDist;
  const srcBaseDir = join(getRepoRoot(), "packages", "core", "src");

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
    importFirstExisting<OsModule>([
      join(distBaseDir, "platform", "os.js"),
      join(srcBaseDir, "platform", "os.ts"),
    ]),
    importFirstExisting<CommandDiscoveryModule>([
      join(distBaseDir, "platform", "command-discovery.js"),
      join(srcBaseDir, "platform", "command-discovery.ts"),
    ]),
    importFirstExisting<ProxyModule>([
      join(distBaseDir, "platform", "proxy.js"),
      join(srcBaseDir, "platform", "proxy.ts"),
    ]),
    importFirstExisting<TaskRunnerModule>([
      join(distBaseDir, "tasks", "task-runner.js"),
      join(srcBaseDir, "tasks", "task-runner.ts"),
    ]),
    importFirstExisting<AccountServiceModule>([
      join(distBaseDir, "domain", "account-service.js"),
      join(srcBaseDir, "domain", "account-service.ts"),
    ]),
    importFirstExisting<EnvServiceModule>([
      join(distBaseDir, "domain", "env-service.js"),
      join(srcBaseDir, "domain", "env-service.ts"),
    ]),
    importFirstExisting<CodexAppModule>([
      join(distBaseDir, "platform", "codex-app.js"),
      join(srcBaseDir, "platform", "codex-app.ts"),
    ]),
    importFirstExisting<CodexAppRuntimeModule>([
      join(distBaseDir, "platform", "codex-app-runtime.js"),
      join(srcBaseDir, "platform", "codex-app-runtime.ts"),
    ]),
    importFirstExisting<RuntimeModule>([
      join(distBaseDir, "platform", "runtime.js"),
      join(srcBaseDir, "platform", "runtime.ts"),
    ]),
  ]);

  return {
    detectPlatform: osModule.detectPlatform,
    codexCliCandidatePaths: commandDiscoveryModule.codexCliCandidatePaths,
    getWindowsReadinessSnapshot: commandDiscoveryModule.getWindowsReadinessSnapshot,
    resolveCodexAppPath: commandDiscoveryModule.resolveCodexAppPath,
    resolveCommandPath: commandDiscoveryModule.resolveCommandPath,
    clearManualUsageProxy: proxyModule.clearManualUsageProxy,
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

function getAppDir(): string {
  return dirname(dirname(resolveCurrentFile()));
}

function resolveRepoRoot(): string {
  const appDir = getAppDir();
  let current = join(appDir, "..");

  for (let index = 0; index < 10; index += 1) {
    const packageJsonPath = join(current, "package.json");
    const corePath = join(current, "packages", "core", "dist", "api", "core-api.js");
    if (existsSync(packageJsonPath) && existsSync(corePath)) {
      return current;
    }
    current = dirname(current);
  }

  throw new Error("Unable to resolve codex-switcher workspace root");
}

function getRepoRoot(): string {
  return resolveRepoRoot();
}

function getBundledCoreDist(): string {
  return join(getAppDir(), "..", "packages", "core", "dist");
}

function getWorkspaceCoreDist(): string {
  return join(getRepoRoot(), "packages", "core", "dist");
}
