import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import * as bridge from "./bridge.js";

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

    const result = await bridge.deleteEnv("project");

    assert.equal(result.message, "Removed env project");
    assert.equal(result.output, "project\n");
    await assert.rejects(access(join(root, "envs", "project", "home", "config.toml")));
    assert.equal(await readFile(join(root, "state", "current_cli_env"), "utf8"), "default\n");
  } finally {
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
