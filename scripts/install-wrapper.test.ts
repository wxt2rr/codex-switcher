import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = "/Users/wangxt/myspace/codex-switcher";

test("install.sh delegates to the node install path for windows terminal", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-install-wrapper-win-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const userProfile = join(root, "User");
  const launcherPath = join(userProfile, "bin", "codex-sw.cmd");
  const profilePath = join(userProfile, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(join(userProfile, "Documents", "PowerShell"), { recursive: true });

    const env = {
      ...process.env,
      USERPROFILE: userProfile,
      HOME: root,
      SHELL: "/bin/zsh",
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      CODEX_SWITCHER_TEST_PLATFORM: "win32",
    };

    const result = await execFileAsync("bash", ["scripts/install.sh", "--shell", "windows-terminal"], {
      cwd: repoRoot,
      env,
    });

    assert.match(result.stdout, /Installed codex-sw/);
    assert.match(result.stdout, /restart Windows Terminal/);
    const launcherRaw = await readFile(launcherPath, "utf8");
    assert.match(launcherRaw, /codex-sw-node\.cjs/);
    const profileRaw = await readFile(profilePath, "utf8");
    assert.match(profileRaw, /# >>> codex-sw init >>>/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uninstall.sh delegates to the node uninstall path for cmd", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-uninstall-wrapper-win-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const userProfile = join(root, "User");
  const launcherPath = join(userProfile, "bin", "codex-sw.cmd");
  const cmdInitPath = join(userProfile, "cmd-init.bat");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(join(userProfile, "bin"), { recursive: true });
    await writeFile(launcherPath, "launcher\r\n", "utf8");
    await writeFile(
      cmdInitPath,
      "rem >>> codex-sw init >>>\r\nset PATH=C:\\User\\bin;%PATH%\r\nrem <<< codex-sw init <<<\r\n",
      "utf8",
    );

    const env = {
      ...process.env,
      USERPROFILE: userProfile,
      HOME: root,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      CODEX_SWITCHER_TEST_PLATFORM: "win32",
    };

    const result = await execFileAsync("bash", ["scripts/uninstall.sh", "--shell", "cmd"], {
      cwd: repoRoot,
      env,
    });

    assert.match(result.stdout, /Uninstalled codex-sw/);
    await assert.rejects(readFile(launcherPath, "utf8"));
    const cmdInitRaw = await readFile(cmdInitPath, "utf8");
    assert.doesNotMatch(cmdInitRaw, /codex-sw init/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uninstall.sh --purge removes switcher state and env homes", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-uninstall-wrapper-purge-"));
  const stateDir = join(root, ".codex-switcher");
  const envsDir = join(root, ".codex-envs");
  const defaultHome = join(root, ".codex");
  const userProfile = join(root, "User");
  const launcherPath = join(userProfile, "bin", "codex-sw.cmd");
  const cmdInitPath = join(userProfile, "cmd-init.bat");
  const stateMarker = join(stateDir, "marker.txt");
  const envMarker = join(envsDir, "project", "home", "marker.txt");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(join(envsDir, "project", "home"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(join(userProfile, "bin"), { recursive: true });
    await writeFile(stateMarker, "state\n", "utf8");
    await writeFile(envMarker, "env\n", "utf8");
    await writeFile(launcherPath, "launcher\r\n", "utf8");
    await writeFile(
      cmdInitPath,
      "rem >>> codex-sw init >>>\r\nset PATH=C:\\User\\bin;%PATH%\r\nrem <<< codex-sw init <<<\r\n",
      "utf8",
    );

    const env = {
      ...process.env,
      USERPROFILE: userProfile,
      HOME: root,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      CODEX_SWITCHER_TEST_PLATFORM: "win32",
    };

    const result = await execFileAsync("bash", ["scripts/uninstall.sh", "--shell", "cmd", "--purge"], {
      cwd: repoRoot,
      env,
    });

    assert.match(result.stdout, /State and env homes removed\./);
    await assert.rejects(readFile(stateMarker, "utf8"));
    await assert.rejects(readFile(envMarker, "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uninstall.sh --purge honors explicit state and env directory overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-uninstall-wrapper-override-purge-"));
  const stateDir = join(root, "custom-state");
  const envsDir = join(root, "custom-envs");
  const defaultHome = join(root, ".codex");
  const userProfile = join(root, "User");
  const launcherPath = join(userProfile, "bin", "codex-sw.cmd");
  const cmdInitPath = join(userProfile, "cmd-init.bat");
  const stateMarker = join(stateDir, "marker.txt");
  const envMarker = join(envsDir, "project", "home", "marker.txt");

  try {
    await mkdir(join(stateDir, "env-accounts", "default", "default"), { recursive: true });
    await mkdir(join(envsDir, "project", "home"), { recursive: true });
    await mkdir(defaultHome, { recursive: true });
    await mkdir(join(userProfile, "bin"), { recursive: true });
    await writeFile(stateMarker, "state\n", "utf8");
    await writeFile(envMarker, "env\n", "utf8");
    await writeFile(launcherPath, "launcher\r\n", "utf8");
    await writeFile(
      cmdInitPath,
      "rem >>> codex-sw init >>>\r\nset PATH=C:\\User\\bin;%PATH%\r\nrem <<< codex-sw init <<<\r\n",
      "utf8",
    );

    const env = {
      ...process.env,
      USERPROFILE: userProfile,
      HOME: root,
      CODEX_SWITCHER_STATE_DIR: stateDir,
      CODEX_SWITCHER_ENVS_DIR: envsDir,
      CODEX_SWITCHER_DEFAULT_HOME: defaultHome,
      CODEX_SWITCHER_TEST_PLATFORM: "win32",
    };

    const result = await execFileAsync("bash", ["scripts/uninstall.sh", "--shell", "cmd", "--purge"], {
      cwd: repoRoot,
      env,
    });

    assert.match(result.stdout, /State and env homes removed\./);
    await assert.rejects(readFile(stateMarker, "utf8"));
    await assert.rejects(readFile(envMarker, "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
