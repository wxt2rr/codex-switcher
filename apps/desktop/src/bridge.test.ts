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
    detectCodexToolPaths: async () => [],
    setCodexToolPath: async (kind, path) => ({ kind, path, detectedPath: "", manualPath: path, source: "manual", available: true }),
    clearCodexToolPath: async (kind) => ({ kind, path: "", detectedPath: "", manualPath: "", source: "missing", available: false }),
    setCliAutoResumeSettings: async (value) => {
      calls.push(`setCliAutoResumeSettings:${value.enabled}:${value.sessionNumber}`);
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
    switchAccount: async (target, envName, accountName) => {
      calls.push(`switchAccount:${target}:${envName}:${accountName}`);
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
    logoutAccount: async (envName, accountName, target) => {
      calls.push(`logoutAccount:${envName}:${accountName}:${target}`);
      return { message: "ok" };
    },
    deleteAccount: async (envName, accountName) => {
      calls.push(`deleteAccount:${envName}:${accountName}`);
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
    loadUsageSnapshot: async () => ({ generatedAt: Date.now(), summary: { requests: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, actualCost: null, standardCost: null, requestsWithoutUsage: 0, cacheHitRate: null }, models: [], baseUrls: [], trend: [] }),
    listUsagePricing: async () => [],
    saveUsagePricing: async () => undefined,
  });

  await bridge.loadOverview();
  await bridge.loadAuthMetrics();
  await bridge.getCliAutoResumeSettings();
  await bridge.setCliAutoResumeSettings({ enabled: true, sessionNumber: 2 });
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
  await bridge.switchAccount("app", "project", "personal");
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

  assert.deepEqual(calls, [
    "loadOverview",
    "loadAuthMetrics",
    "getCliAutoResumeSettings",
    "setCliAutoResumeSettings:true:2",
    "getLanguage",
    "setLanguage:ja",
    "writeClipboardText:sk-secret",
    "nativeLogin:auth:personal:default:cli:login",
    "switchEnv:cli:project",
    "switchAccount:app:project:personal",
    "createEnv:sandbox:default:",
    "deleteEnv:sandbox",
    "updateEnv:sandbox:sandbox-next:/tmp/sandbox-home",
    "readEnvConfig:sandbox",
    "updateEnvConfig:sandbox:18",
    "updateRuntime:project:personal:default",
    "updateIndependentModel:project:personal:on",
    "logoutAccount:project:personal:cli",
    "deleteAccount:project:personal",
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
  ]);
});
