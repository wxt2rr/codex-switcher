import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const repoRoot = "/Users/wangxt/myspace/codex-switcher";
const scriptPath = join(repoRoot, "plugins/codex-switcher/scripts/codex-switcher");

test("legacy bash entrypoints delegate env/account/runtime writes to core-cli", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-legacy-cli-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const binDir = join(root, "bin");
  const npxLog = join(root, "npx.log");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "personal"), { recursive: true });
    await mkdir(join(stateDir, "env-accounts", "project", "personal"), { recursive: true });
    await mkdir(join(envsDir, "project", "home"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(binDir, { recursive: true });

    await writeFile(join(stateDir, "current_cli_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_cli_account"), "personal\n", "utf8");
    await writeFile(join(stateDir, "current_app_env"), "default\n", "utf8");
    await writeFile(join(stateDir, "current_app_account"), "personal\n", "utf8");

    await writeFile(
      join(stateDir, "env-accounts", "default", "personal", "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-default-123456" }),
      "utf8",
    );
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
      join(stateDir, "env-accounts", "project", "personal", "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-project-654321" }),
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

    const realNpx = (await execFileAsync("bash", ["-lc", "command -v npx"], { cwd: repoRoot })).stdout.trim();
    await writeFile(
      join(binDir, "npx"),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${npxLog}"
exec "${realNpx}" "$@"
`,
      "utf8",
    );
    await chmod(join(binDir, "npx"), 0o755);

    const env = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      CODEX_SWITCHER_SKIP_UPDATE_CHECK: "true",
    };

    const envUse = await execFileAsync(scriptPath, ["env", "use", "project", "-t", "both"], {
      cwd: repoRoot,
      env,
    });
    assert.match(envUse.stdout, /Switched both env to: project/);

    const baseUrlUpdate = await execAsync(
      `printf 'https://runtime.example.test/v1\\n' | "${scriptPath}" ac base-url personal --env project --mode custom`,
      {
        cwd: repoRoot,
        env,
      },
    );
    assert.match(baseUrlUpdate.stdout, /Updated base URL for account: project\/personal/);

    const accountUse = await execFileAsync(
      scriptPath,
      ["ac", "use", "personal", "--env", "default", "-t", "both"],
      {
        cwd: repoRoot,
        env,
      },
    );
    assert.match(accountUse.stdout, /Switched both account to: default\/personal/);

    const log = await readFile(npxLog, "utf8");
    assert.match(log, /tsx .*scripts\/core-cli\.ts env-use project both/);
    assert.match(log, /tsx .*scripts\/core-cli\.ts runtime-update project personal https:\/\/runtime\.example\.test\/v1/);
    assert.match(log, /tsx .*scripts\/core-cli\.ts account-use default personal both/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
