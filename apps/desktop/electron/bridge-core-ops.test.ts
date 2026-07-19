import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import * as bridge from "./bridge.js";
import { UsageRouterManager } from "./usage-router-manager.js";
import { startUsageRouterService } from "./usage-router-service.js";

async function writeFileRecursive(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

function restoreEnv(previousEnv: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in previousEnv)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, previousEnv);
}

test("desktop bridge deleteAccount delegates to the core desktop operations service", async () => {
  const calls: string[] = [];
  bridge.__testUtils.setDesktopOperationsLoaderForTest(async () => ({
    deleteAccount: async ({ envName, accountName }: { envName: string; accountName: string }) => {
      calls.push(`delete:${envName}/${accountName}`);
      return { message: "Removed account default/personal", output: "default/personal\n" };
    },
    logoutAccount: async () => ({ message: "ok" }),
    getProxyStatus: async () => ({ message: "ok" }),
    setProxy: async () => ({ message: "ok" }),
    disableProxy: async () => ({ message: "ok" }),
    testProxy: async () => ({ message: "ok" }),
    getTokenRefreshStatus: async () => ({ message: "ok" }),
    startTokenRefreshGuard: async () => ({ message: "ok" }),
    stopTokenRefreshGuard: async () => ({ message: "ok" }),
    runTokenRefreshOnce: async () => ({ message: "ok" }),
    getAppStatus: async () => ({ message: "ok" }),
    logoutApp: async () => ({ message: "ok" }),
    stopManagedApp: async () => ({ message: "ok" }),
    listOperations: async () => ({ message: "ok" }),
    runDoctor: async () => ({ message: "ok" }),
    runRecover: async () => ({ message: "ok" }),
  }));

  try {
    const result = await bridge.deleteAccount("default", "personal");

    assert.equal(result.output, "default/personal\n");
    assert.deepEqual(calls, ["delete:default/personal"]);
  } finally {
    bridge.__testUtils.setDesktopOperationsLoaderForTest(undefined);
  }
});

test("desktop bridge proxy operations delegate to the core desktop operations service", async () => {
  const calls: string[] = [];
  bridge.__testUtils.setDesktopOperationsLoaderForTest(async () => ({
    deleteAccount: async () => ({ message: "ok" }),
    logoutAccount: async () => ({ message: "ok" }),
    getProxyStatus: async () => {
      calls.push("show-proxy");
      return { message: "Loaded proxy status", output: "usage_api_proxy: off\n" };
    },
    setProxy: async ({ value }: { value: string }) => {
      calls.push(`set-proxy:${value}`);
      return { message: "Updated proxy", output: `${value}\n` };
    },
    disableProxy: async () => {
      calls.push("disable-proxy");
      return { message: "Disabled proxy" };
    },
    testProxy: async () => {
      calls.push("test-proxy");
      return { message: "Proxy test completed", output: "usage_api_proxy_test: ok\n" };
    },
    getTokenRefreshStatus: async () => ({ message: "ok" }),
    startTokenRefreshGuard: async () => ({ message: "ok" }),
    stopTokenRefreshGuard: async () => ({ message: "ok" }),
    runTokenRefreshOnce: async () => ({ message: "ok" }),
    getAppStatus: async () => ({ message: "ok" }),
    logoutApp: async () => ({ message: "ok" }),
    stopManagedApp: async () => ({ message: "ok" }),
    listOperations: async () => ({ message: "ok" }),
    runDoctor: async () => ({ message: "ok" }),
    runRecover: async () => ({ message: "ok" }),
  }));

  try {
    await bridge.showProxy();
    await bridge.setProxy("http://127.0.0.1:7890");
    await bridge.disableProxy();
    await bridge.testProxy();

    assert.deepEqual(calls, [
      "show-proxy",
      "set-proxy:http://127.0.0.1:7890",
      "disable-proxy",
      "test-proxy",
    ]);
  } finally {
    bridge.__testUtils.setDesktopOperationsLoaderForTest(undefined);
  }
});

