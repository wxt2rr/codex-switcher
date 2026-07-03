import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { executeAccountUse } from "./core-cli.js";

const execFileAsync = promisify(execFile);

async function runCoreCli(
  args: string[],
  env: Record<string, string>,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(
    "npx",
    ["--yes", "tsx", "scripts/core-cli.ts", ...args],
    {
      cwd: "/Users/wangxt/myspace/codex-switcher",
      env: {
        ...process.env,
        ...env,
      },
    },
  );
}

test("core-cli overview and write commands operate on legacy state", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-core-cli-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "personal"), { recursive: true });
    await mkdir(join(envsDir, "wangxt", "home"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });

    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "personal\n", "utf8");
    await writeFile(
      join(stateDir, "env-accounts", "default", "personal", "runtime.json"),
      JSON.stringify({
        preferred_auth_method: "apikey",
        openai_base_url_mode: "custom",
        openai_base_url: "https://proxy.example.test/v1",
      }),
      "utf8",
    );
    await writeFile(
      join(stateDir, "env-accounts", "default", "personal", "auth.json"),
      JSON.stringify({
        auth_mode: "apikey",
        OPENAI_API_KEY: "sk-test-1234567890",
      }),
      "utf8",
    );

    const env = {
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    const overview = await runCoreCli(["overview"], env);
    assert.match(overview.stdout, /"accounts"/);
    assert.match(overview.stdout, /"apiKeyPreview": "sk-\*\*\*7890"/);

    const created = await runCoreCli(["env-new", "gui-test"], env);
    assert.equal(created.stdout.trim(), "gui-test");

    const switched = await runCoreCli(["env-use", "gui-test", "cli"], env);
    assert.equal(switched.stdout.trim(), "gui-test/default");

    const updated = await runCoreCli(
      ["runtime-update", "default", "personal", "https://runtime.example.test/v1"],
      env,
    );
    assert.equal(updated.stdout.trim(), "default/personal https://runtime.example.test/v1");

    const runtimeRaw = await readFile(
      join(stateDir, "env-accounts", "default", "personal", "runtime.json"),
      "utf8",
    );
    assert.match(runtimeRaw, /https:\/\/runtime\.example\.test\/v1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("core-cli applies pointer and target-home updates for both targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-core-cli-targets-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const projectHome = join(envsDir, "project", "home");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "personal"), { recursive: true });
    await mkdir(join(stateDir, "env-accounts", "project", "personal"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(projectHome, { recursive: true });

    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "personal\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "personal\n", "utf8");

    await writeFile(
      join(stateDir, "env-accounts", "default", "personal", "runtime.json"),
      JSON.stringify({
        preferred_auth_method: "apikey",
        openai_base_url_mode: "custom",
        openai_base_url: "https://default.example.test/v1",
      }),
      "utf8",
    );
    await writeFile(
      join(stateDir, "env-accounts", "default", "personal", "auth.json"),
      JSON.stringify({
        auth_mode: "apikey",
        OPENAI_API_KEY: "sk-default-123456",
      }),
      "utf8",
    );
    await writeFile(
      join(stateDir, "env-accounts", "project", "personal", "runtime.json"),
      JSON.stringify({
        preferred_auth_method: "apikey",
        openai_base_url_mode: "custom",
        openai_base_url: "https://project.example.test/v1",
      }),
      "utf8",
    );
    await writeFile(
      join(stateDir, "env-accounts", "project", "personal", "auth.json"),
      JSON.stringify({
        auth_mode: "apikey",
        OPENAI_API_KEY: "sk-project-654321",
      }),
      "utf8",
    );

    const env = {
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    const switchedEnv = await runCoreCli(["env-use", "project", "both"], env);
    assert.equal(switchedEnv.stdout.trim(), "cli=project/personal app=project/personal");

    const projectAuth = JSON.parse(await readFile(join(projectHome, "auth.json"), "utf8")) as {
      OPENAI_API_KEY: string;
    };
    assert.equal(projectAuth.OPENAI_API_KEY, "sk-project-654321");

    const projectConfig = await readFile(join(projectHome, "config.toml"), "utf8");
    assert.match(projectConfig, /preferred_auth_method = "apikey"/);
    assert.match(projectConfig, /openai_base_url = "https:\/\/project\.example\.test\/v1"/);

    const updatedRuntime = await runCoreCli(
      ["runtime-update", "project", "personal", "https://runtime.example.test/v1"],
      env,
    );
    assert.equal(updatedRuntime.stdout.trim(), "project/personal https://runtime.example.test/v1");

    const updatedConfig = await readFile(join(projectHome, "config.toml"), "utf8");
    assert.match(updatedConfig, /openai_base_url = "https:\/\/runtime\.example\.test\/v1"/);

    const switchedBack = await runCoreCli(["account-use", "default", "personal", "both"], env);
    assert.equal(switchedBack.stdout.trim(), "cli=default/personal app=default/personal");

    const defaultAuth = JSON.parse(await readFile(join(defaultHome, "auth.json"), "utf8")) as {
      OPENAI_API_KEY: string;
    };
    assert.equal(defaultAuth.OPENAI_API_KEY, "sk-default-123456");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("core-cli removes an account slot and resets active targets that reference it", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-core-cli-account-rm-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");

  try {
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(join(stateDir, "env-accounts", "project", "default"), { recursive: true });
    await mkdir(join(envsDir, "project", "home"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });

    await writeFile(join(stateDir, "current_cli_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "work\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "work\n", "utf8");

    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-project-654321" }),
      "utf8",
    );
    await writeFile(
      join(stateDir, "env-accounts", "project", "default", "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-project-default" }),
      "utf8",
    );

    const env = {
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    const removed = await runCoreCli(["account-rm", "project", "work"], env);
    assert.equal(removed.stdout.trim(), "Removed account slot: project/work");

    await assert.rejects(readFile(join(stateDir, "env-accounts", "project", "work", "auth.json"), "utf8"));
    const cliEnv = await readFile(join(stateDir, "current_cli_env"), "utf8");
    const cliAccount = await readFile(join(stateDir, "current_cli_account"), "utf8");
    const appAccount = await readFile(join(stateDir, "current_app_account"), "utf8");
    assert.equal(cliEnv.trim(), "project");
    assert.equal(cliAccount.trim(), "default");
    assert.equal(appAccount.trim(), "default");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("core-cli removes an env and falls active targets back to default", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-core-cli-env-rm-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const projectHome = join(envsDir, "project", "home");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(projectHome, { recursive: true });

    await writeFile(join(stateDir, "current_cli_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "work\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "work\n", "utf8");
    await writeFile(
      join(stateDir, "env-accounts", "default", "default", "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-default-123456" }),
      "utf8",
    );

    const env = {
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    const removed = await runCoreCli(["env-rm", "project"], env);
    assert.equal(removed.stdout.trim(), "Removed env: project");

    await assert.rejects(readFile(join(stateDir, "env-accounts", "project", "work", "auth.json"), "utf8"));
    const cliEnv = await readFile(join(stateDir, "current_cli_env"), "utf8");
    const cliAccount = await readFile(join(stateDir, "current_cli_account"), "utf8");
    const appEnv = await readFile(join(stateDir, "current_app_env"), "utf8");
    const appAccount = await readFile(join(stateDir, "current_app_account"), "utf8");
    assert.equal(cliEnv.trim(), "default");
    assert.equal(cliAccount.trim(), "default");
    assert.equal(appEnv.trim(), "default");
    assert.equal(appAccount.trim(), "default");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("core-cli logs out an account and resets active targets that reference it", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-core-cli-logout-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const projectHome = join(envsDir, "project", "home");

  try {
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(join(stateDir, "env-accounts", "project", "default"), { recursive: true });
    await mkdir(projectHome, { recursive: true });
    await mkdir(defaultHome, { recursive: true });

    await writeFile(join(stateDir, "current_cli_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "work\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "project\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "work\n", "utf8");

    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-project-654321" }),
      "utf8",
    );
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "runtime.json"),
      JSON.stringify({
        preferred_auth_method: "apikey",
        openai_base_url_mode: "custom",
        openai_base_url: "https://project.example.test/v1",
      }),
      "utf8",
    );
    await writeFile(
      join(stateDir, "env-accounts", "project", "default", "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-project-default" }),
      "utf8",
    );
    await writeFile(
      join(stateDir, "env-accounts", "project", "default", "runtime.json"),
      JSON.stringify({
        preferred_auth_method: "chatgpt",
        openai_base_url_mode: "default",
      }),
      "utf8",
    );

    const env = {
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
    };

    const result = await runCoreCli(["account-logout", "project", "work", "both"], env);
    assert.equal(result.stdout.trim(), "Logged out account: project/work");

    await assert.rejects(readFile(join(stateDir, "env-accounts", "project", "work", "auth.json"), "utf8"));
    await assert.rejects(readFile(join(stateDir, "env-accounts", "project", "work", "runtime.json"), "utf8"));
    const cliAccount = await readFile(join(stateDir, "current_cli_account"), "utf8");
    const appAccount = await readFile(join(stateDir, "current_app_account"), "utf8");
    assert.equal(cliAccount.trim(), "default");
    assert.equal(appAccount.trim(), "default");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("executeAccountUse updates target pointers and target home for one target", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-core-cli-exec-use-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const projectHome = join(envsDir, "project", "home");

  const previousEnv = {
    ...process.env,
    CODEX_SWITCHER_STATE_DIR: process.env.CODEX_SWITCHER_STATE_DIR,
    CODEX_SWITCHER_ENVS_DIR: process.env.CODEX_SWITCHER_ENVS_DIR,
    CODEX_SWITCHER_DEFAULT_HOME: process.env.CODEX_SWITCHER_DEFAULT_HOME,
  };

  process.env.CODEX_SWITCHER_STATE_DIR = stateDir;
  process.env.CODEX_SWITCHER_ENVS_DIR = envsDir;
  process.env.CODEX_SWITCHER_DEFAULT_HOME = defaultHome;

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "personal"), { recursive: true });
    await mkdir(join(stateDir, "env-accounts", "project", "work"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(projectHome, { recursive: true });

    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "personal\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "personal\n", "utf8");

    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "auth.json"),
      JSON.stringify({
        auth_mode: "apikey",
        OPENAI_API_KEY: "sk-project-999999",
      }),
      "utf8",
    );
    await writeFile(
      join(stateDir, "env-accounts", "project", "work", "runtime.json"),
      JSON.stringify({
        preferred_auth_method: "apikey",
        openai_base_url_mode: "custom",
        openai_base_url: "https://project.example.test/v1",
      }),
      "utf8",
    );

    const next = await executeAccountUse({
      envName: "project",
      accountName: "work",
      target: "cli",
    });

    assert.equal(next.targets.cli.env, "project");
    assert.equal(next.targets.cli.account, "work");
    assert.equal(next.targets.app.env, "default");

    const pointerEnv = await readFile(join(stateDir, "current_cli_env"), "utf8");
    const pointerAccount = await readFile(join(stateDir, "current_cli_account"), "utf8");
    assert.equal(pointerEnv.trim(), "project");
    assert.equal(pointerAccount.trim(), "work");

    const auth = JSON.parse(await readFile(join(projectHome, "auth.json"), "utf8")) as {
      OPENAI_API_KEY: string;
    };
    assert.equal(auth.OPENAI_API_KEY, "sk-project-999999");

    const config = await readFile(join(projectHome, "config.toml"), "utf8");
    assert.match(config, /preferred_auth_method = "apikey"/);
    assert.match(config, /openai_base_url = "https:\/\/project\.example\.test\/v1"/);
  } finally {
    if (previousEnv.CODEX_SWITCHER_STATE_DIR === undefined) {
      delete process.env.CODEX_SWITCHER_STATE_DIR;
    } else {
      process.env.CODEX_SWITCHER_STATE_DIR = previousEnv.CODEX_SWITCHER_STATE_DIR;
    }
    if (previousEnv.CODEX_SWITCHER_ENVS_DIR === undefined) {
      delete process.env.CODEX_SWITCHER_ENVS_DIR;
    } else {
      process.env.CODEX_SWITCHER_ENVS_DIR = previousEnv.CODEX_SWITCHER_ENVS_DIR;
    }
    if (previousEnv.CODEX_SWITCHER_DEFAULT_HOME === undefined) {
      delete process.env.CODEX_SWITCHER_DEFAULT_HOME;
    } else {
      process.env.CODEX_SWITCHER_DEFAULT_HOME = previousEnv.CODEX_SWITCHER_DEFAULT_HOME;
    }
    await rm(root, { recursive: true, force: true });
  }
});
