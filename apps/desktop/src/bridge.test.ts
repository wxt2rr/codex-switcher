import test from "node:test";
import assert from "node:assert/strict";

import { createDesktopBridge } from "./bridge.js";

test("desktop bridge falls back to browser-safe stub when electron api is unavailable", async () => {
  const bridge = createDesktopBridge(undefined);

  await assert.rejects(() => bridge.loadOverview(), /desktop bridge unavailable/);
  await assert.rejects(() => bridge.loadAuthMetrics(), /desktop bridge unavailable/);
  await assert.rejects(() => bridge.getLanguage(), /desktop bridge unavailable/);
  await assert.rejects(() => bridge.writeClipboardText("secret"), /desktop bridge unavailable/);
  await assert.rejects(() => bridge.switchEnv("cli", "default"), /desktop bridge unavailable/);
  await assert.rejects(() => bridge.createEnv({ envName: "default", source: { kind: "default" } }), /desktop bridge unavailable/);
  await assert.rejects(() => bridge.deleteEnv("default"), /desktop bridge unavailable/);
  await assert.rejects(() => bridge.updateEnv("default", "default", "/tmp/default-home"), /desktop bridge unavailable/);
  await assert.rejects(() => bridge.readEnvConfig("default"), /desktop bridge unavailable/);
  await assert.rejects(
    () => bridge.updateEnvConfig("default", "model = \"gpt-5.5\"\n"),
    /desktop bridge unavailable/
  );
  await assert.rejects(
    () => bridge.switchAccount("app", "default", "personal"),
    /desktop bridge unavailable/
  );
  await assert.rejects(
    () => bridge.updateIndependentModel({ envName: "default", accountName: "personal", enabled: true, providerId: "custom" }),
    /desktop bridge unavailable/
  );
  await assert.rejects(() => bridge.listOperations(), /desktop bridge unavailable/);
  await assert.rejects(() => bridge.importDefaultEnv("project"), /desktop bridge unavailable/);
  await assert.rejects(() => bridge.stopManagedApp(), /desktop bridge unavailable/);
});