test("desktop bridge creates envs directly from core state and clones default home without auth", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-desktop-env-create-"));
  const previousEnv = { ...process.env };

  try {
    process.env.HOME = root;
    process.env.CODEX_SWITCHER_STATE_DIR = join(root, "state");
    process.env.CODEX_SWITCHER_ENVS_DIR = join(root, "envs");
    process.env.CODEX_SWITCHER_DEFAULT_HOME = join(root, "default-home");

    await writeFileRecursive(join(root, "default-home", "config.toml"), "model = 'gpt-5'\n");
    await writeFileRecursive(join(root, "default-home", "auth.json"), "{\"tokens\":true}\n");

    const result = await bridge.createEnv({
      envName: "project",
      source: { kind: "default" },
    });

    assert.equal(result.message, "Created env project");
    assert.equal(result.output, "project\n");
    assert.equal(
      await readFile(join(root, "envs", "project", "home", "config.toml"), "utf8"),
      "model = 'gpt-5'\n",
    );
    await assert.rejects(
      access(join(root, "envs", "project", "home", "auth.json")),
    );
  } finally {
    restoreEnv(previousEnv);
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop bridge saves an API key account without a Codex CLI or changing targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-desktop-api-key-"));
  const previousEnv = { ...process.env };
  try {
    process.env.HOME = root;
    process.env.PATH = "";
    delete process.env.CODEX_SWITCHER_CODEX_BIN;
    delete process.env.CODEX_BIN;
    process.env.CODEX_SWITCHER_STATE_DIR = join(root, "state");
    process.env.CODEX_SWITCHER_ENVS_DIR = join(root, "envs");
    process.env.CODEX_SWITCHER_DEFAULT_HOME = join(root, "default-home");
    await writeFileRecursive(join(root, "state", "current_cli_env"), "default\n");
    await writeFileRecursive(join(root, "state", "current_cli_account"), "default\n");
    await writeFileRecursive(join(root, "state", "current_app_env"), "default\n");
    await writeFileRecursive(join(root, "state", "current_app_account"), "default\n");

    const result = await bridge.nativeLogin({ mode: "apikey", account: "key", envName: "default", target: "none", relogin: false, apiKey: "sk-test" });
    assert.equal(result.message, "Saved API key for default/key");
    assert.deepEqual(JSON.parse(await readFile(join(root, "state", "env-accounts", "default", "key", "auth.json"), "utf8")), { OPENAI_API_KEY: "sk-test" });
    assert.equal(await readFile(join(root, "state", "current_cli_account"), "utf8"), "default\n");
    assert.equal(await readFile(join(root, "state", "current_app_account"), "utf8"), "default\n");
  } finally {
    restoreEnv(previousEnv);
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop bridge saves Chat compatibility settings through the account update flow", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-desktop-account-chat-save-"));
  const previousEnv = { ...process.env };
  let service: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;
  try {
    process.env.HOME = root;
    process.env.CODEX_SWITCHER_STATE_DIR = join(root, "state");
    process.env.CODEX_SWITCHER_ENVS_DIR = join(root, "envs");
    process.env.CODEX_SWITCHER_DEFAULT_HOME = join(root, "default-home");
    await writeFileRecursive(join(root, "state", "current_cli_env"), "default\n");
    await writeFileRecursive(join(root, "state", "current_cli_account"), "default\n");
    await writeFileRecursive(join(root, "state", "current_app_env"), "default\n");
    await writeFileRecursive(join(root, "state", "current_app_account"), "default\n");
    bridge.__testUtils.resetUsageRouterManagerForTest();
    service = await startUsageRouterService({ stateDir: join(root, "state", "usage-router") });

    await bridge.nativeLogin({
      mode: "apikey",
      account: "chat",
      envName: "default",
      target: "none",
      relogin: false,
      apiKey: "sk-chat",
      baseUrlMode: "custom",
      baseUrl: "https://chat.example.com/v1",
      apiProtocol: "chat_completions",
      compatibilityEnabled: true,
      upstreamModel: "deepseek-chat",
      reasoningProfile: "reasoning_content",
      longConversationStrategy: "continuity",
      instructionRole: "system",
      requestOverrides: { top_p: 0.9 },
    });

    const enabledRuntime = JSON.parse(await readFile(
      join(root, "state", "env-accounts", "default", "chat", "runtime.json"),
      "utf8",
    )) as Record<string, unknown>;
    assert.equal(enabledRuntime.api_protocol, "chat_completions");
    assert.equal(enabledRuntime.compatibility_route_enabled, true);
    assert.equal(enabledRuntime.compatibility_upstream_model, "deepseek-chat");
    assert.equal(enabledRuntime.compatibility_reasoning_profile, "reasoning_content");
    assert.equal(enabledRuntime.compatibility_long_conversation_strategy, "continuity");
    assert.equal(enabledRuntime.compatibility_instruction_role, "system");
    assert.deepEqual(enabledRuntime.compatibility_request_overrides, { top_p: 0.9 });

    const manager = new UsageRouterManager({ stateDir: join(root, "state"), serviceEntryPath: "unused" });
    assert.equal((await manager.listRoutes()).filter((route) => route.protocol === "chat_completions").length, 1);

    await bridge.nativeLogin({
      mode: "apikey",
      account: "chat",
      envName: "default",
      target: "none",
      relogin: false,
      apiKey: "sk-chat",
      baseUrlMode: "custom",
      baseUrl: String(enabledRuntime.compatibility_route_base_url),
      apiProtocol: "chat_completions",
      compatibilityEnabled: true,
      upstreamModel: "deepseek-chat",
    });
    const rebuiltRoute = (await manager.listRoutes()).find((route) => route.protocol === "chat_completions");
    assert.equal(rebuiltRoute?.originalBaseUrl, "https://chat.example.com/v1");

    await bridge.nativeLogin({
      mode: "apikey",
      account: "chat",
      envName: "default",
      target: "none",
      relogin: false,
      apiKey: "sk-chat",
      baseUrlMode: "custom",
      baseUrl: "https://responses.example.com/v1",
      apiProtocol: "responses",
      compatibilityEnabled: false,
    });

    const disabledRuntime = JSON.parse(await readFile(
      join(root, "state", "env-accounts", "default", "chat", "runtime.json"),
      "utf8",
    )) as Record<string, unknown>;
    assert.equal(disabledRuntime.api_protocol, "responses");
    assert.equal(disabledRuntime.compatibility_route_enabled, false);
    assert.equal(disabledRuntime.openai_base_url, "https://responses.example.com/v1");
    assert.equal((await manager.listRoutes()).filter((route) => route.protocol === "chat_completions").length, 0);
  } finally {
    await service?.close();
    bridge.__testUtils.resetUsageRouterManagerForTest();
    restoreEnv(previousEnv);
    await rm(root, { recursive: true, force: true });
  }
});

