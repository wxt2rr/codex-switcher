import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