test("desktop bridge forwards calls to injected electron api", async () => {
  const calls: string[] = [];
  const bridge = createDesktopBridge({
    loadOverview: async () => {
      calls.push("loadOverview");
      return "{\"generatedAt\":\"2026-06-16T00:00:00.000Z\",\"status\":{\"cli\":{\"current\":\"default/default\",\"auth\":\"chatgpt\",\"authExpiry\":\"-\",\"loginState\":\"logged-in\"},\"app\":{\"current\":\"default/default\",\"auth\":\"chatgpt\",\"authExpiry\":\"-\",\"loginState\":\"logged-in\"},\"tokenRefresh\":{\"guard\":\"unknown\",\"needReloginLastRun\":\"0\"}},\"envs\":[],\"accounts\":[],\"recentTasks\":[]}";
    },
    loadAuthMetrics: async () => {
      calls.push("loadAuthMetrics");
      return "{\"accounts\":{},\"status\":{}}";
    },
    getCodexToolPaths: async () => [],
    getCliAutoResumeSettings: async () => {
      calls.push("getCliAutoResumeSettings");
      return { enabled: false, sessionNumber: 1 };
    },
    getEnvHistoryRetentionSettings: async () => {
      calls.push("getEnvHistoryRetentionSettings");
      return { enabled: false, retentionDays: 30 };
    },
    getGeneratedImageRecoverySettings: async () => ({
      enabled: false, installedEnvironments: 0, totalEnvironments: 2, conflicts: [],
    }),
    getAppEnvironmentBadgeStatus: async () => ({ enabled: false, supported: true, platform: "macos", permission: "denied", applied: 0, unresolved: 0 }),
    getRouterLifecycleSettings: async () => {
      calls.push("getRouterLifecycleSettings");
      return { stopOnAppQuit: false };
    },
    getRouterPortSettings: async () => {
      calls.push("getRouterPortSettings");
      return { preferredPort: 17832 };
    },
    detectCodexToolPaths: async () => [],
    setCodexToolPath: async (kind, path) => ({ kind, path, detectedPath: "", manualPath: path, source: "manual", available: true }),
    clearCodexToolPath: async (kind) => ({ kind, path: "", detectedPath: "", manualPath: "", source: "missing", available: false }),
    setCliAutoResumeSettings: async (value) => {
      calls.push(`setCliAutoResumeSettings:${value.enabled}:${value.sessionNumber}`);
      return value;
    },
    setEnvHistoryRetentionSettings: async (value) => {
      calls.push(`setEnvHistoryRetentionSettings:${value.enabled}:${value.retentionDays}`);
      return value;
    },
    setGeneratedImageRecoverySettings: async (value) => ({
      enabled: value.enabled, installedEnvironments: value.enabled ? 2 : 0, totalEnvironments: 2, conflicts: [],
    }),
    requestAppEnvironmentBadgePermission: async () => ({ enabled: false, supported: true, platform: "macos", permission: "granted", applied: 0, unresolved: 0 }),
    setAppEnvironmentBadgeSettings: async (value) => ({ enabled: value.enabled, supported: true, platform: "macos", permission: "granted", applied: value.enabled ? 2 : 0, unresolved: 0 }),
    setRouterLifecycleSettings: async (value) => {
      calls.push(`setRouterLifecycleSettings:${value.stopOnAppQuit}`);
      return value;
    },
    setRouterPortSettings: async (value) => {
      calls.push(`setRouterPortSettings:${value.preferredPort}`);
      return value;
    },
    getCliTerminalSettings: async () => ({ selectedId: "terminal", terminals: [{ id: "terminal", label: "Terminal", supportsCurrentWindow: true }] }),
    scanCliTerminalSettings: async () => ({ selectedId: "terminal", terminals: [{ id: "terminal", label: "Terminal", supportsCurrentWindow: true }] }),
    setCliTerminalSelection: async (id) => ({ selectedId: id, terminals: [{ id, label: id, supportsCurrentWindow: false }] }),
    getLanguage: async () => {
      calls.push("getLanguage");
      return "zh";
    },
    setLanguage: async (language) => {
      calls.push(`setLanguage:${language}`);
      return language;
    },
    writeClipboardText: async (value) => {
      calls.push(`writeClipboardText:${value}`);
    },
    nativeLogin: async (request) => {
      calls.push(`nativeLogin:${request.mode}:${request.account}:${request.envName}:${request.target}:${request.relogin ? "relogin" : "login"}`);
      return { message: "Logged in" };
    },
    switchEnv: async (target, envName) => {
      calls.push(`switchEnv:${target}:${envName}`);
      return { message: "ok" };
    },
    switchAccount: async (target, envName, accountName, strategy) => {
      calls.push(`switchAccount:${target}:${envName}:${accountName}:${strategy ?? "default"}`);
      return { message: "ok" };
    },
    listAccountProjects: async () => [],
    pickDirectory: async () => "",
    createEnv: async (request) => {
      calls.push(`createEnv:${request.envName}:${request.source.kind}:${request.source.envName ?? ""}`);
      return { message: "ok" };
    },
    deleteEnv: async (envName) => {
      calls.push(`deleteEnv:${envName}`);
      return { message: "ok" };
    },
    updateEnv: async (envName, nextEnvName, homePath) => {
      calls.push(`updateEnv:${envName}:${nextEnvName}:${homePath}`);
      return { message: "ok" };
    },
    readEnvConfig: async (envName) => {
      calls.push(`readEnvConfig:${envName}`);
      return "model = \"gpt-5.5\"\n";
    },
    readEnvFiles: async (envName) => {
      calls.push(`readEnvFiles:${envName}`);
      return "{\"configToml\":\"\",\"authJson\":\"\"}\n";
    },
    updateEnvConfig: async (envName, content) => {
      calls.push(`updateEnvConfig:${envName}:${content.length}`);
      return { message: "ok" };
    },
    updateEnvFiles: async (envName, files) => {
      calls.push(`updateEnvFiles:${envName}:${files.configToml.length}:${files.authJson.length}`);
      return { message: "ok" };
    },
    listEnvFileHistory: async (envName) => {
      calls.push(`listEnvFileHistory:${envName}`);
      return "[]\n";
    },
    restoreEnvFileHistory: async (envName, entryId) => {
      calls.push(`restoreEnvFileHistory:${envName}:${entryId}`);
      return { message: "ok" };
    },
    deleteEnvFileHistory: async (envName, entryIds) => {
      calls.push(`deleteEnvFileHistory:${envName}:${entryIds.length}`);
      return { message: "ok" };
    },
    updateRuntime: async (envName, accountName, baseUrl) => {
      calls.push(`updateRuntime:${envName}:${accountName}:${baseUrl}`);
      return { message: "ok" };
    },
    updateIndependentModel: async (request) => {
      calls.push(`updateIndependentModel:${request.envName}:${request.accountName}:${request.enabled ? "on" : "off"}`);
      return { message: "ok" };
    },
    listCustomModels: async () => ({ version: 1, models: [], accountBindings: {} }),
    saveCustomModel: async () => ({ version: 1, models: [], accountBindings: {} }),
    deleteCustomModel: async () => ({ version: 1, models: [], accountBindings: {} }),
    setAccountModelBindings: async () => ({ version: 1, models: [], accountBindings: {} }),
    setModelAccountBindings: async () => ({ version: 1, models: [], accountBindings: {} }),
    logoutAccount: async (envName, accountName, target) => {
      calls.push(`logoutAccount:${envName}:${accountName}:${target}`);
      return { message: "ok" };
    },
    deleteAccount: async (envName, accountName) => {
      calls.push(`deleteAccount:${envName}:${accountName}`);
      return { message: "ok" };
    },
    copyAccount: async (sourceEnvName, sourceAccountName, targetEnvName) => {
      calls.push(`copyAccount:${sourceEnvName}:${sourceAccountName}:${targetEnvName}`);
      return { message: "ok" };
    },
    showProxy: async () => {
      calls.push("showProxy");
      return { message: "ok" };
    },
    setProxy: async (value) => {
      calls.push(`setProxy:${value}`);
      return { message: "ok" };
    },
    disableProxy: async () => {
      calls.push("disableProxy");
      return { message: "ok" };
    },
    testProxy: async () => {
      calls.push("testProxy");
      return { message: "ok" };
    },
    startTokenRefresh: async () => {
      calls.push("startTokenRefresh");
      return { message: "ok" };
    },
    stopTokenRefresh: async () => {
      calls.push("stopTokenRefresh");
      return { message: "ok" };
    },
    readTokenRefreshStatus: async () => {
      calls.push("readTokenRefreshStatus");
      return { message: "ok" };
    },
    runTokenRefreshOnce: async () => {
      calls.push("runTokenRefreshOnce");
      return { message: "ok" };
    },
    listOperations: async () => {
      calls.push("listOperations");
      return { message: "ok" };
    },
    importDefaultEnv: async (envName, options) => {
      calls.push(`importDefaultEnv:${envName}:${options?.withAuth ? "with-auth" : "no-auth"}:${options?.force ? "force" : "safe"}`);
      return { message: "ok" };
    },
    launchCliInTerminal: async () => {
      calls.push("launchCliInTerminal");
      return { message: "ok" };
    },
    readAppStatus: async () => {
      calls.push("readAppStatus");
      return { message: "ok" };
    },
    logoutApp: async (accountName) => {
      calls.push(`logoutApp:${accountName ?? ""}`);
      return { message: "ok" };
    },
    stopManagedApp: async () => {
      calls.push("stopManagedApp");
      return { message: "ok" };
    },
    runDoctor: async () => {
      calls.push("runDoctor");
      return { message: "ok" };
    },
    runRecover: async () => {
      calls.push("runRecover");
      return { message: "ok" };
    },
    readSwitcherLog: async () => {
      calls.push("readSwitcherLog");
      return { kind: "switcher", content: "log output" };
    },
    readTokenRefreshLog: async () => {
      calls.push("readTokenRefreshLog");
      return { kind: "token-refresh", content: "log output" };
    },
    getEnvironmentRouteStatuses: async () => [],
    toggleEnvironmentRoute: async (envName, enabled) => ({ envName, enabled, routedAccounts: enabled ? 1 : 0, port: enabled ? 17832 : null }),
    toggleAccountCompatibility: async (input) => {
      calls.push(`toggleAccountCompatibility:${input.envName}:${input.accountName}:${input.enabled}`);
      return { envName: input.envName, accountName: input.accountName, enabled: input.enabled, state: input.enabled ? "ready" : "disabled" };
    },
    getAccountCompatibilityStatuses: async (keys) => {
      calls.push(`getAccountCompatibilityStatuses:${keys.join(",")}`);
      return [];
    },
    listAccountPools: async () => [],
    saveAccountPool: async () => null,
    checkAccountCompatibility: async (envName, accountName) => {
      calls.push(`checkAccountCompatibility:${envName}:${accountName}`);
      return { ok: true, status: 200, message: "ok" };
    },
    loadUsageSnapshot: async () => ({ generatedAt: Date.now(), summary: { requests: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, actualCost: null, standardCost: null, requestsWithoutUsage: 0, cacheHitRate: null }, models: [], baseUrls: [], trend: [] }),
    loadUsageRequests: async (query) => {
      calls.push(`loadUsageRequests:${query.baseUrl}:${query.page}:${query.pageSize}`);
      return { generatedAt: Date.now(), items: [], total: 0,
        page: query.page, pageSize: query.pageSize, totalPages: 1,
        facets: { envNames: [], accountNames: [], models: [], endpoints: [], poolIds: [], failoverReasons: [] } };
    },
    listUsagePricing: async () => [],
    saveUsagePricing: async () => undefined,
    getSkillSnapshot: async () => ({
      marketplace: { items: [], status: "link-only", externalUrl: "https://skills.sh" },
      scopes: [{ id: "marketplace", kind: "marketplace", name: "Marketplace", skills: [] }],
      bindings: [],
    }),
    installSkill: async (input) => ({ id: input.skillName ?? "skill", name: input.skillName ?? "Skill",
      description: "", path: "/tmp/skill", scopeId: `codex:${input.envName}`, managed: true, linked: false, state: "healthy" }),
    checkSkillUpdates: async () => ({}),
    updateSkill: async (input) => ({ id: input.skillId, name: input.skillId, description: "", path: "/tmp/skill",
      scopeId: `codex:${input.envName}`, managed: true, linked: false, state: "healthy" }),
    uninstallSkill: async () => undefined,
    setSkillProviderBinding: async (input) => ({ providerId: input.providerId, name: input.providerId, custom: false, enabled: input.enabled,
      sourceEnv: input.sourceEnv, targetPath: input.targetPath ?? "/tmp/skills",
      status: input.enabled ? "healthy" : "disabled", managedLinks: 0, conflicts: 0 }),
    createSkillProvider: async (input) => ({ providerId: "custom:test", name: input.name, custom: true,
      enabled: false, targetPath: input.targetPath, status: "disabled", managedLinks: 0, conflicts: 0 }),
    deleteSkillProvider: async () => undefined,
    repairSkillProvider: async (providerId) => ({ providerId, name: providerId, custom: false, enabled: false, targetPath: "/tmp/skills",
      status: "disabled", managedLinks: 0, conflicts: 0 }),
  });

  await bridge.loadOverview();
  await bridge.loadAuthMetrics();
  await bridge.getCliAutoResumeSettings();
  await bridge.setCliAutoResumeSettings({ enabled: true, sessionNumber: 2 });
  await bridge.getEnvHistoryRetentionSettings();
  await bridge.setEnvHistoryRetentionSettings({ enabled: true, retentionDays: 45 });
  await bridge.getRouterLifecycleSettings();
  await bridge.setRouterLifecycleSettings({ stopOnAppQuit: true });
  await bridge.getRouterPortSettings();
  await bridge.setRouterPortSettings({ preferredPort: 19090 });
  await bridge.getLanguage();
  await bridge.setLanguage("ja");
  await bridge.writeClipboardText("sk-secret");
  await bridge.nativeLogin({
    mode: "auth",
    account: "personal",
    envName: "default",
    target: "cli",
    relogin: false,
  });
  await bridge.switchEnv("cli", "project");
  await bridge.switchAccount("app", "project", "personal", "multi-window");
  await bridge.createEnv({ envName: "sandbox", source: { kind: "default" } });
  await bridge.deleteEnv("sandbox");
  await bridge.updateEnv("sandbox", "sandbox-next", "/tmp/sandbox-home");
  await bridge.readEnvConfig("sandbox");
  await bridge.updateEnvConfig("sandbox", "model = \"gpt-5.5\"\n");
  await bridge.updateRuntime("project", "personal", "default");
  await bridge.updateIndependentModel({
    envName: "project",
    accountName: "personal",
    enabled: true,
    providerId: "gateway",
    apiKey: "sk-demo",
    baseUrl: "https://api.example.test/v1",
  });
  await bridge.logoutAccount("project", "personal", "cli");
  await bridge.deleteAccount("project", "personal");
  await bridge.copyAccount("project", "personal", "sandbox");
  await bridge.showProxy();
  await bridge.setProxy("http://127.0.0.1:7890");
  await bridge.disableProxy();
  await bridge.testProxy();
  await bridge.startTokenRefresh();
  await bridge.stopTokenRefresh();
  await bridge.readTokenRefreshStatus();
  await bridge.runTokenRefreshOnce();
  await bridge.listOperations();
  await bridge.importDefaultEnv("project", { withAuth: true, force: true });
  await bridge.launchCliInTerminal();
  await bridge.readAppStatus();
  await bridge.logoutApp("personal");
  await bridge.stopManagedApp();
  await bridge.runDoctor();
  await bridge.runRecover();
  await bridge.readSwitcherLog();
  await bridge.readTokenRefreshLog();
  await bridge.toggleAccountCompatibility({ envName: "project", accountName: "personal", enabled: true, upstreamModel: "model" });
  await bridge.getAccountCompatibilityStatuses(["project/personal"]);
  await bridge.checkAccountCompatibility("project", "personal");
  await bridge.loadUsageRequests({ from: 0, to: 1000, baseUrl: "https://api.example.com/v1", page: 1, pageSize: 20 });

  assert.deepEqual(calls, [
    "loadOverview",
    "loadAuthMetrics",
    "getCliAutoResumeSettings",
    "setCliAutoResumeSettings:true:2",
    "getEnvHistoryRetentionSettings",
    "setEnvHistoryRetentionSettings:true:45",
    "getRouterLifecycleSettings",
    "setRouterLifecycleSettings:true",
    "getRouterPortSettings",
    "setRouterPortSettings:19090",
    "getLanguage",
    "setLanguage:ja",
    "writeClipboardText:sk-secret",
    "nativeLogin:auth:personal:default:cli:login",
    "switchEnv:cli:project",
    "switchAccount:app:project:personal:multi-window",
    "createEnv:sandbox:default:",
    "deleteEnv:sandbox",
    "updateEnv:sandbox:sandbox-next:/tmp/sandbox-home",
    "readEnvConfig:sandbox",
    "updateEnvConfig:sandbox:18",
    "updateRuntime:project:personal:default",
    "updateIndependentModel:project:personal:on",
    "logoutAccount:project:personal:cli",
    "deleteAccount:project:personal",
    "copyAccount:project:personal:sandbox",
    "showProxy",
    "setProxy:http://127.0.0.1:7890",
    "disableProxy",
    "testProxy",
    "startTokenRefresh",
    "stopTokenRefresh",
    "readTokenRefreshStatus",
    "runTokenRefreshOnce",
    "listOperations",
    "importDefaultEnv:project:with-auth:force",
    "launchCliInTerminal",
    "readAppStatus",
    "logoutApp:personal",
    "stopManagedApp",
    "runDoctor",
    "runRecover",
    "readSwitcherLog",
    "readTokenRefreshLog",
    "toggleAccountCompatibility:project:personal:true",
    "getAccountCompatibilityStatuses:project/personal",
    "checkAccountCompatibility:project:personal",
    "loadUsageRequests:https://api.example.com/v1:1:20",
  ]);
});