test("Windows environment cloning skips symlinks that cannot be recreated without privileges", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-desktop-symlink-"));
  try {
    const target = join(root, "target");
    const link = join(root, "latest");
    await writeFileRecursive(join(target, "value.txt"), "ok\n");
    await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
    assert.equal(await bridge.__testUtils.shouldCopyEnvClonePathForTest(link, "win32"), false);
    assert.equal(await bridge.__testUtils.shouldCopyEnvClonePathForTest(join(target, "value.txt"), "win32"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("macOS environment cloning skips Unix sockets and keeps regular files", { skip: process.platform !== "darwin" }, async () => {
  const root = await mkdtemp("/tmp/cs-socket-");
  const socketPath = join(root, "fsmonitor--daemon.ipc");
  const regularPath = join(root, "config.toml");
  const server = createServer();
  try {
    await writeFile(regularPath, "model = 'gpt-5'\n", "utf8");
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    assert.equal(await bridge.__testUtils.shouldCopyEnvClonePathForTest(socketPath, "darwin"), false);
    assert.equal(await bridge.__testUtils.shouldCopyEnvClonePathForTest(regularPath, "darwin"), true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop bridge deletes envs directly from core state and resets pointers", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-desktop-env-delete-"));
  const previousEnv = { ...process.env };

  try {
    process.env.HOME = root;
    process.env.CODEX_SWITCHER_STATE_DIR = join(root, "state");
    process.env.CODEX_SWITCHER_ENVS_DIR = join(root, "envs");
    process.env.CODEX_SWITCHER_DEFAULT_HOME = join(root, "default-home");

    await writeFileRecursive(join(root, "state", "current_cli_env"), "project\n");
    await writeFileRecursive(join(root, "state", "current_cli_account"), "default\n");
    await writeFileRecursive(join(root, "state", "current_app_env"), "default\n");
    await writeFileRecursive(join(root, "state", "current_app_account"), "default\n");
    await writeFileRecursive(join(root, "envs", "project", "home", "config.toml"), "model = 'gpt-5'\n");
    await writeFileRecursive(
      join(root, "state", "env-accounts", "project", "default", "runtime.json"),
      "{\n  \"preferred_auth_method\": \"chatgpt\",\n  \"openai_base_url_mode\": \"default\"\n}\n",
    );
    await writeFileRecursive(
      join(root, "state", "desktop-settings.json"),
      "{\n  \"appWindowCounts\": { \"project\": 4, \"other\": 2 }\n}\n",
    );

    const result = await bridge.deleteEnv("project");

    assert.equal(result.message, "Removed env project");
    assert.equal(result.output, "project\n");
    await assert.rejects(access(join(root, "envs", "project", "home", "config.toml")));
    assert.equal(await readFile(join(root, "state", "current_cli_env"), "utf8"), "default\n");
    assert.deepEqual(
      JSON.parse(await readFile(join(root, "state", "desktop-settings.json"), "utf8")).appWindowCounts,
      { other: 2 },
    );
  } finally {
    restoreEnv(previousEnv);
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop bridge migrates the App window count when an environment is renamed", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-desktop-env-window-rename-"));
  const previousEnv = { ...process.env };
  try {
    process.env.HOME = root;
    process.env.CODEX_SWITCHER_STATE_DIR = join(root, "state");
    process.env.CODEX_SWITCHER_ENVS_DIR = join(root, "envs");
    process.env.CODEX_SWITCHER_DEFAULT_HOME = join(root, "default-home");
    await writeFileRecursive(join(root, "state", "current_cli_env"), "default\n");
    await writeFileRecursive(join(root, "state", "current_cli_account"), "default\n");
    await writeFileRecursive(join(root, "state", "current_app_env"), "default\n");
    await writeFileRecursive(join(root, "state", "current_app_account"), "default\n");
    await writeFileRecursive(join(root, "envs", "project", "home", "config.toml"), "model = 'gpt-5'\n");
    await writeFileRecursive(
      join(root, "state", "env-accounts", "project", "default", "runtime.json"),
      "{\n  \"preferred_auth_method\": \"chatgpt\",\n  \"openai_base_url_mode\": \"default\"\n}\n",
    );
    await writeFileRecursive(
      join(root, "state", "desktop-settings.json"),
      "{\n  \"appWindowCounts\": { \"project\": 3 }\n}\n",
    );

    await bridge.updateEnv("project", "renamed", join(root, "envs", "renamed", "home"));

    assert.deepEqual(
      JSON.parse(await readFile(join(root, "state", "desktop-settings.json"), "utf8")).appWindowCounts,
      { renamed: 3 },
    );
  } finally {
    restoreEnv(previousEnv);
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop bridge deleteAccount also removes lingering usage routes for that account", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-desktop-account-route-delete-"));
  const previousEnv = { ...process.env };
  let service: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;

  try {
    process.env.HOME = root;
    process.env.CODEX_SWITCHER_STATE_DIR = join(root, "state");
    process.env.CODEX_SWITCHER_ENVS_DIR = join(root, "envs");
    process.env.CODEX_SWITCHER_DEFAULT_HOME = join(root, "default-home");

    await writeFileRecursive(join(root, "state", "current_cli_env"), "default\n");
    await writeFileRecursive(join(root, "state", "current_cli_account"), "default\n");
    await writeFileRecursive(join(root, "state", "current_app_env"), "default\n");
    await writeFileRecursive(join(root, "state", "current_app_account"), "default\n");
    await writeFileRecursive(
      join(root, "state", "env-accounts", "default", "default", "runtime.json"),
      "{\n  \"preferred_auth_method\": \"chatgpt\",\n  \"openai_base_url_mode\": \"default\"\n}\n",
    );
    await writeFileRecursive(join(root, "envs", "project", "home", "config.toml"), "model = 'gpt-5'\n");
    await writeFileRecursive(
      join(root, "state", "env-accounts", "project", "key", "runtime.json"),
      "{\n  \"preferred_auth_method\": \"apikey\",\n  \"openai_base_url_mode\": \"custom\",\n  \"openai_base_url\": \"https://api.example.com/v1\"\n}\n",
    );
    await writeFileRecursive(
      join(root, "state", "env-accounts", "project", "key", "auth.json"),
      "{\"OPENAI_API_KEY\":\"sk-test\"}\n",
    );

    const manager = new UsageRouterManager({
      stateDir: join(root, "state"),
      serviceEntryPath: "unused",
      launchService: async () => { service = await startUsageRouterService({ stateDir: join(root, "state", "usage-router") }); },
    });
    await manager.enableEnvironment("project", [
      { envName: "project", accountName: "key", authMode: "apikey", baseUrl: "https://api.example.com/v1" },
    ], async () => undefined);

    const result = await bridge.deleteAccount("project", "key");

    assert.equal(result.message, "Removed account project/key");
    assert.deepEqual(await manager.listRoutes(), []);
    await assert.rejects(access(join(root, "state", "env-accounts", "project", "key", "runtime.json")));
  } finally {
    await service?.close();
    restoreEnv(previousEnv);
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop bridge copies complete account data, model bindings, and resolves name conflicts", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-desktop-account-copy-"));
  const previousEnv = { ...process.env };

  try {
    process.env.HOME = root;
    process.env.CODEX_SWITCHER_STATE_DIR = join(root, "state");
    process.env.CODEX_SWITCHER_ENVS_DIR = join(root, "envs");
    process.env.CODEX_SWITCHER_DEFAULT_HOME = join(root, "default-home");
    bridge.__testUtils.resetUsageRouterManagerForTest();

    await writeFileRecursive(join(root, "state", "current_cli_env"), "source\n");
    await writeFileRecursive(join(root, "state", "current_cli_account"), "key\n");
    await writeFileRecursive(join(root, "state", "current_app_env"), "source\n");
    await writeFileRecursive(join(root, "state", "current_app_account"), "key\n");
    await writeFileRecursive(join(root, "envs", "source", "home", "config.toml"), "model = 'gpt-5'\n");
    await writeFileRecursive(join(root, "envs", "target", "home", "config.toml"), "model = 'gpt-5'\n");
    await writeFileRecursive(
      join(root, "state", "env-accounts", "source", "key", "runtime.json"),
      `${JSON.stringify({
        preferred_auth_method: "apikey",
        openai_base_url_mode: "custom",
        openai_base_url: "https://api.example.com/v1",
        independent_model_enabled: true,
        independent_model_provider_id: "custom-provider",
        independent_model_api_key: "model-secret",
        independent_model_base_url: "https://model.example.com/v1",
        api_protocol: "responses",
      }, null, 2)}\n`,
    );
    await writeFileRecursive(
      join(root, "state", "env-accounts", "source", "key", "auth.json"),
      "{\"OPENAI_API_KEY\":\"sk-source\"}\n",
    );
    await writeFileRecursive(
      join(root, "state", "custom-model-catalogs.json"),
      `${JSON.stringify({
        version: 1,
        models: [{ id: "model-1", entry: { slug: "custom-model", display_name: "Custom Model" }, createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z" }],
        accountBindings: { "source/key": ["model-1"] },
      }, null, 2)}\n`,
    );

    const copiedToTarget = await bridge.copyAccount("source", "key", "target");
    assert.equal(copiedToTarget.output, "target/key\n");
    assert.equal(
      await readFile(join(root, "state", "env-accounts", "target", "key", "auth.json"), "utf8"),
      "{\"OPENAI_API_KEY\":\"sk-source\"}\n",
    );
    const targetRuntime = JSON.parse(await readFile(
      join(root, "state", "env-accounts", "target", "key", "runtime.json"),
      "utf8",
    )) as Record<string, unknown>;
    assert.equal(targetRuntime.independent_model_provider_id, "custom-provider");
    assert.equal(targetRuntime.independent_model_api_key, "model-secret");

    assert.equal((await bridge.copyAccount("source", "key", "source")).output, "source/key-copy\n");
    assert.equal((await bridge.copyAccount("source", "key", "source")).output, "source/key-copy-2\n");

    const catalog = JSON.parse(await readFile(join(root, "state", "custom-model-catalogs.json"), "utf8")) as {
      accountBindings: Record<string, string[]>;
    };
    assert.deepEqual(catalog.accountBindings["target/key"], ["model-1"]);
    assert.deepEqual(catalog.accountBindings["source/key-copy"], ["model-1"]);
    assert.deepEqual(catalog.accountBindings["source/key-copy-2"], ["model-1"]);
  } finally {
    bridge.__testUtils.resetUsageRouterManagerForTest();
    restoreEnv(previousEnv);
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop bridge recreates Chat compatibility routing for the copied account", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-desktop-account-copy-chat-"));
  const previousEnv = { ...process.env };
  let service: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;

  try {
    process.env.HOME = root;
    process.env.CODEX_SWITCHER_STATE_DIR = join(root, "state");
    process.env.CODEX_SWITCHER_ENVS_DIR = join(root, "envs");
    process.env.CODEX_SWITCHER_DEFAULT_HOME = join(root, "default-home");
    bridge.__testUtils.resetUsageRouterManagerForTest();

    await writeFileRecursive(join(root, "state", "current_cli_env"), "source\n");
    await writeFileRecursive(join(root, "state", "current_cli_account"), "chat\n");
    await writeFileRecursive(join(root, "state", "current_app_env"), "source\n");
    await writeFileRecursive(join(root, "state", "current_app_account"), "chat\n");
    await writeFileRecursive(join(root, "envs", "source", "home", "config.toml"), "model = 'gpt-5'\n");
    await writeFileRecursive(join(root, "envs", "target", "home", "config.toml"), "model = 'gpt-5'\n");
    await writeFileRecursive(
      join(root, "state", "env-accounts", "source", "chat", "auth.json"),
      "{\"OPENAI_API_KEY\":\"sk-chat\"}\n",
    );
    await writeFileRecursive(
      join(root, "state", "env-accounts", "source", "chat", "runtime.json"),
      "{\n  \"preferred_auth_method\": \"apikey\",\n  \"openai_base_url_mode\": \"custom\",\n  \"openai_base_url\": \"https://chat.example.com/v1\",\n  \"api_protocol\": \"responses\"\n}\n",
    );

    const manager = new UsageRouterManager({
      stateDir: join(root, "state"),
      serviceEntryPath: "unused",
      launchService: async () => {
        service = await startUsageRouterService({ stateDir: join(root, "state", "usage-router") });
      },
    });
    await manager.enableAccountCompatibility({
      envName: "source",
      accountName: "chat",
      authMode: "apikey",
      baseUrl: "https://chat.example.com/v1",
      apiKey: "sk-chat",
      upstreamModel: "deepseek-chat",
    }, async ({ baseUrl, localRouteToken, providerId }) => {
      await writeFileRecursive(
        join(root, "state", "env-accounts", "source", "chat", "runtime.json"),
        `${JSON.stringify({
          preferred_auth_method: "apikey",
          openai_base_url_mode: "custom",
          openai_base_url: "https://chat.example.com/v1",
          api_protocol: "chat_completions",
          compatibility_route_enabled: true,
          compatibility_route_base_url: baseUrl,
          compatibility_route_token: localRouteToken,
          compatibility_route_provider_id: providerId,
          compatibility_upstream_model: "deepseek-chat",
          compatibility_reasoning_profile: "reasoning_content",
          compatibility_long_conversation_strategy: "continuity",
          compatibility_instruction_role: "system",
        }, null, 2)}\n`,
      );
    });

    const result = await bridge.copyAccount("source", "chat", "target");
    assert.equal(result.output, "target/chat\n");
    const routes = await manager.listRoutes();
    const sourceRoute = routes.find((route) => route.envName === "source" && route.accountName === "chat");
    const targetRoute = routes.find((route) => route.envName === "target" && route.accountName === "chat");
    assert.ok(sourceRoute);
    assert.ok(targetRoute);
    assert.notEqual(targetRoute.routeId, sourceRoute.routeId);
    assert.equal(targetRoute.originalBaseUrl, "https://chat.example.com/v1");
    assert.equal(targetRoute.upstreamModel, "deepseek-chat");
    assert.equal(targetRoute.reasoningProfile, "reasoning_content");
    assert.equal(targetRoute.longConversationStrategy, "continuity");
    assert.equal(targetRoute.instructionRole, "system");

    const targetRuntime = JSON.parse(await readFile(
      join(root, "state", "env-accounts", "target", "chat", "runtime.json"),
      "utf8",
    )) as Record<string, unknown>;
    assert.equal(targetRuntime.compatibility_route_enabled, true);
    assert.equal(targetRuntime.compatibility_route_provider_id, `codex_switcher_${targetRoute.routeId}`);
    assert.match(String(targetRuntime.compatibility_route_base_url), new RegExp(`/routes/${targetRoute.routeId}$`));
  } finally {
    await service?.close();
    bridge.__testUtils.resetUsageRouterManagerForTest();
    restoreEnv(previousEnv);
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop bridge deleteEnv also removes lingering usage routes for that environment", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-desktop-env-route-delete-"));
  const previousEnv = { ...process.env };
  let service: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;

  try {
    process.env.HOME = root;
    process.env.CODEX_SWITCHER_STATE_DIR = join(root, "state");
    process.env.CODEX_SWITCHER_ENVS_DIR = join(root, "envs");
    process.env.CODEX_SWITCHER_DEFAULT_HOME = join(root, "default-home");

    await writeFileRecursive(join(root, "state", "current_cli_env"), "project\n");
    await writeFileRecursive(join(root, "state", "current_cli_account"), "key\n");
    await writeFileRecursive(join(root, "state", "current_app_env"), "default\n");
    await writeFileRecursive(join(root, "state", "current_app_account"), "default\n");
    await writeFileRecursive(
      join(root, "state", "env-accounts", "default", "default", "runtime.json"),
      "{\n  \"preferred_auth_method\": \"chatgpt\",\n  \"openai_base_url_mode\": \"default\"\n}\n",
    );
    await writeFileRecursive(join(root, "envs", "project", "home", "config.toml"), "model = 'gpt-5'\n");
    await writeFileRecursive(
      join(root, "state", "env-accounts", "project", "key", "runtime.json"),
      "{\n  \"preferred_auth_method\": \"apikey\",\n  \"openai_base_url_mode\": \"custom\",\n  \"openai_base_url\": \"https://api.example.com/v1\"\n}\n",
    );

    const manager = new UsageRouterManager({
      stateDir: join(root, "state"),
      serviceEntryPath: "unused",
      launchService: async () => { service = await startUsageRouterService({ stateDir: join(root, "state", "usage-router") }); },
    });
    await manager.enableEnvironment("project", [
      { envName: "project", accountName: "key", authMode: "apikey", baseUrl: "https://api.example.com/v1" },
    ], async () => undefined);

    const result = await bridge.deleteEnv("project");

    assert.equal(result.message, "Removed env project");
    assert.deepEqual(await manager.listRoutes(), []);
    await assert.rejects(access(join(root, "envs", "project", "home", "config.toml")));
  } finally {
    await service?.close();
    restoreEnv(previousEnv);
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop bridge materializes environment route changes in the active config.toml", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-desktop-env-route-config-"));
  const previousEnv = { ...process.env };
  let service: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;

  try {
    process.env.HOME = root;
    process.env.CODEX_SWITCHER_STATE_DIR = join(root, "state");
    process.env.CODEX_SWITCHER_ENVS_DIR = join(root, "envs");
    process.env.CODEX_SWITCHER_DEFAULT_HOME = join(root, "default-home");
    bridge.__testUtils.resetUsageRouterManagerForTest();

    await writeFileRecursive(join(root, "state", "current_cli_env"), "project\n");
    await writeFileRecursive(join(root, "state", "current_cli_account"), "key\n");
    await writeFileRecursive(join(root, "state", "current_app_env"), "project\n");
    await writeFileRecursive(join(root, "state", "current_app_account"), "key\n");
    await writeFileRecursive(join(root, "envs", "project", "home", "config.toml"), "model = 'gpt-5'\n");
    await writeFileRecursive(
      join(root, "state", "env-accounts", "project", "key", "runtime.json"),
      "{\n  \"preferred_auth_method\": \"apikey\",\n  \"openai_base_url_mode\": \"custom\",\n  \"openai_base_url\": \"https://api.example.com/v1\"\n}\n",
    );
    await writeFileRecursive(
      join(root, "state", "env-accounts", "project", "key", "auth.json"),
      "{\"OPENAI_API_KEY\":\"sk-test\"}\n",
    );
    service = await startUsageRouterService({ stateDir: join(root, "state", "usage-router") });

    await bridge.toggleEnvironmentRoute("project", true);
    const enabledConfig = await readFile(join(root, "envs", "project", "home", "config.toml"), "utf8");
    assert.match(enabledConfig, new RegExp(`openai_base_url = \"http://127\\.0\\.0\\.1:${service.port}/routes/`));
    assert.match(enabledConfig, /model = 'gpt-5'/);

    await bridge.toggleEnvironmentRoute("project", false);
    const disabledConfig = await readFile(join(root, "envs", "project", "home", "config.toml"), "utf8");
    assert.match(disabledConfig, /openai_base_url = "https:\/\/api\.example\.com\/v1"/);
  } finally {
    await service?.close();
    bridge.__testUtils.resetUsageRouterManagerForTest();
    restoreEnv(previousEnv);
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop bridge loadOverview refreshes stale environment route ports after router restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-desktop-route-resync-"));
  const previousEnv = { ...process.env };
  let firstService: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;
  let secondService: Awaited<ReturnType<typeof startUsageRouterService>> | undefined;

  try {
    process.env.HOME = root;
    process.env.CODEX_SWITCHER_STATE_DIR = join(root, "state");
    process.env.CODEX_SWITCHER_ENVS_DIR = join(root, "envs");
    process.env.CODEX_SWITCHER_DEFAULT_HOME = join(root, "default-home");
    bridge.__testUtils.resetUsageRouterManagerForTest();

    await writeFileRecursive(join(root, "state", "current_cli_env"), "project\n");
    await writeFileRecursive(join(root, "state", "current_cli_account"), "key\n");
    await writeFileRecursive(join(root, "state", "current_app_env"), "project\n");
    await writeFileRecursive(join(root, "state", "current_app_account"), "key\n");
    await writeFileRecursive(join(root, "envs", "project", "home", "config.toml"), "model = 'gpt-5'\n");
    await writeFileRecursive(
      join(root, "state", "env-accounts", "project", "key", "runtime.json"),
      "{\n  \"preferred_auth_method\": \"apikey\",\n  \"openai_base_url_mode\": \"custom\",\n  \"openai_base_url\": \"https://api.example.com/v1\"\n}\n",
    );
    await writeFileRecursive(
      join(root, "state", "env-accounts", "project", "key", "auth.json"),
      "{\"OPENAI_API_KEY\":\"sk-test\"}\n",
    );

    const manager = new UsageRouterManager({
      stateDir: join(root, "state"),
      serviceEntryPath: "unused",
      launchService: async () => undefined,
    });
    firstService = await startUsageRouterService({ stateDir: join(root, "state", "usage-router") });
    const firstPort = firstService.port;
    await manager.enableEnvironment("project", [
      { envName: "project", accountName: "key", authMode: "apikey", baseUrl: "https://api.example.com/v1" },
    ], async (accountName, baseUrl) => {
      const runtimePath = join(root, "state", "env-accounts", "project", accountName, "runtime.json");
      await writeFileRecursive(
        runtimePath,
        `{\n  "preferred_auth_method": "apikey",\n  "openai_base_url_mode": "custom",\n  "openai_base_url": "${baseUrl}"\n}\n`,
      );
    });
    await firstService.close();
    firstService = undefined;

    secondService = await startUsageRouterService({ stateDir: join(root, "state", "usage-router") });
    assert.notEqual(secondService.port, firstPort);

    await bridge.loadOverview();

    const runtimeRaw = await readFile(join(root, "state", "env-accounts", "project", "key", "runtime.json"), "utf8");
    const runtime = JSON.parse(runtimeRaw) as { openai_base_url?: string };
    assert.match(runtime.openai_base_url ?? "", new RegExp(`^http://127\\.0\\.0\\.1:${secondService.port}/routes/`));

    const config = await readFile(join(root, "envs", "project", "home", "config.toml"), "utf8");
    assert.match(config, new RegExp(`openai_base_url = \"http://127\\.0\\.0\\.1:${secondService.port}/routes/`));
    assert.match(config, /model = 'gpt-5'/);
  } finally {
    await firstService?.close();
    await secondService?.close();
    bridge.__testUtils.resetUsageRouterManagerForTest();
    restoreEnv(previousEnv);
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop bridge imports default env directly and can copy auth artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-desktop-env-import-"));
  const previousEnv = { ...process.env };

  try {
    process.env.HOME = root;
    process.env.CODEX_SWITCHER_STATE_DIR = join(root, "state");
    process.env.CODEX_SWITCHER_ENVS_DIR = join(root, "envs");
    process.env.CODEX_SWITCHER_DEFAULT_HOME = join(root, "default-home");

    await writeFileRecursive(
      join(root, "state", "env-accounts", "default", "default", "auth.json"),
      "{\"tokens\":{\"access_token\":\"abc\"}}\n",
    );
    await writeFileRecursive(
      join(root, "state", "env-accounts", "default", "default", "runtime.json"),
      "{\n  \"preferred_auth_method\": \"chatgpt\",\n  \"openai_base_url_mode\": \"default\"\n}\n",
    );
    await writeFileRecursive(join(root, "envs", "project", "home", "stale.txt"), "old\n");

    const result = await bridge.importDefaultEnv("project", {
      withAuth: true,
      force: true,
    });

    assert.equal(result.message, "Imported default env into project");
    assert.equal(result.output, "project\n");
    assert.equal(
      await readFile(join(root, "state", "env-accounts", "project", "default", "auth.json"), "utf8"),
      "{\"tokens\":{\"access_token\":\"abc\"}}\n",
    );
    assert.match(
      await readFile(join(root, "state", "env-accounts", "project", "default", "runtime.json"), "utf8"),
      /"preferred_auth_method": "chatgpt"/,
    );
    await assert.rejects(access(join(root, "envs", "project", "home", "stale.txt")));
  } finally {
    restoreEnv(previousEnv);
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop bridge reads direct token refresh status without CLI wrapper", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-desktop-token-refresh-status-"));
  const previousEnv = { ...process.env };

  try {
    process.env.HOME = root;
    process.env.CODEX_SWITCHER_STATE_DIR = join(root, "state");
    process.env.CODEX_SWITCHER_ENVS_DIR = join(root, "envs");
    process.env.CODEX_SWITCHER_DEFAULT_HOME = join(root, "default-home");
    process.env.CODEX_SWITCHER_LAUNCHD_REFRESH_LABEL = "com.example.codex-switcher-test";

    const result = await bridge.readTokenRefreshStatus();

    assert.equal(result.message, "Loaded token refresh status");
    assert.match(result.output ?? "", /token_refresh_guard: disabled|token_refresh_guard: unsupported/);
  } finally {
    restoreEnv(previousEnv);
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop bridge recover resets invalid pointers directly", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-desktop-recover-"));
  const previousEnv = { ...process.env };

  try {
    process.env.HOME = root;
    process.env.CODEX_SWITCHER_STATE_DIR = join(root, "state");
    process.env.CODEX_SWITCHER_ENVS_DIR = join(root, "envs");
    process.env.CODEX_SWITCHER_DEFAULT_HOME = join(root, "default-home");

    await writeFileRecursive(join(root, "state", "current_cli_env"), "missing\n");
    await writeFileRecursive(join(root, "state", "current_cli_account"), "missing\n");
    await writeFileRecursive(join(root, "state", "current_app_env"), "missing\n");
    await writeFileRecursive(join(root, "state", "current_app_account"), "missing\n");
    await writeFileRecursive(
      join(root, "state", "env-accounts", "default", "default", "runtime.json"),
      "{\n  \"preferred_auth_method\": \"chatgpt\",\n  \"openai_base_url_mode\": \"default\"\n}\n",
    );

    const result = await bridge.runRecover();

    assert.equal(result.message, "Recover finished");
    assert.match(result.output ?? "", /recover\(cli\): default\/default/);
    assert.equal(await readFile(join(root, "state", "current_cli_env"), "utf8"), "default\n");
    assert.equal(await readFile(join(root, "state", "current_app_env"), "utf8"), "default\n");
  } finally {
    restoreEnv(previousEnv);
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop bridge doctor reports healthy direct-core runtime when binaries are present", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-desktop-doctor-"));
  const previousEnv = { ...process.env };

  try {
    process.env.HOME = root;
    process.env.CODEX_SWITCHER_STATE_DIR = join(root, "state");
    process.env.CODEX_SWITCHER_ENVS_DIR = join(root, "envs");
    process.env.CODEX_SWITCHER_DEFAULT_HOME = join(root, "default-home");
    process.env.CODEX_SWITCHER_CODEX_BIN = join(root, "bin", "codex");
    process.env.CODEX_SWITCHER_APP_BIN = join(root, "bin", "Codex");

    await writeFileRecursive(join(root, "state", "current_cli_env"), "default\n");
    await writeFileRecursive(join(root, "state", "current_cli_account"), "default\n");
    await writeFileRecursive(join(root, "state", "current_app_env"), "default\n");
    await writeFileRecursive(join(root, "state", "current_app_account"), "default\n");
    await writeFileRecursive(
      join(root, "state", "env-accounts", "default", "default", "runtime.json"),
      "{\n  \"preferred_auth_method\": \"chatgpt\",\n  \"openai_base_url_mode\": \"default\"\n}\n",
    );
    await writeFileRecursive(join(root, "bin", "codex"), "#!/bin/sh\nexit 0\n");
    await writeFileRecursive(join(root, "bin", "Codex"), "#!/bin/sh\nexit 0\n");
    await chmod(join(root, "bin", "codex"), 0o755);
    await chmod(join(root, "bin", "Codex"), 0o755);

    const result = await bridge.runDoctor();

    assert.equal(result.message, "Doctor finished");
    assert.match(result.output ?? "", /doctor: ok/);
    assert.match(result.output ?? "", /codex binary: ok/);
    assert.match(result.output ?? "", /codex app binary: ok/);
  } finally {
    restoreEnv(previousEnv);
    await rm(root, { recursive: true, force: true });
  }
});
