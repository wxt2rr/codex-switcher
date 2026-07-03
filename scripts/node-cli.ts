import { spawn } from "node:child_process";
import { access, chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import packageJson from "../package.json" with { type: "json" };
import { ProxyAgent, request as undiciRequest } from "undici";

import {
  getWindowsReadinessSnapshot,
  resolveCodexAppPath,
  resolveCommandPath,
  resolveWindowsLauncherCommands,
} from "../packages/core/src/platform/command-discovery.js";
import { createCoreApi } from "../packages/core/src/api/core-api.js";
import { launchCodexCli } from "../packages/core/src/platform/codex-cli.js";
import {
  buildCodexAppLaunchSpec,
  launchNewCodexApp,
  restartCurrentCodexApp,
  resolveWindowsAppLauncher,
  stopManagedCodexApp,
} from "../packages/core/src/platform/codex-app.js";
import {
  listManagedAppInstances,
  readLastManagedAppInstanceId,
  resolveManagedAppStatePaths,
} from "../packages/core/src/platform/codex-app-runtime.js";
import {
  clearManualUsageProxy,
  type UsageProxyState,
  readUsageProxyState,
  setManualUsageProxy,
} from "../packages/core/src/platform/proxy.js";
import { getPlatformRuntime } from "../packages/core/src/platform/runtime.js";
import {
  createLegacyEnv,
  readLegacyState,
  writeLegacyPointers,
  writeLegacyRuntime,
} from "../packages/core/src/state/legacy.js";
import { applyTargetHomeState } from "../packages/core/src/system/target-home.js";
import { renderAccountsScreen } from "../packages/core/src/tui/accounts.js";
import { APP_PAGE_ACTIONS, renderAppScreen } from "../packages/core/src/tui/app.js";
import { renderEnvsScreen } from "../packages/core/src/tui/envs.js";
import { HOME_MENU_ITEMS, renderHomeScreen, runHomeLoop } from "../packages/core/src/tui/home.js";
import { PROXY_PAGE_ACTIONS, renderProxyScreen } from "../packages/core/src/tui/proxy.js";
import {
  renderSetupScreen,
  SETUP_OPTIONS_UNIX,
  SETUP_OPTIONS_WINDOWS,
} from "../packages/core/src/tui/setup.js";
import { renderStatusScreen } from "../packages/core/src/tui/status.js";
import {
  listAccountOptions,
  listEnvOptions,
  listTargetOptions,
  renderSwitchSummary,
} from "../packages/core/src/tui/switch.js";
import { createTerminal } from "../packages/core/src/tui/terminal.js";
import { executeAccountUse, runCoreCli } from "./core-cli.js";

const CORE_COMMANDS = new Set([
  "whoami",
  "status",
  "overview",
  "env-ls",
  "account-ls",
  "env-use",
  "env-rm",
  "account-use",
  "account-rm",
  "account-logout",
  "runtime-update",
  "env-new",
]);
const SUB2API_EXTRA_FIELDS = ["refresh_token", "last_refresh", "email", "account_id", "expired"] as const;
const USAGE_API_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const USAGE = `Usage:
  codex-sw-node env ls
  codex-sw-node ac ls [--env <env>]
  codex-sw-node cli launch-current [-- <codex args...>]
  codex-sw-node app restart-current
  codex-sw-node app launch-new
  codex-sw-node app stop-managed
  codex-sw-node app status
  codex-sw-node app logout [account]
  codex-sw-node proxy [show|test|off|<host:port>|<scheme://host:port>]
  codex-sw-node whoami [-t cli|app|both]
  codex-sw-node status
  codex-sw-node overview
  codex-sw-node lang [en]
  codex-sw-node check
  codex-sw-node doctor
  codex-sw-node install [--shell zsh|bash|powershell|cmd|windows-terminal|wt]
  codex-sw-node uninstall [--shell zsh|bash|powershell|cmd|windows-terminal|wt] [--purge]
  codex-sw-node tui
  codex-sw-node version
  codex-sw-node platform
  codex-sw-node help`;
const USAGE_ALL = `Usage:
  codex-sw-node env ls
  codex-sw-node env new <env>
  codex-sw-node env use <env> [-t cli|app|both]
  codex-sw-node env rm <env> [--force]

  codex-sw-node ac ls [--env <env>]
  codex-sw-node ac login <account> [--env <env>] [-t cli|app|both] [--sync|--no-sync] [--mode auth|apikey|sub2api]
  codex-sw-node ac relogin <account> --env <env> [-t cli|app|both] [--sync|--no-sync] [--mode auth|apikey|sub2api]
  codex-sw-node ac base-url <account> [--env <env>] [--mode default|custom] [url]
  codex-sw-node ac use <account> [--env <env>] [-t cli|app|both] [--sync|--no-sync]
  codex-sw-node ac logout [account] [--env <env>] [-t cli|app|both]
  codex-sw-node ac rm <account> [--env <env>] [--force]

  codex-sw-node cli launch-current [-- <codex args...>]
  codex-sw-node app restart-current
  codex-sw-node app launch-new
  codex-sw-node app stop-managed
  codex-sw-node app status
  codex-sw-node app logout [account]

  codex-sw-node ops list
  codex-sw-node ops proxy [show|test|off|<host:port>|<scheme://host:port>]
  codex-sw-node ops import-default <env> [--with-auth] [--force]
  codex-sw-node ops init [--shell zsh|bash|powershell|cmd|windows-terminal|wt] [--dry-run]
  codex-sw-node ops recover [--dry-run]
  codex-sw-node ops doctor [--fix]
  codex-sw-node ops token-refresh <start|stop|status|run-once>

  codex-sw-node whoami [-t cli|app|both]
  codex-sw-node status
  codex-sw-node overview
  codex-sw-node lang [en]
  codex-sw-node check
  codex-sw-node doctor
  codex-sw-node install [--shell zsh|bash|powershell|cmd|windows-terminal|wt]
  codex-sw-node uninstall [--shell zsh|bash|powershell|cmd|windows-terminal|wt] [--purge]
  codex-sw-node tui
  codex-sw-node version
  codex-sw-node platform
  codex-sw-node help`;

async function main() {
  const argv = normalizeArgv(process.argv.slice(2));
  const [command = "help", ...rest] = argv;
  const runtime = getNodeCliRuntime();

  if (command === "version" || command === "--version") {
    process.stdout.write(`${packageJson.version}\n`);
    return;
  }

  if (command === "platform") {
    process.stdout.write(`${runtime.platform}\n`);
    return;
  }

  if (
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  if (command === "help-all" || command === "--help-all") {
    process.stdout.write(`${USAGE_ALL}\n`);
    return;
  }

  if (command === "lang") {
    const [value] = rest;
    if (rest.length > 1) {
      throw new Error("usage: codex-sw-node lang [en]");
    }
    if (!value) {
      process.stdout.write("language: en\n");
      return;
    }
    if (value.toLowerCase() !== "en") {
      throw new Error(`invalid language '${value}' (English-only build, use en)`);
    }
    process.stdout.write("language set to: en\n");
    return;
  }

  if (command === "check") {
    await basicCheck(runtime.paths);
    process.stdout.write(`version: ${packageJson.version}\n`);
    process.stdout.write("check: ok\n");
    return;
  }

  if (command === "doctor") {
    const code = await runDoctor(runtime, rest);
    process.exit(code);
  }

  if (command === "recover-dry-run") {
    const code = await runNodeRecoverCommand({ dryRun: true });
    process.exit(code);
  }

  if (command === "recover") {
    const code = await runNodeRecoverCommand({ dryRun: false });
    process.exit(code);
  }

  if (command === "init-dry-run") {
    const code = await runNodeInitCommand(rest, { dryRun: true });
    process.exit(code);
  }

  if (command === "init") {
    const code = await runNodeInitCommand(rest, { dryRun: false });
    process.exit(code);
  }

  if (command === "install") {
    const code = await runNodeInstallCommand(rest);
    process.exit(code);
  }

  if (command === "uninstall") {
    const code = await runNodeUninstallCommand(rest);
    process.exit(code);
  }

  if (command === "upgrade") {
    const code = await runNodeUpgradeCommand(rest);
    process.exit(code);
  }

  if (command === "tui") {
    const code = await runNodeTui();
    process.exit(code);
  }

  if (command === "app") {
    const code = await runNodeAppCommand(rest);
    process.exit(code);
  }

  if (command === "cli") {
    const code = await runNodeCliCommand(rest);
    process.exit(code);
  }

  if (command === "proxy") {
    const code = await runNodeProxyCommand(rest);
    process.exit(code);
  }

  if (command === "ops-list") {
    const code = await runNodeOpsListCommand();
    process.exit(code);
  }

  if (command === "import-default") {
    const code = await runNodeImportDefaultCommand(rest);
    process.exit(code);
  }

  if (command === "token-refresh") {
    const code = await runNodeTokenRefreshCommand(rest);
    process.exit(code);
  }

  if (
    command === "account-login-auth" ||
    command === "account-login-apikey" ||
    command === "account-login-sub2api" ||
    command === "account-relogin-error"
  ) {
    const code = await runNodeAccountLoginCommand([command, ...rest]);
    process.exit(code);
  }

  if (CORE_COMMANDS.has(command)) {
    const code = await runCoreCli(argv);
    process.exit(code);
  }

  process.stderr.write("node-cli: command not implemented yet\n");
  process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

function normalizeArgv(argv: string[]): string[] {
  const [command = "help", ...rest] = argv;

  if (command === "env" && rest[0] === "ls") {
    return ["env-ls"];
  }

  if (command === "env" && rest[0] === "use" && rest[1]) {
    const envName = rest[1];
    const target = readTargetFlag(rest.slice(2)) ?? "cli";
    return ["env-use", envName, target];
  }

  if (command === "env" && rest[0] === "new" && rest[1]) {
    const envName = rest[1];
    const tail = rest.slice(2);
    let mode = "from-default";
    let srcEnv = "";
    for (let index = 0; index < tail.length; index += 1) {
      const value = tail[index];
      if (value === "--empty") {
        mode = "empty";
        srcEnv = "";
        continue;
      }
      if (value === "--from") {
        const candidate = tail[index + 1] ?? "";
        if (candidate === "default") {
          mode = "from-default";
          srcEnv = "";
        } else {
          mode = "from-env";
          srcEnv = candidate;
        }
        index += 1;
        continue;
      }
    }
    return ["env-new", envName, mode, srcEnv];
  }

  if (command === "env" && ["rm", "remove", "delete"].includes(rest[0] ?? "") && rest[1]) {
    return ["env-rm", rest[1]];
  }

  if ((command === "ac" || command === "account") && rest[0] === "ls") {
    const next = rest.slice(1);
    if (next.length === 0) {
      return ["account-ls"];
    }
    if ((next[0] === "--env" || next[0] === "-e") && next[1]) {
      return ["account-ls", next[1]];
    }
  }

  if ((command === "ac" || command === "account") && rest[0] === "use" && rest[1]) {
    const accountName = rest[1];
    const tail = rest.slice(2);
    const envName = readEnvFlag(tail) ?? "default";
    const target = readTargetFlag(tail) ?? "cli";
    const sync = readSyncFlag(tail) ? "true" : "false";
    return ["account-use", envName, accountName, target, sync];
  }

  if ((command === "ac" || command === "account") && rest[0] === "login" && rest[1]) {
    const accountName = rest[1];
    const tail = rest.slice(2);
    const envName = readEnvFlag(tail) ?? "default";
    const target = readTargetFlag(tail) ?? "cli";
    const mode = readAccountLoginModeFlag(tail) ?? "auth";
    const sync = readSyncFlag(tail) ? "true" : "false";
    if (mode === "auth") {
      return ["account-login-auth", envName, accountName, target, "default", sync];
    }
    if (mode === "apikey") {
      return ["account-login-apikey", envName, accountName, target, readAccountLoginBaseUrl(tail) ?? "default", sync];
    }
    if (mode === "sub2api") {
      return ["account-login-sub2api", envName, accountName, target, "default", sync];
    }
  }

  if ((command === "ac" || command === "account") && rest[0] === "relogin") {
    const accountName = rest[1] && !rest[1].startsWith("--") ? rest[1] : "";
    const tail = accountName ? rest.slice(2) : rest.slice(1);
    const envName = readEnvFlag(tail) ?? "";
    const target = readTargetFlag(tail) ?? "cli";
    const mode = readAccountLoginModeFlag(tail) ?? "auth";
    const sync = readSyncFlag(tail) ? "true" : "false";
    if (accountName && !envName) {
      return ["account-relogin-error", accountName, target];
    }
    if (accountName && envName) {
      if (mode === "auth") {
        return ["account-login-auth", envName, accountName, target, "default", sync];
      }
      if (mode === "apikey") {
        return ["account-login-apikey", envName, accountName, target, readAccountLoginBaseUrl(tail) ?? "default", sync];
      }
      if (mode === "sub2api") {
        return ["account-login-sub2api", envName, accountName, target, "default", sync];
      }
    }
  }

  if (
    (command === "ac" || command === "account") &&
    ["rm", "remove", "delete"].includes(rest[0] ?? "") &&
    rest[1]
  ) {
    const accountName = rest[1];
    const envName = readEnvFlag(rest.slice(2)) ?? "default";
    return ["account-rm", envName, accountName];
  }

  if ((command === "ac" || command === "account") && rest[0] === "logout") {
    const accountName = rest[1] && !rest[1].startsWith("--") ? rest[1] : undefined;
    const tail = accountName ? rest.slice(2) : rest.slice(1);
    const envName = readEnvFlag(tail) ?? "default";
    const target = readTargetFlag(tail) ?? "cli";
    if (accountName) {
      return ["account-logout", envName, accountName, target];
    }
    return ["account-logout", envName, target];
  }

  if ((command === "ac" || command === "account") && rest[0] === "base-url" && rest[1]) {
    const accountName = rest[1];
    const tail = rest.slice(2);
    const envName = readEnvFlag(tail) ?? "default";
    const mode = readModeFlag(tail) ?? "default";
    const baseUrl = tail.find((value, index) =>
      !(value === "--env" || value === "-e" || value === "--mode") &&
      !(
        index > 0 &&
        (tail[index - 1] === "--env" || tail[index - 1] === "-e" || tail[index - 1] === "--mode")
      )
    );
    return ["runtime-update", envName, accountName, mode === "custom" ? (baseUrl ?? "default") : "default"];
  }

  if (command === "ops" && rest[0] === "list") {
    return ["ops-list"];
  }

  if (command === "ops" && rest[0] === "proxy") {
    return ["proxy", ...(rest.length > 1 ? [rest[1]] : [])];
  }

  if (command === "ops" && rest[0] === "import-default" && rest[1]) {
    return ["import-default", ...rest.slice(1)];
  }

  if (command === "ops" && rest[0] === "exec") {
    return ["cli", "launch-current", ...rest.slice(1)];
  }

  if (command === "ops" && rest[0] === "doctor") {
    return ["doctor", ...rest.slice(1)];
  }

  if (command === "ops" && rest[0] === "recover" && rest[1] === "--dry-run" && rest.length === 2) {
    return ["recover-dry-run"];
  }

  if (command === "ops" && rest[0] === "recover" && rest.length === 1) {
    return ["recover"];
  }

  if (command === "ops" && rest[0] === "init") {
    return [rest.includes("--dry-run") ? "init-dry-run" : "init", ...rest.slice(1)];
  }

  if (command === "ops" && rest[0] === "token-refresh") {
    return ["token-refresh", ...(rest.length > 1 ? [rest[1]] : [])];
  }

  if (command === "--help-all" || command === "help-all") {
    return ["help-all"];
  }

  if (command === "whoami" && rest[0] && (rest[0] === "-t" || rest[0] === "--target")) {
    const target = rest[1];
    if (target === "both") {
      return ["whoami", "both"];
    }
    if (target === "cli" || target === "app") {
      return ["whoami", target];
    }
  }

  return argv;
}

function readTargetFlag(argv: string[]): "cli" | "app" | "both" | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if ((value === "-t" || value === "--target") && argv[index + 1]) {
      const target = argv[index + 1];
      if (target === "cli" || target === "app" || target === "both") {
        return target;
      }
    }
  }
  return undefined;
}

function readEnvFlag(argv: string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if ((value === "--env" || value === "-e") && argv[index + 1]) {
      return argv[index + 1];
    }
  }
  return undefined;
}

function readModeFlag(argv: string[]): "default" | "custom" | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--mode" && argv[index + 1]) {
      const mode = argv[index + 1];
      if (mode === "default" || mode === "custom") {
        return mode;
      }
    }
  }
  return undefined;
}

function readAccountLoginModeFlag(argv: string[]): "auth" | "apikey" | "sub2api" | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--mode" && argv[index + 1]) {
      const mode = argv[index + 1];
      if (mode === "auth" || mode === "apikey" || mode === "sub2api") {
        return mode;
      }
    }
  }
  return undefined;
}

function readAccountLoginBaseUrl(argv: string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--base-url" && argv[index + 1]) {
      return argv[index + 1];
    }
  }
  return undefined;
}

function readSyncFlag(argv: string[]): boolean {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--sync") {
      return true;
    }
    if (argv[index] === "--no-sync") {
      return false;
    }
  }
  return false;
}

async function basicCheck(paths: { stateDir: string; envsDir: string; defaultHome: string }) {
  await readLegacyState({
    stateDir: paths.stateDir,
    envsDir: paths.envsDir,
    defaultHome: paths.defaultHome,
  });
}

async function runDoctor(
  runtime: ReturnType<typeof getPlatformRuntime>,
  argv: string[] = [],
): Promise<number> {
  let fix = false;
  for (const value of argv) {
    if (value === "--fix") {
      fix = true;
      continue;
    }
    throw new Error(`unknown doctor option: ${value}`);
  }

  const state = await readLegacyState({
    stateDir: runtime.paths.stateDir,
    envsDir: runtime.paths.envsDir,
    defaultHome: runtime.paths.defaultHome,
  });

  let issues = 0;
  const codexCli = await resolveCommandPath("codex");
  const codexApp = await resolveCodexAppPath();

  process.stdout.write(`platform: ${runtime.platform}\n`);
  process.stdout.write(`state_dir: ${runtime.paths.stateDir}\n`);
  process.stdout.write(`envs_dir: ${runtime.paths.envsDir}\n`);
  process.stdout.write(`default_home: ${runtime.paths.defaultHome}\n`);
  process.stdout.write(`cli_current: ${state.targets.cli.env}/${state.targets.cli.account}\n`);
  process.stdout.write(`app_current: ${state.targets.app.env}/${state.targets.app.account}\n`);
  const windowsLauncher = resolveWindowsAppLauncher(process.env);
  const effectiveLauncher = runtime.platform === "windows" ? windowsLauncher : "direct";
  const launcherDetail =
    runtime.platform === "windows"
      ? effectiveLauncher
      : `${effectiveLauncher} (windows override: ${windowsLauncher})`;
  process.stdout.write(`app launcher: ${launcherDetail}\n`);

  if (codexCli) {
    process.stdout.write(`- codex binary: ok (${codexCli.path})\n`);
  } else {
    process.stdout.write("- codex binary: missing\n");
    issues = 1;
  }

  if (codexApp) {
    process.stdout.write(`- codex app binary: ok (${codexApp})\n`);
  } else {
    process.stdout.write("- codex app binary: missing\n");
    issues = 1;
  }

  const windowsReadiness = await getWindowsReadinessSnapshot(process.env, "win32");

  for (const launcher of windowsReadiness.launchers) {
    if (launcher.resolved) {
      process.stdout.write(
        `- windows launcher ${launcher.command}: ok (${launcher.resolved.path})\n`,
      );
    } else {
      process.stdout.write(`- windows launcher ${launcher.command}: missing\n`);
    }
  }

  process.stdout.write("windows cli candidates:\n");
  for (const candidate of windowsReadiness.cliCandidates) {
    process.stdout.write(`- ${candidate}\n`);
  }

  process.stdout.write("windows app candidates:\n");
  for (const candidate of windowsReadiness.appCandidates) {
    process.stdout.write(`- ${candidate}\n`);
  }

  process.stdout.write("windows shell init files:\n");
  for (const file of windowsReadiness.shellInitFiles) {
    process.stdout.write(`- ${file}\n`);
  }

  if (fix) {
    await chmod(runtime.paths.stateDir, 0o700).catch(() => undefined);
    await chmod(runtime.paths.envsDir, 0o700).catch(() => undefined);
    await chmod(runtime.paths.defaultHome, 0o700).catch(() => undefined);
    await runNodeRecoverCommand(
      { dryRun: false },
      {
        stdout: process.stdout,
      },
    );
    issues = 0;
    process.stdout.write("doctor --fix: completed\n");
  }

  if (issues === 0) {
    process.stdout.write("doctor: ok\n");
    return 0;
  }

  process.stdout.write("doctor: issues found\n");
  return 1;
}

async function runNodeTui(): Promise<number> {
  return runNodeTuiWithDeps();
}

async function runNodeAppCommand(
  argv: string[],
  deps?: {
    restartApp?: typeof restartCurrentCodexApp;
    launchAppNew?: typeof launchNewCodexApp;
    stopManagedApp?: typeof stopManagedCodexApp;
    stdout?: Pick<NodeJS.WriteStream, "write">;
  },
): Promise<number> {
  const [subcommand = "", ...rest] = argv;
  const runtime = getPlatformRuntime();
  const stdout = deps?.stdout ?? process.stdout;

  if (subcommand === "stop-managed") {
    if (rest.length !== 0) {
      throw new Error("usage: codex-sw-node app stop-managed");
    }
    const stopped = await (deps?.stopManagedApp ?? stopManagedCodexApp)({
      stateDir: runtime.paths.stateDir,
    });
    stdout.write(`${stopped ? "Stopped managed app process" : "No managed app process to stop"}\n`);
    return stopped ? 0 : 1;
  }

  const state = await readLegacyState({
    stateDir: runtime.paths.stateDir,
    envsDir: runtime.paths.envsDir,
    defaultHome: runtime.paths.defaultHome,
  });

  if (subcommand === "status") {
    if (rest.length !== 0) {
      throw new Error("usage: codex-sw-node app status");
    }
    const envName = state.targets.app.env;
    const accountName = state.targets.app.account;
    const pid = await readManagedAppPidCompat(runtime.paths.stateDir);
    stdout.write(`app_current: ${envName}/${accountName}\n`);
    stdout.write(`app_process: ${pid === null ? "not-running" : `running(pid=${pid})`}\n`);
    return pid === null ? 1 : 0;
  }

  if (subcommand === "logout") {
    if (rest.length > 1) {
      throw new Error("usage: codex-sw-node app logout [account]");
    }
    const accountName = rest[0] || state.targets.app.account;
    return runCoreCli(["account-logout", state.targets.app.env, accountName, "app"], {
      stdout,
      stderr: process.stderr,
    });
  }

  if (subcommand !== "restart-current" && subcommand !== "launch-new") {
    throw new Error("usage: codex-sw-node app <restart-current|launch-new|stop-managed|status|logout>");
  }

  if (rest.length !== 0) {
    throw new Error(`usage: codex-sw-node app ${subcommand}`);
  }

  const envName = state.targets.app.env;
  const accountName = state.targets.app.account;
  const envState = state.envs[envName];
  const accountState = envState?.accounts[accountName];

  if (!envState || !accountState) {
    throw new Error(`current app target is missing: ${envName}/${accountName}`);
  }

  const input = {
    codexHome: envState.path,
    stateDir: runtime.paths.stateDir,
  };

  if (subcommand === "launch-new") {
    await (deps?.launchAppNew ?? launchNewCodexApp)(input);
  } else {
    await (deps?.restartApp ?? restartCurrentCodexApp)(input);
  }

  stdout.write(
    `Opened Codex App with: ${envName}/${accountName} (${formatAppLauncherSummary(runtime.platform, process.env)})\n`,
  );
  return 0;
}

async function readManagedAppPidCompat(stateDir: string): Promise<number | null> {
  const paths = resolveManagedAppStatePaths(stateDir);
  try {
    const raw = await readFile(paths.appPidFile, "utf8");
    const pid = Number(raw.trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function runNodeCliCommand(
  argv: string[],
  deps?: {
    launchCli?: typeof launchCodexCli;
  },
): Promise<number> {
  const [subcommand = "", ...rest] = argv;
  const runtime = getPlatformRuntime();

  if (subcommand !== "launch-current") {
    throw new Error("usage: codex-sw-node cli launch-current [-- <codex args...>]");
  }

  const args = rest[0] === "--" ? rest.slice(1) : rest;
  const state = await readLegacyState({
    stateDir: runtime.paths.stateDir,
    envsDir: runtime.paths.envsDir,
    defaultHome: runtime.paths.defaultHome,
  });
  const envName = state.targets.cli.env;
  const envState = state.envs[envName];

  if (!envState) {
    throw new Error(`current cli target env is missing: ${envName}`);
  }

  const result = await (deps?.launchCli ?? launchCodexCli)({
    codexHome: envState.path,
    args,
  });
  return result.exitCode;
}

async function runNodeOpsListCommand(
  deps?: {
    stdout?: Pick<NodeJS.WriteStream, "write">;
  },
): Promise<number> {
  const runtime = getPlatformRuntime();
  const stdout = deps?.stdout ?? process.stdout;
  const state = await readLegacyState({
    stateDir: runtime.paths.stateDir,
    envsDir: runtime.paths.envsDir,
    defaultHome: runtime.paths.defaultHome,
  });

  stdout.write("ENV\tHOME\tACCOUNT\tCURRENT\n");
  for (const envName of Object.keys(state.envs).sort()) {
    const envState = state.envs[envName];
    const accountNames = Object.keys(envState.accounts).sort();
    if (accountNames.length === 0) {
      const marks = summarizeCurrentTargets(state, envName, "");
      stdout.write(`${envName}\t${envState.path}\t-\t${marks}\n`);
      continue;
    }

    for (const accountName of accountNames) {
      const marks = summarizeCurrentTargets(state, envName, accountName);
      stdout.write(`${envName}\t${envState.path}\t${accountName}\t${marks}\n`);
    }
  }

  return 0;
}

async function runNodeImportDefaultCommand(
  argv: string[],
  deps?: {
    stdout?: Pick<NodeJS.WriteStream, "write">;
  },
): Promise<number> {
  const [envName = "", ...rest] = argv;
  const runtime = getNodeCliRuntime();
  const stdout = deps?.stdout ?? process.stdout;
  let withAuth = false;
  let force = false;

  if (!envName) {
    throw new Error("usage: codex-sw-node ops import-default <env> [--with-auth] [--force]");
  }

  for (const value of rest) {
    if (value === "--with-auth") {
      withAuth = true;
      continue;
    }
    if (value === "--force") {
      force = true;
      continue;
    }
    throw new Error(`unknown option: ${value}`);
  }

  if (envName === "default") {
    throw new Error("cannot import into reserved env 'default'");
  }

  const state = await readLegacyState({
    stateDir: runtime.paths.stateDir,
    envsDir: runtime.paths.envsDir,
    defaultHome: runtime.paths.defaultHome,
  });

  if (state.envs[envName]) {
    if (!force) {
      throw new Error(`env '${envName}' already exists. use --force to overwrite`);
    }
    await rm(join(runtime.paths.envsDir, envName), { recursive: true, force: true });
    await rm(join(runtime.paths.stateDir, "env-accounts", envName), { recursive: true, force: true });
  }

  await createLegacyEnv({
    envsDir: runtime.paths.envsDir,
    envName,
  });

  if (withAuth) {
    const defaultAccount = state.envs.default?.accounts.default;
    const defaultAuthPath = join(runtime.paths.stateDir, "env-accounts", "default", "default", "auth.json");
    const targetAccountDir = join(runtime.paths.stateDir, "env-accounts", envName, "default");

    try {
      const authRaw = await readFile(defaultAuthPath, "utf8");
      await mkdir(targetAccountDir, { recursive: true });
      await writeFile(join(targetAccountDir, "auth.json"), authRaw, "utf8");
      await writeLegacyRuntime({
        stateDir: runtime.paths.stateDir,
        envName,
        accountName: "default",
        runtime: defaultAccount?.runtime ?? {
          preferredAuthMethod: "chatgpt",
          openaiBaseUrlMode: "default",
        },
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  stdout.write(`Imported default data to env: ${envName}\n`);
  return 0;
}

async function runNodeRecoverCommand(input: {
  dryRun: boolean;
}, deps?: {
  stdout?: Pick<NodeJS.WriteStream, "write">;
}): Promise<number> {
  const runtime = getPlatformRuntime();
  const stdout = deps?.stdout ?? process.stdout;
  const state = await readLegacyState({
    stateDir: runtime.paths.stateDir,
    envsDir: runtime.paths.envsDir,
    defaultHome: runtime.paths.defaultHome,
  });
  const nextState = {
    ...state,
    generatedAt: new Date().toISOString(),
    targets: {
      ...state.targets,
    },
  };

  for (const target of ["cli", "app"] as const) {
    const currentEnv = state.targets[target].env;
    const currentAccount = state.targets[target].account;
    let nextEnv = state.envs[currentEnv] ? currentEnv : "default";
    let nextAccount = state.envs[nextEnv]?.accounts[currentAccount] ? currentAccount : "default";

    if (!state.envs[nextEnv]) {
      nextEnv = "default";
    }
    if (!state.envs[nextEnv]?.accounts[nextAccount]) {
      nextAccount = "default";
    }

    nextState.targets[target] = {
      env: nextEnv,
      account: nextAccount,
    };
    stdout.write(`recover(${target}): ${nextEnv}/${nextAccount}\n`);
  }

  if (!input.dryRun) {
    for (const target of ["cli", "app"] as const) {
      await writeLegacyPointers({
        stateDir: runtime.paths.stateDir,
        target,
        env: nextState.targets[target].env,
        account: nextState.targets[target].account,
      });
      await applyTargetHomeState({
        state: nextState,
        target,
      });
    }
  }

  return 0;
}

function getNodeCliRuntime() {
  return getPlatformRuntime(
    process.env,
    process.env.CODEX_SWITCHER_TEST_PLATFORM || process.platform,
  );
}

async function runNodeInitCommand(
  argv: string[],
  input: {
    dryRun: boolean;
  },
  deps?: {
    stdout?: Pick<NodeJS.WriteStream, "write">;
  },
): Promise<number> {
  const runtime = getNodeCliRuntime();
  const stdout = deps?.stdout ?? process.stdout;
  let shellName = "";
  let dryRunFlag = input.dryRun;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--shell") {
      shellName = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value === "--dry-run") {
      dryRunFlag = true;
      continue;
    }
    throw new Error(`unknown init option: ${value}`);
  }

  if (!shellName) {
    shellName = runtime.platform === "windows" ? "powershell" : "zsh";
  }

  if (runtime.platform === "windows") {
    const normalizedWindowsShell =
      shellName === "windows-terminal" || shellName === "wt" ? "windows-terminal" : shellName;
    const binDir = join(runtime.paths.homeDir, "bin");
    const profile =
      normalizedWindowsShell === "powershell" || normalizedWindowsShell === "windows-terminal"
        ? runtime.shellInitFiles[1] ?? runtime.shellInitFiles[0]
        : normalizedWindowsShell === "cmd"
          ? join(runtime.paths.homeDir, "cmd-init.bat")
          : "";
    if (!profile) {
      throw new Error(`unsupported shell '${shellName}' (use powershell, cmd, or windows-terminal)`);
    }
    const launcherPath = join(binDir, "codex-sw.cmd");
    stdout.write(`[dry-run] mkdir -p ${binDir}\n`);
    stdout.write(`[dry-run] write launcher ${launcherPath}\n`);
    stdout.write(`[dry-run] ensure PATH block in ${profile}\n`);
    if (!dryRunFlag) {
      await mkdir(binDir, { recursive: true });
      await writeFile(
        launcherPath,
        `@echo off\r\nnode "${join(process.cwd(), "scripts", "bin", "codex-sw-node.cjs")}" %*\r\n`,
        "utf8",
      );
      if (normalizedWindowsShell === "powershell" || normalizedWindowsShell === "windows-terminal") {
        await ensureShellInitBlock(profile, [
          "# >>> codex-sw init >>>",
          `$env:Path = "${binDir};$env:Path"`,
          "# <<< codex-sw init <<<",
        ]);
        stdout.write(`Initialized codex-sw for ${normalizedWindowsShell}\n`);
        stdout.write(
          `${normalizedWindowsShell === "windows-terminal" ? "Run: restart Windows Terminal" : "Run: reload your PowerShell profile"}\n`,
        );
      } else {
        await ensureShellInitBlock(profile, [
          "rem >>> codex-sw init >>>",
          `set PATH=${binDir};%PATH%`,
          "rem <<< codex-sw init <<<",
        ]);
        stdout.write("Initialized codex-sw for cmd\n");
        stdout.write(`Run: call ${profile}\n`);
      }
    }
    return 0;
  }

  const rcFile =
    shellName === "zsh"
      ? join(runtime.paths.homeDir, ".zshrc")
      : shellName === "bash"
        ? join(runtime.paths.homeDir, ".bashrc")
        : "";
  if (!rcFile) {
    throw new Error(`unsupported shell '${shellName}' (use zsh or bash)`);
  }

  stdout.write(`[dry-run] mkdir -p ${join(runtime.paths.homeDir, ".local", "bin")}\n`);
  const linkPath = join(runtime.paths.homeDir, ".local", "bin", "codex-sw");
  const scriptPath = join(process.cwd(), "plugins", "codex-switcher", "scripts", "codex-switcher");
  stdout.write(`[dry-run] ln -sf ${scriptPath} ${linkPath}\n`);
  stdout.write(`[dry-run] ensure PATH block in ${rcFile}\n`);
  if (!dryRunFlag) {
    await mkdir(join(runtime.paths.homeDir, ".local", "bin"), { recursive: true });
    await writeFile(linkPath, `${scriptPath}\n`, "utf8");
    await ensureShellInitBlock(rcFile, [
      "# >>> codex-sw init >>>",
      'export PATH="$HOME/.local/bin:$PATH"',
      "# <<< codex-sw init <<<",
    ]);
    stdout.write(`Initialized codex-sw for ${shellName}\n`);
    stdout.write(`Run: source ${rcFile}\n`);
  }
  return 0;
}

async function runNodeInstallCommand(
  argv: string[],
  deps?: {
    stdout?: Pick<NodeJS.WriteStream, "write">;
  },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  await runNodeInitCommand(argv, { dryRun: false }, deps);
  stdout.write("Installed codex-sw.\n");
  return 0;
}

async function runNodeTokenRefreshCommand(
  argv: string[],
  deps?: {
    stdout?: Pick<NodeJS.WriteStream, "write">;
    spawnImpl?: typeof spawn;
  },
): Promise<number> {
  const runtime = getNodeCliRuntime();
  const stdout = deps?.stdout ?? process.stdout;
  const action = argv[0] ?? "status";
  const supportedActions = new Set(["start", "stop", "status", "run-once"]);
  if (!supportedActions.has(action)) {
    throw new Error(`unknown token-refresh action: ${action} (use start|stop|status|run-once)`);
  }

  if (action === "status") {
    const guard =
      runtime.platform === "windows"
        ? await queryWindowsTokenRefreshGuardStatus(deps?.spawnImpl ?? spawn)
        : formatTokenRefreshGuardStatus(runtime);
    stdout.write(`token_refresh_guard: ${guard}\n`);
    if (runtime.platform === "windows") {
      stdout.write(`token_refresh_task: ${resolveWindowsTokenRefreshTaskName()}\n`);
    }
    if (runtime.platform === "macos") {
      const plistPath = resolveTokenRefreshPlistPath(runtime);
      if (await fileExists(plistPath)) {
        stdout.write(`token_refresh_plist: ${plistPath}\n`);
        stdout.write(`token_refresh_log: ${resolveTokenRefreshLogPath(runtime)}\n`);
      }
    }
    return 0;
  }

  if (action === "run-once") {
    return runNodeTokenRefreshRunOnce({ stdout });
  }

  if (runtime.platform === "windows") {
    if (action === "start") {
      await configureWindowsTokenRefreshTask({
        spawnImpl: deps?.spawnImpl ?? spawn,
        mode: "start",
      });
      stdout.write(
        `token_refresh_guard: enabled (task=${resolveWindowsTokenRefreshTaskName()}, interval=${resolveTokenRefreshIntervalSeconds()}s)\n`,
      );
      stdout.write(`token_refresh_log: ${resolveTokenRefreshLogPath(runtime)}\n`);
      return 0;
    }

    await configureWindowsTokenRefreshTask({
      spawnImpl: deps?.spawnImpl ?? spawn,
      mode: "stop",
    });
    stdout.write("token_refresh_guard: disabled\n");
    return 0;
  }

  const result = await runLegacySwitcherCommand(["ops", "token-refresh", action]);
  if (result.stdout) {
    stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  return result.exitCode;
}

async function runNodeTokenRefreshRunOnce(
  deps?: {
    stdout?: Pick<NodeJS.WriteStream, "write">;
  },
): Promise<number> {
  const runtime = getNodeCliRuntime();
  const stdout = deps?.stdout ?? process.stdout;
  const state = await readLegacyState({
    stateDir: runtime.paths.stateDir,
    envsDir: runtime.paths.envsDir,
    defaultHome: runtime.paths.defaultHome,
  });
  const codexBin = await resolveCodexBinaryPath();
  if (!codexBin) {
    throw new Error("codex binary not found. install Codex CLI or set CODEX_SWITCHER_CODEX_BIN");
  }

  let scanned = 0;
  let fresh = 0;
  let checked = 0;
  let refreshed = 0;
  let failed = 0;
  let relogin = 0;
  const startedAt = Date.now();

  stdout.write(`\nToken refresh run  ${formatTokenRefreshLocalTime(new Date())}\n`);
  stdout.write(`UTC: ${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}\n`);
  stdout.write(
    `  ${padTokenRefreshCell("ACCOUNT", 22)} ${padTokenRefreshCell("EMAIL", 34)} ${padTokenRefreshCell("EXPIRES", 20)} ${padTokenRefreshCell("REMAINING", 12)} STATUS\n`,
  );
  stdout.write(
    `  ${padTokenRefreshCell("----------------------", 22)} ${padTokenRefreshCell("----------------------------------", 34)} ${padTokenRefreshCell("--------------------", 20)} ${padTokenRefreshCell("------------", 12)} ----------------\n`,
  );

  for (const envName of Object.keys(state.envs).sort()) {
    const envState = state.envs[envName];
    for (const accountName of Object.keys(envState.accounts).sort()) {
      scanned += 1;
      const accountState = envState.accounts[accountName];
      if (accountState.authMode !== "auth") {
        continue;
      }

      const authFile = join(runtime.paths.stateDir, "env-accounts", envName, accountName, "auth.json");
      let beforeRaw = "";
      try {
        beforeRaw = await readFile(authFile, "utf8");
      } catch {
        continue;
      }
      if (!beforeRaw.trim()) {
        continue;
      }

      const beforeAuth = safeParseAuthJson(beforeRaw);
      const email = beforeAuth.email || "-";
      const expires = beforeAuth.expired || "-";
      const remaining = formatTokenRefreshRemaining(expires);

      checked += 1;
      const result = await refreshAccountTokenOnceNative({
        authFile,
        authRaw: beforeRaw,
        codexBin,
        envName,
        accountName,
        runtimePaths: runtime.paths,
      });

      let statusLabel = "checked";
      if (result === "changed") {
        refreshed += 1;
        statusLabel = "refreshed";
      } else if (result === "need_relogin") {
        failed += 1;
        relogin += 1;
        statusLabel = "relogin required";
      } else if (result === "failed") {
        failed += 1;
        statusLabel = "failed";
      }

      stdout.write(
        `  ${padTokenRefreshCell(`${envName}/${accountName}`, 22)} ${padTokenRefreshCell(email, 34)} ${padTokenRefreshCell(expires, 20)} ${padTokenRefreshCell(remaining, 12)} ${statusLabel}\n`,
      );
    }
  }

  const durationSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  stdout.write(
    `Summary: scanned=${scanned}  fresh=${fresh}  checked=${checked}  refreshed=${refreshed}  failed=${failed}  relogin=${relogin}  duration=${durationSeconds}s\n`,
  );
  return 0;
}

function formatTokenRefreshGuardStatus(
  runtime: ReturnType<typeof getNodeCliRuntime>,
): string {
  if (runtime.platform === "windows") {
    return `disabled (task=${resolveWindowsTokenRefreshTaskName()})`;
  }
  if (runtime.platform !== "macos") {
    return "unsupported (requires macOS launchd)";
  }

  return "enabled(not-running), interval=900s";
}

function resolveTokenRefreshPlistPath(
  runtime: ReturnType<typeof getNodeCliRuntime>,
): string {
  const label =
    process.env.CODEX_SWITCHER_LAUNCHD_REFRESH_LABEL || "com.wangxt.codex-switcher.token-refresh";
  return join(runtime.paths.homeDir, "Library", "LaunchAgents", `${label}.plist`);
}

function resolveTokenRefreshLogPath(
  runtime: ReturnType<typeof getNodeCliRuntime>,
): string {
  return process.env.CODEX_SWITCHER_TOKEN_REFRESH_LOG || join(runtime.paths.stateDir, "token-refresh.log");
}

function resolveWindowsTokenRefreshTaskName(): string {
  return process.env.CODEX_SWITCHER_WINDOWS_TOKEN_REFRESH_TASK || "CodexSwitcherTokenRefresh";
}

function resolveTokenRefreshIntervalSeconds(): number {
  const raw = process.env.CODEX_SWITCHER_TOKEN_REFRESH_INTERVAL_SECONDS || "900";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 60) {
    throw new Error(`invalid TOKEN_REFRESH_INTERVAL_SECONDS='${raw}'`);
  }
  return Math.floor(parsed);
}

async function configureWindowsTokenRefreshTask(input: {
  mode: "start" | "stop";
  spawnImpl: typeof spawn;
}): Promise<void> {
  const taskName = resolveWindowsTokenRefreshTaskName();
  const args =
    input.mode === "start"
      ? buildWindowsTokenRefreshCreateArgs(taskName)
      : ["/Delete", "/TN", taskName, "/F"];

  await new Promise<void>((resolve, reject) => {
    const child = input.spawnImpl("schtasks.exe", args, {
      env: process.env,
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`schtasks terminated by signal ${signal}`));
        return;
      }
      if ((code ?? 1) !== 0) {
        reject(new Error(`schtasks ${input.mode} failed with exit code ${code ?? 1}`));
        return;
      }
      resolve();
    });
  });
}

async function queryWindowsTokenRefreshGuardStatus(
  spawnImpl: typeof spawn,
): Promise<string> {
  const taskName = resolveWindowsTokenRefreshTaskName();
  const args = ["/Query", "/TN", taskName];

  return new Promise<string>((resolve, reject) => {
    const child = spawnImpl("schtasks.exe", args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`schtasks query terminated by signal ${signal}`));
        return;
      }
      if ((code ?? 1) !== 0) {
        resolve(`disabled (task=${taskName})`);
        return;
      }

      const normalized = `${stdout}\n${stderr}`.toLowerCase();
      if (normalized.includes("running")) {
        resolve(`enabled(running), task=${taskName}`);
        return;
      }
      resolve(`enabled(not-running), task=${taskName}`);
    });
  });
}

function buildWindowsTokenRefreshCreateArgs(taskName: string): string[] {
  const intervalMinutes = Math.max(1, Math.floor(resolveTokenRefreshIntervalSeconds() / 60));
  const launcher = join(process.cwd(), "scripts", "bin", "codex-sw-node.cjs");
  const tr = `node "${launcher}" ops token-refresh run-once`;
  return [
    "/Create",
    "/SC",
    "MINUTE",
    "/MO",
    String(intervalMinutes),
    "/TN",
    taskName,
    "/TR",
    tr,
    "/F",
  ];
}

async function resolveCodexBinaryPath(): Promise<string | null> {
  const explicit = process.env.CODEX_BIN || process.env.CODEX_SWITCHER_CODEX_BIN;
  if (explicit) {
    return explicit;
  }
  const resolved = await resolveCommandPath(
    "codex",
    process.env,
    process.env.CODEX_SWITCHER_TEST_PLATFORM || process.platform,
  );
  return resolved?.path ?? null;
}

function safeParseAuthJson(raw: string): {
  email: string;
  expired: string;
} {
  try {
    const parsed = JSON.parse(raw) as { email?: string; expired?: string };
    return {
      email: parsed.email?.trim() || "-",
      expired: parsed.expired?.trim() || "-",
    };
  } catch {
    return {
      email: "-",
      expired: "-",
    };
  }
}

function formatTokenRefreshLocalTime(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}:${byType.second} ${byType.timeZoneName ?? ""}`.trim();
}

function formatTokenRefreshRemaining(expiredAt: string): string {
  const parsed = Date.parse(expiredAt);
  if (!Number.isFinite(parsed)) {
    return "-";
  }
  const totalSeconds = Math.floor((parsed - Date.now()) / 1000);
  if (totalSeconds < 0) {
    return "expired";
  }
  if (totalSeconds < 3600) {
    return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
  }
  if (totalSeconds < 86400) {
    return `${Math.floor(totalSeconds / 3600)}h ${Math.floor((totalSeconds % 3600) / 60)}m`;
  }
  return `${Math.floor(totalSeconds / 86400)}d ${Math.floor((totalSeconds % 86400) / 3600)}h`;
}

function padTokenRefreshCell(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width, " ");
}

async function refreshAccountTokenOnceNative(input: {
  authFile: string;
  authRaw: string;
  codexBin: string;
  envName: string;
  accountName: string;
  runtimePaths: {
    stateDir: string;
    envsDir: string;
    defaultHome: string;
  };
}): Promise<"changed" | "unchanged" | "failed" | "need_relogin"> {
  const tempHome = await mkdtemp(join(tmpdir(), "codex-sw-token-refresh-"));
  const tempAuthPath = join(tempHome, "auth.json");

  try {
    await writeFile(tempAuthPath, input.authRaw, "utf8");
    const execution = await runCodexExecRefresh({
      codexBin: input.codexBin,
      codexHome: tempHome,
    });

    let afterRaw = "";
    try {
      afterRaw = await readFile(tempAuthPath, "utf8");
      JSON.parse(afterRaw);
    } catch {
      return "failed";
    }

    if (afterRaw !== input.authRaw) {
      await writeFile(input.authFile, afterRaw, "utf8");
      await syncUpdatedAuthToActiveTargets({
        ...input.runtimePaths,
        envName: input.envName,
        accountName: input.accountName,
      });
      return "changed";
    }

    if (execution.exitCode !== 0) {
      return /refresh token.*(expired|revoked|reused)|please log out and sign in again|not logged in/i.test(
        execution.output,
      )
        ? "need_relogin"
        : "failed";
    }

    return "unchanged";
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
}

async function runCodexExecRefresh(input: {
  codexBin: string;
  codexHome: string;
}): Promise<{
  exitCode: number;
  output: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      input.codexBin,
      ["exec", "--skip-git-repo-check", "reply with: ok"],
      {
        env: {
          ...process.env,
          CODEX_HOME: input.codexHome,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
    }, 20_000);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        resolve({
          exitCode: 124,
          output: `${output}\n[signal:${signal}]`,
        });
        return;
      }
      resolve({
        exitCode: code ?? 1,
        output,
      });
    });
  });
}

async function syncUpdatedAuthToActiveTargets(input: {
  stateDir: string;
  envsDir: string;
  defaultHome: string;
  envName: string;
  accountName: string;
}): Promise<void> {
  const state = await readLegacyState({
    stateDir: input.stateDir,
    envsDir: input.envsDir,
    defaultHome: input.defaultHome,
  });
  for (const target of ["cli", "app"] as const) {
    if (
      state.targets[target].env === input.envName &&
      state.targets[target].account === input.accountName
    ) {
      await applyTargetHomeState({
        state,
        target,
      });
    }
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runNodeUninstallCommand(
  argv: string[],
  deps?: {
    stdout?: Pick<NodeJS.WriteStream, "write">;
  },
): Promise<number> {
  const runtime = getNodeCliRuntime();
  const stdout = deps?.stdout ?? process.stdout;
  let shellName = "";
  let purge = false;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--shell") {
      shellName = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value === "--purge") {
      purge = true;
      continue;
    }
    throw new Error(`unknown uninstall option: ${value}`);
  }

  if (!shellName) {
    shellName = runtime.platform === "windows" ? "powershell" : "zsh";
  }

  if (runtime.platform === "windows") {
    const normalizedWindowsShell =
      shellName === "windows-terminal" || shellName === "wt" ? "windows-terminal" : shellName;
    const launcherPath = join(runtime.paths.homeDir, "bin", "codex-sw.cmd");
    await rm(launcherPath, { force: true });

    if (normalizedWindowsShell === "powershell" || normalizedWindowsShell === "windows-terminal") {
      const profile = runtime.shellInitFiles[1] ?? runtime.shellInitFiles[0];
      await removeShellInitBlock(profile, "# >>> codex-sw init >>>", "# <<< codex-sw init <<<");
    } else if (normalizedWindowsShell === "cmd") {
      await removeShellInitBlock(
        join(runtime.paths.homeDir, "cmd-init.bat"),
        "rem >>> codex-sw init >>>",
        "rem <<< codex-sw init <<<",
      );
    } else {
      throw new Error(`unsupported shell '${shellName}' (use powershell, cmd, or windows-terminal)`);
    }

    stdout.write("Uninstalled codex-sw.\n");
    if (purge) {
      await rm(runtime.paths.stateDir, { recursive: true, force: true });
      await rm(runtime.paths.envsDir, { recursive: true, force: true });
      stdout.write("State and env homes removed.\n");
    }
    return 0;
  }

  const rcFile =
    shellName === "zsh"
      ? join(runtime.paths.homeDir, ".zshrc")
      : shellName === "bash"
        ? join(runtime.paths.homeDir, ".bashrc")
        : "";
  if (!rcFile) {
    throw new Error(`unsupported shell '${shellName}' (use zsh or bash)`);
  }

  await rm(join(runtime.paths.homeDir, ".local", "bin", "codex-sw"), { force: true });
  await removeShellInitBlock(rcFile, "# >>> codex-sw init >>>", "# <<< codex-sw init <<<");
  stdout.write("Uninstalled codex-sw.\n");
  if (purge) {
    await rm(runtime.paths.stateDir, { recursive: true, force: true });
    await rm(runtime.paths.envsDir, { recursive: true, force: true });
    stdout.write("State and env homes removed.\n");
  }
  return 0;
}

async function runNodeUpgradeCommand(
  argv: string[],
  deps?: {
    stdout?: Pick<NodeJS.WriteStream, "write">;
    spawnImpl?: typeof spawn;
  },
): Promise<number> {
  const stdout = deps?.stdout ?? process.stdout;
  let dryRun = false;

  for (const value of argv) {
    if (value === "--dry-run") {
      dryRun = true;
      continue;
    }
    throw new Error(`unknown option: ${value}`);
  }

  const registry = process.env.CODEX_SWITCHER_UPGRADE_REGISTRY || "https://registry.npmjs.org/";
  const npmPackage = process.env.CODEX_SWITCHER_NPM_PACKAGE || "@wangxt0223/codex-switcher";
  const cmdline = ["i", "-g", `${npmPackage}@latest`, "--registry", registry];

  if (dryRun) {
    stdout.write(`[dry-run] npm ${cmdline.join(" ")}\n`);
    return 0;
  }

  const spawnImpl = deps?.spawnImpl ?? spawn;
  await new Promise<void>((resolve, reject) => {
    const child = spawnImpl("npm", cmdline, {
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("npm command not found; cannot upgrade. install npm first"));
        return;
      }
      reject(error);
    });
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`upgrade terminated by signal ${signal}`));
        return;
      }
      if ((code ?? 1) !== 0) {
        reject(new Error(`npm upgrade failed with exit code ${code ?? 1}`));
        return;
      }
      resolve();
    });
  });

  stdout.write("Upgraded codex-sw to latest.\n");
  return 0;
}

async function runLegacySwitcherCommand(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const legacyScript =
    process.env.CODEX_SWITCHER_BIN_LEGACY_SCRIPT ||
    join(process.cwd(), "plugins", "codex-switcher", "scripts", "codex-switcher");

  return new Promise((resolve, reject) => {
    const child = spawn("bash", [legacyScript, ...args], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`legacy switcher terminated by signal ${signal}`));
        return;
      }
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

async function ensureShellInitBlock(filePath: string, lines: string[]): Promise<void> {
  const start = lines[0] ?? "";
  const end = lines[lines.length - 1] ?? "";
  let existing = "";
  try {
    existing = await readFile(filePath, "utf8");
  } catch {
    existing = "";
  }

  if (existing.includes(start) && existing.includes(end)) {
    return;
  }

  const prefix = existing && !existing.endsWith("\n") ? `${existing}\n` : existing;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${prefix}${lines.join("\n")}\n`, "utf8");
}

async function hasShellInitBlock(
  filePath: string,
  startMarker: string,
  endMarker: string,
): Promise<boolean> {
  if (!filePath) {
    return false;
  }
  try {
    const existing = await readFile(filePath, "utf8");
    return existing.includes(startMarker) && existing.includes(endMarker);
  } catch {
    return false;
  }
}

async function evaluateSetupState(
  target: string,
  runtime: ReturnType<typeof getPlatformRuntime>,
): Promise<{
  initialized: boolean;
  issues: string[];
}> {
  const issues: string[] = [];
  if (runtime.platform === "windows") {
    const launcherPath = join(runtime.paths.homeDir, "bin", "codex-sw.cmd");
    const launcherExists = await fileExists(launcherPath);
    if (!launcherExists) {
      issues.push("launcher missing");
    }
    let initBlockExists = false;
    if (target === "cmd") {
      initBlockExists = await hasShellInitBlock(
        join(runtime.paths.homeDir, "cmd-init.bat"),
        "rem >>> codex-sw init >>>",
        "rem <<< codex-sw init <<<",
      );
    } else {
      initBlockExists = await hasShellInitBlock(
        runtime.shellInitFiles[1] ?? runtime.shellInitFiles[0] ?? "",
        "# >>> codex-sw init >>>",
        "# <<< codex-sw init <<<",
      );
    }
    if (!initBlockExists) {
      issues.push("init block missing");
    }
    return {
      initialized: launcherExists && initBlockExists,
      issues,
    };
  }

  const launcherPath = join(runtime.paths.homeDir, ".local", "bin", "codex-sw");
  const launcherExists = await fileExists(launcherPath);
  if (!launcherExists) {
    issues.push("launcher missing");
  }
  const initBlockExists = await hasShellInitBlock(
    resolveSetupInitTargetPath(target, runtime),
    "# >>> codex-sw init >>>",
    "# <<< codex-sw init <<<",
  );
  if (!initBlockExists) {
    issues.push("init block missing");
  }
  return {
    initialized: launcherExists && initBlockExists,
    issues,
  };
}

function formatSetupTargetStatusLine(
  target: string,
  setupState: {
    initialized: boolean;
    issues: string[];
  },
): string {
  return `target ${formatSetupRecommendationLabel(target)}: ${
    setupState.initialized ? "ready" : setupState.issues.join(", ")
  }`;
}

function formatSetupSuggestion(
  recommended: string,
  current: string,
  targetStatuses: Array<{
    target: string;
    setupState: {
      initialized: boolean;
      issues: string[];
    };
  }>,
): string {
  const readyTargets = targetStatuses.filter((status) => status.setupState.initialized);
  if (readyTargets.length > 0) {
    const preferredReady = readyTargets.find((status) => status.target !== current) ?? readyTargets[0];
    return `Suggestion: ready target available: ${formatSetupRecommendationLabel(preferredReady.target)}`;
  }
  return `Suggestion: run init for recommended target: ${formatSetupRecommendationLabel(recommended)}`;
}

function formatSetupMismatch(
  current: string,
  targetStatuses: Array<{
    target: string;
    setupState: {
      initialized: boolean;
      issues: string[];
    };
  }>,
): string | null {
  const currentStatus = targetStatuses.find((status) => status.target === current);
  if (currentStatus?.setupState.initialized) {
    return null;
  }
  const readyAlternative = targetStatuses.find((status) => status.target !== current && status.setupState.initialized);
  if (!readyAlternative) {
    return null;
  }
  return `Mismatch: current launcher ${formatSetupRecommendationLabel(current)} is not ready; target ${formatSetupRecommendationLabel(readyAlternative.target)} is ready`;
}

async function removeShellInitBlock(
  filePath: string,
  startMarker: string,
  endMarker: string,
): Promise<void> {
  let existing = "";
  try {
    existing = await readFile(filePath, "utf8");
  } catch {
    return;
  }

  const lines = existing.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line === startMarker) {
      skipping = true;
      continue;
    }
    if (line === endMarker) {
      skipping = false;
      continue;
    }
    if (!skipping) {
      kept.push(line);
    }
  }

  const cleaned = kept.join("\n").replace(/\n+$/g, "\n");
  await writeFile(filePath, cleaned, "utf8");
}

async function runNodeAccountLoginCommand(
  argv: string[],
  deps?: {
    authLogin?: (input: { codexHome: string }) => Promise<void>;
    stdout?: Pick<NodeJS.WriteStream, "write">;
  },
): Promise<number> {
  const [command = "", envName = "", accountName = "", target = "cli", extra = "default", sync = "false"] = argv;
  if (command === "account-relogin-error") {
    throw new Error(
      `missing env. use: codex-sw-node ac relogin ${envName || "<account>"} --env <env> [--mode auth|apikey|sub2api]`,
    );
  }
  if (!envName || !accountName || (target !== "cli" && target !== "app" && target !== "both")) {
    throw new Error("usage: codex-sw-node ac login <account> [--env <env>] [-t cli|app|both] [--sync|--no-sync] [--mode auth|apikey|sub2api]");
  }

  const runtime = getPlatformRuntime();
  const stdout = deps?.stdout ?? process.stdout;
  const state = await readLegacyState({
    stateDir: runtime.paths.stateDir,
    envsDir: runtime.paths.envsDir,
    defaultHome: runtime.paths.defaultHome,
  });
  const envState = state.envs[envName];
  if (!envState) {
    throw new Error(`env '${envName}' not found`);
  }
  const isRelogin = process.argv[1]?.includes("node-cli.ts") && process.argv.includes("relogin");
  if (isRelogin && !envState.accounts[accountName]) {
    throw new Error(
      `account '${accountName}' not found in env '${envName}'. existing accounts are required for relogin`,
    );
  }

  await mkdir(join(runtime.paths.stateDir, "env-accounts", envName, accountName), { recursive: true });
  await mkdir(envState.path, { recursive: true });
  if (sync === "true" && envName !== "default") {
    await cloneHomeExcludingAuth(runtime.paths.defaultHome, envState.path);
  }

  if (command === "account-login-auth") {
    await (deps?.authLogin ?? defaultRunAuthLogin)({
      codexHome: envState.path,
    });
    const authRaw = await import("node:fs/promises").then(({ readFile }) =>
      readFile(join(envState.path, "auth.json"), "utf8"),
    );
    await writeFile(
      join(runtime.paths.stateDir, "env-accounts", envName, accountName, "auth.json"),
      authRaw,
      "utf8",
    );
    await writeLegacyRuntime({
      stateDir: runtime.paths.stateDir,
      envName,
      accountName,
      runtime: {
        preferredAuthMethod: "chatgpt",
        openaiBaseUrlMode: "default",
      },
    });
    await applyAccountLoginSelection({
      stateDir: runtime.paths.stateDir,
      envsDir: runtime.paths.envsDir,
      defaultHome: runtime.paths.defaultHome,
      envName,
      accountName,
      target: target as CommandTarget,
    });
    stdout.write(`Logged in account: ${envName}/${accountName}\n`);
    return 0;
  }

  if (command === "account-login-apikey") {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("API key is required");
    }
    await writeFile(
      join(runtime.paths.stateDir, "env-accounts", envName, accountName, "auth.json"),
      `${JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: apiKey }, null, 2)}\n`,
      "utf8",
    );
    await writeLegacyRuntime({
      stateDir: runtime.paths.stateDir,
      envName,
      accountName,
      runtime: {
        preferredAuthMethod: "apikey",
        openaiBaseUrlMode: extra !== "default" ? "custom" : "default",
        openaiBaseUrl: extra !== "default" ? extra : undefined,
      },
    });
    await applyAccountLoginSelection({
      stateDir: runtime.paths.stateDir,
      envsDir: runtime.paths.envsDir,
      defaultHome: runtime.paths.defaultHome,
      envName,
      accountName,
      target: target as CommandTarget,
    });
    stdout.write(`API key saved successfully for account: ${envName}/${accountName}\n`);
    stdout.write(`Logged in account: ${envName}/${accountName}\n`);
    return 0;
  }

  const authJson = buildSub2ApiAuthJson(process.env.CODEX_SWITCHER_SUB2API_JSON);
  await writeFile(
    join(runtime.paths.stateDir, "env-accounts", envName, accountName, "auth.json"),
    `${JSON.stringify(authJson, null, 2)}\n`,
    "utf8",
  );
  await writeLegacyRuntime({
    stateDir: runtime.paths.stateDir,
    envName,
    accountName,
    runtime: {
      preferredAuthMethod: "chatgpt",
      openaiBaseUrlMode: "default",
    },
  });
  await applyAccountLoginSelection({
    stateDir: runtime.paths.stateDir,
    envsDir: runtime.paths.envsDir,
    defaultHome: runtime.paths.defaultHome,
    envName,
    accountName,
    target: target as CommandTarget,
  });
  stdout.write(`Logged in account: ${envName}/${accountName}\n`);
  return 0;
}

async function cloneHomeExcludingAuth(sourcePath: string, targetPath: string) {
  const entries = await readdir(sourcePath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === "auth.json") {
      continue;
    }
    await cp(join(sourcePath, entry.name), join(targetPath, entry.name), {
      recursive: true,
      force: true,
    });
  }
}

async function applyAccountLoginSelection(input: {
  stateDir: string;
  envsDir: string;
  defaultHome: string;
  envName: string;
  accountName: string;
  target: CommandTarget;
}) {
  let state = await readLegacyState({
    stateDir: input.stateDir,
    envsDir: input.envsDir,
    defaultHome: input.defaultHome,
  });

  for (const target of expandTargets(input.target)) {
    const next = createCoreApi({ getState: () => state }).selectAccount({
      envName: input.envName,
      accountName: input.accountName,
      target,
      now: new Date().toISOString(),
    });
    await writeLegacyPointers({
      stateDir: input.stateDir,
      target,
      env: next.targets[target].env,
      account: next.targets[target].account,
    });
    await applyTargetHomeState({
      state: next,
      target,
    });
    state = next;
  }
}

function expandTargets(target: CommandTarget): Array<"cli" | "app"> {
  return target === "both" ? ["cli", "app"] : [target];
}

function summarizeCurrentTargets(
  state: Awaited<ReturnType<typeof readLegacyState>>,
  envName: string,
  accountName: string,
): string {
  const marks: string[] = [];
  if (state.targets.cli.env === envName && state.targets.cli.account === accountName) {
    marks.push("cli");
  }
  if (state.targets.app.env === envName && state.targets.app.account === accountName) {
    marks.push("app");
  }
  return marks.length > 0 ? marks.join(",") : "-";
}

function buildSub2ApiAuthJson(raw: string | undefined) {
  if (!raw?.trim()) {
    throw new Error("sub2api JSON is required");
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`invalid sub2api JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const accessToken = String(data.access_token ?? "").trim();
  const idToken = String(data.id_token ?? "").trim();
  if (!accessToken) {
    throw new Error("sub2api JSON missing access_token");
  }
  if (!idToken) {
    throw new Error("sub2api JSON missing id_token");
  }

  const payload: Record<string, unknown> = {
    auth_mode: "chatgpt",
    tokens: {
      access_token: accessToken,
      id_token: idToken,
    },
  };

  for (const key of SUB2API_EXTRA_FIELDS) {
    const value = String(data[key] ?? "").trim();
    if (value) {
      payload[key] = value;
    }
  }

  return payload;
}

async function defaultRunAuthLogin(input: { codexHome: string }): Promise<void> {
  const codexBin = process.env.CODEX_BIN || process.env.CODEX_SWITCHER_CODEX_BIN;
  if (!codexBin) {
    throw new Error("CODEX_BIN or CODEX_SWITCHER_CODEX_BIN is required for auth login");
  }
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  await execFileAsync(codexBin, ["login"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_HOME: input.codexHome,
    },
  });
}

async function runNodeProxyCommand(
  argv: string[],
  deps?: {
    runProxyTest?: (input: { stateDir: string }) => Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>;
    setManualProxy?: (value: string) => Promise<string>;
    clearManualProxy?: () => Promise<void>;
    stdout?: Pick<NodeJS.WriteStream, "write">;
  },
): Promise<number> {
  const [subcommand = "show"] = argv;
  const runtime = getPlatformRuntime();
  const stdout = deps?.stdout ?? process.stdout;

  if (argv.length > 1) {
    throw new Error("usage: codex-sw-node proxy [show|test|off|<host:port>|<scheme://host:port>]");
  }

  if (subcommand === "show") {
    const status = await readUsageProxyState(runtime.paths.stateDir);
    stdout.write(`usage_api_proxy: ${formatProxyStatusForCli(status)}\n`);
    return 0;
  }

  if (subcommand === "test") {
    const result = await (deps?.runProxyTest ?? defaultRunProxyTest)({
      stateDir: runtime.paths.stateDir,
    });
    if (result.stdout) {
      stdout.write(result.stdout);
    }
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `proxy test failed with exit code ${result.exitCode}`);
    }
    return 0;
  }

  if (subcommand === "off") {
    await (deps?.clearManualProxy ?? (async () => clearManualUsageProxy(runtime.paths.stateDir)))();
    stdout.write("Manual usage API proxy disabled\n");
    return 0;
  }

  const normalized = await (deps?.setManualProxy ?? (async (value: string) =>
    setManualUsageProxy(runtime.paths.stateDir, value)))(subcommand);
  stdout.write(`Set usage API proxy: ${normalized}\n`);
  return 0;
}

function formatProxyStatusForCli(status: UsageProxyState): string {
  if (status.source === "manual") {
    return `${status.value} (manual)`;
  }
  if (status.source === "auto-env") {
    return `${status.value} (auto:env)`;
  }
  if (status.source === "auto-system") {
    return `${status.value} (auto:system)`;
  }
  return "off";
}

function formatAppLauncherSummary(
  platform: ReturnType<typeof getPlatformRuntime>["platform"],
  env: NodeJS.ProcessEnv,
): string {
  const windowsLauncher = resolveWindowsAppLauncher(env);
  if (platform === "windows") {
    return `launcher=${windowsLauncher}`;
  }
  return `launcher=direct, windows_override=${windowsLauncher}`;
}

function formatAppLauncherDisplay(
  platform: ReturnType<typeof getPlatformRuntime>["platform"],
  env: NodeJS.ProcessEnv,
): string {
  const windowsLauncher = resolveWindowsAppLauncher(env);
  if (platform === "windows") {
    return windowsLauncher;
  }
  return `direct (windows override: ${windowsLauncher})`;
}

async function defaultRunProxyTest(input: {
  stateDir: string;
  envsDir?: string;
  defaultHome?: string;
}): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const runtime = getPlatformRuntime();
  return runProxyConnectivityTest({
    stateDir: input.stateDir,
    envsDir: input.envsDir ?? runtime.paths.envsDir,
    defaultHome: input.defaultHome ?? runtime.paths.defaultHome,
  });
}

async function runProxyConnectivityTest(input: {
  stateDir: string;
  envsDir: string;
  defaultHome: string;
  env?: NodeJS.ProcessEnv;
  usageEndpoint?: string;
  request?: (input: {
    url: string;
    accessToken: string;
    proxy: string;
  }) => Promise<{
    statusCode: number;
    bodyPreview: string;
  }>;
}): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const status = await readUsageProxyState(input.stateDir, input.env ?? process.env);
  if (status.source === "off" || !status.value) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "usage API proxy is off and no auto proxy detected. run: codex-sw-node proxy <host:port>",
    };
  }

  const state = await readLegacyState({
    stateDir: input.stateDir,
    envsDir: input.envsDir,
    defaultHome: input.defaultHome,
  });
  const envName = state.targets.cli.env;
  const accountName = state.targets.cli.account;
  const authData =
    state.envs[envName]?.accounts[accountName]?.authData ??
    state.envs[envName]?.accounts.default?.authData;

  if (!authData) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `auth.json not found for current CLI env/account: ${envName}/${accountName}`,
    };
  }

  const accessToken = extractAccessToken(authData);
  if (!accessToken) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `access_token missing for current CLI env/account: ${envName}/${accountName}`,
    };
  }

  try {
    const result = await (input.request ?? requestUsageEndpointThroughProxy)({
      url: input.usageEndpoint ?? USAGE_API_ENDPOINT,
      accessToken,
      proxy: status.value,
    });

    if (result.statusCode === 200) {
      return {
        exitCode: 0,
        stdout:
          `usage_api_proxy_test: ok (http=200, source=${status.source}, proxy=${status.value}, env/account=${envName}/${accountName})\n`,
        stderr: "",
      };
    }

    return {
      exitCode: 1,
      stdout: "",
      stderr: formatProxyFailure(
        result.statusCode,
        status.source,
        status.value,
        envName,
        accountName,
        result.bodyPreview,
      ),
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: formatProxyFailure(
        0,
        status.source,
        status.value,
        envName,
        accountName,
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
}

function extractAccessToken(authData: Record<string, string>): string {
  const raw = authData.tokens;
  if (!raw) {
    return "";
  }

  try {
    const parsed = JSON.parse(raw) as { access_token?: string };
    return parsed.access_token?.trim() || "";
  } catch {
    return "";
  }
}

async function requestUsageEndpointThroughProxy(input: {
  url: string;
  accessToken: string;
  proxy: string;
}): Promise<{
  statusCode: number;
  bodyPreview: string;
}> {
  const dispatcher = new ProxyAgent(input.proxy);
  try {
    const response = await undiciRequest(input.url, {
      method: "GET",
      dispatcher,
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        accept: "application/json",
        "user-agent": "Mozilla/5.0",
      },
    });
    const body = await response.body.text();
    return {
      statusCode: response.statusCode,
      bodyPreview: body.slice(0, 160),
    };
  } finally {
    await dispatcher.close();
  }
}

function formatProxyFailure(
  statusCode: number,
  source: UsageProxyState["source"],
  proxy: string,
  envName: string,
  accountName: string,
  bodyPreview: string,
): string {
  const lines = [
    `usage_api_proxy_test: failed (http=${statusCode > 0 ? statusCode : "000"}, source=${source}, proxy=${proxy}, env/account=${envName}/${accountName})`,
  ];
  if (bodyPreview) {
    lines.push(`response_preview: ${bodyPreview}`);
  }
  return `${lines.join("\n")}\n`;
}

async function runNodeTuiWithDeps(deps?: {
  terminal?: ReturnType<typeof createTerminal>;
  launchCli?: typeof launchCodexCli;
  launchAppNew?: typeof launchNewCodexApp;
  restartApp?: typeof restartCurrentCodexApp;
  stopManagedApp?: typeof stopManagedCodexApp;
  runTokenRefreshOnce?: () => Promise<string>;
  readTokenRefreshLog?: () => Promise<string>;
  runInitForShell?: (shell: string) => Promise<string>;
  getWindowsReadiness?: typeof getWindowsReadinessSnapshot;
  env?: NodeJS.ProcessEnv;
  stdout?: Pick<NodeJS.WriteStream, "write">;
}) {
  const terminal = deps?.terminal ?? createTerminal();
  const env = deps?.env ?? process.env;
  const runtime = getPlatformRuntime(
    env,
    env.CODEX_SWITCHER_TEST_PLATFORM || process.env.CODEX_SWITCHER_TEST_PLATFORM || process.platform,
  );
  const stdout = deps?.stdout ?? process.stdout;
  const state = await readLegacyState({
    stateDir: runtime.paths.stateDir,
    envsDir: runtime.paths.envsDir,
    defaultHome: runtime.paths.defaultHome,
  });
  const api = createCoreApi({
    getState: () => state,
  });
  const homeSetupSummary = await buildSetupStatusSummary(runtime, env);
  const homeSetupHint = [homeSetupSummary.summary, homeSetupSummary.suggestion]
    .filter(Boolean)
    .join(" | ");

  if (!terminal.isInteractive) {
    stdout.write(renderHomeScreen(0, "", homeSetupHint));
    return 0;
  }

  terminal.enter();
  try {
    let updateHint = "";
    while (true) {
      const choice = await runHomeLoop(
        terminal,
        stdout as NodeJS.WriteStream,
        updateHint,
        homeSetupHint,
      );
      updateHint = "";
      if (choice === 0) {
        await runSwitchPage(
          terminal,
          api,
          deps?.launchCli ?? launchCodexCli,
          deps?.launchAppNew ?? launchNewCodexApp,
          deps?.restartApp ?? restartCurrentCodexApp,
          runtime.paths.stateDir,
        );
        continue;
      }
      if (choice === 2) {
        await runEnvsPage(terminal, api);
        continue;
      }
      if (choice === 1) {
        await runAccountsPage(terminal, api);
        continue;
      }
      if (choice === 4) {
        await runStatusPage(terminal, api);
        continue;
      }
      if (choice === 3) {
        await runAppPage(
          terminal,
          api,
          {
            stateDir: runtime.paths.stateDir,
          },
          {
            launchAppNew: deps?.launchAppNew ?? launchNewCodexApp,
            restartApp: deps?.restartApp ?? restartCurrentCodexApp,
            stopManagedApp: deps?.stopManagedApp ?? stopManagedCodexApp,
          },
        );
        continue;
      }
      if (choice === 5) {
        await runProxyPage(terminal, {
          getProxyStatus: async () => readUsageProxyState(runtime.paths.stateDir),
          clearManualProxy: async () => {
            await clearManualUsageProxy(runtime.paths.stateDir);
          },
          runProxyTest: async () =>
            runProxyConnectivityTest({
              stateDir: runtime.paths.stateDir,
              envsDir: runtime.paths.envsDir,
              defaultHome: runtime.paths.defaultHome,
            }),
        });
        continue;
      }
      if (choice === 6) {
        await runSetupPage(terminal, {
          runtime,
          env,
          runInitForShell: deps?.runInitForShell,
          getWindowsReadiness: deps?.getWindowsReadiness,
          stdout,
        });
        continue;
      }
      if (choice === 7) {
        updateHint = await (deps?.runTokenRefreshOnce ??
          (async () => runTokenRefreshOnceForTui()))();
        continue;
      }
      if (choice === 8) {
        await runLogPage(terminal, {
          title: "Token Refresh Log",
          readContent: deps?.readTokenRefreshLog ??
            (async () =>
              readFile(resolveTokenRefreshLogPath(runtime), "utf8").catch(() => "")),
          stdout,
        });
        continue;
      }
      if (choice === HOME_MENU_ITEMS.length - 1) {
        break;
      }
      stdout.write(`Selected: ${choice + 1} ${renderMenuTitle(choice)}\n`);
      break;
    }
    return 0;
  } finally {
    terminal.leave();
  }
}

function renderMenuTitle(index: number): string {
  return HOME_MENU_ITEMS[index]?.title || "Quit";
}

async function runTokenRefreshOnceForTui(): Promise<string> {
  const writes: string[] = [];
  await runNodeTokenRefreshCommand(
    ["run-once"],
    {
      stdout: {
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      } as NodeJS.WriteStream,
    },
  );
  const output = writes.join("").trim();
  if (!output) {
    return "Token refresh scan completed";
  }
  const lines = output.split(/\r?\n/).filter(Boolean);
  return lines[lines.length - 1] ?? "Token refresh scan completed";
}

async function runSetupPage(
  terminal: ReturnType<typeof createTerminal>,
  deps: {
    runtime: ReturnType<typeof getPlatformRuntime>;
    env: NodeJS.ProcessEnv;
    runInitForShell?: (shell: string) => Promise<string>;
    getWindowsReadiness?: typeof getWindowsReadinessSnapshot;
    stdout?: Pick<NodeJS.WriteStream, "write">;
  },
): Promise<void> {
  const isWindows = deps.runtime.platform === "windows";
  const options = isWindows ? SETUP_OPTIONS_WINDOWS : SETUP_OPTIONS_UNIX;
  let selected = findSetupDefaultSelection(options, deps.runtime.platform, deps.env);
  let message = "";
  const stdout = deps.stdout ?? process.stdout;

  while (true) {
    terminal.clear();
    const statusLines = isWindows
      ? await buildWindowsSetupStatusLines(deps)
      : await buildUnixSetupStatusLines(deps.runtime, deps.env);
    const selectedTarget = options[selected]?.id ?? options[0]?.id;
    stdout.write(
      renderSetupScreen({
        platform: deps.runtime.platform,
        options,
        statusLines,
        selected,
        selectedTargetPath: selectedTarget
          ? resolveSetupInitTargetPath(selectedTarget, deps.runtime)
          : undefined,
        message,
      }),
    );

    const key = await terminal.readKey();
    if (key === "quit" || key === "escape") {
      return;
    }
    if (key === "up") {
      selected = (selected - 1 + options.length) % options.length;
      continue;
    }
    if (key === "down") {
      selected = (selected + 1) % options.length;
      continue;
    }
    if (key === "enter") {
      const shell = options[selected]?.id ?? options[0]?.id ?? "";
      if (!shell) {
        message = "No setup target available";
        continue;
      }
      const initResult = await (deps.runInitForShell ?? defaultRunInitForShell)(shell);
      message = formatSetupInitMessage(initResult, shell, deps.runtime);
    }
  }
}

async function buildWindowsSetupStatusLines(deps: {
  runtime?: ReturnType<typeof getPlatformRuntime>;
  env: NodeJS.ProcessEnv;
  getWindowsReadiness?: typeof getWindowsReadinessSnapshot;
}): Promise<string[]> {
  const snapshot = await (deps.getWindowsReadiness ?? getWindowsReadinessSnapshot)(
    deps.env,
    "win32",
  );
  const recommended = resolveRecommendedSetupTarget("windows", deps.env);
  const current = resolveCurrentSetupTarget("windows", deps.env);
  const runtime = deps.runtime ?? getPlatformRuntime(deps.env, "win32");
  const setupState = await evaluateSetupState(current, runtime);
  const targetStatuses = await Promise.all(
    SETUP_OPTIONS_WINDOWS.map(async (option) => ({
      target: option.id,
      setupState: await evaluateSetupState(option.id, runtime),
    })),
  );
  const lines = [
    `Recommended: ${formatSetupRecommendationLabel(recommended)}`,
    `Current launcher: ${formatSetupRecommendationLabel(current)}`,
    `Initialized: ${setupState.initialized ? "yes" : "no"}`,
    `Init target: ${resolveSetupInitTargetPath(current, runtime)}`,
    "Shell setup targets:",
    ...targetStatuses.map((status) => formatSetupTargetStatusLine(status.target, status.setupState)),
    ...snapshot.launchers.map(
      (launcher) => `launcher ${launcher.command}: ${launcher.resolved ? "ok" : "missing"}`,
    ),
  ];
  if (setupState.issues.length > 0) {
    lines.splice(3, 0, `Issues: ${setupState.issues.join(", ")}`);
  }
  const mismatch = formatSetupMismatch(current, targetStatuses);
  if (mismatch) {
    lines.splice(setupState.issues.length > 0 ? 4 : 3, 0, mismatch);
  }
  const suggestion = formatSetupSuggestion(recommended, current, targetStatuses);
  if (suggestion) {
    lines.splice(setupState.issues.length > 0 ? (mismatch ? 5 : 4) : (mismatch ? 4 : 3), 0, suggestion);
  }
  return lines;
}

async function buildUnixSetupStatusLines(
  runtime: ReturnType<typeof getPlatformRuntime>,
  env: NodeJS.ProcessEnv,
): Promise<string[]> {
  const recommended = resolveRecommendedSetupTarget(runtime.platform, env);
  const current = resolveCurrentSetupTarget(runtime.platform, env);
  const setupState = await evaluateSetupState(current, runtime);
  const targetStatuses = await Promise.all(
    SETUP_OPTIONS_UNIX.map(async (option) => ({
      target: option.id,
      setupState: await evaluateSetupState(option.id, runtime),
    })),
  );
  const lines = [
    `Recommended: ${formatSetupRecommendationLabel(recommended)}`,
    `Current launcher: ${formatSetupRecommendationLabel(current)}`,
    `Initialized: ${setupState.initialized ? "yes" : "no"}`,
    `Init target: ${resolveSetupInitTargetPath(current, runtime)}`,
    "Shell setup targets:",
    `rc file: ${runtime.shellInitFiles[0] ?? "-"}`,
    ...targetStatuses.map((status) => formatSetupTargetStatusLine(status.target, status.setupState)),
  ];
  if (setupState.issues.length > 0) {
    lines.splice(3, 0, `Issues: ${setupState.issues.join(", ")}`);
  }
  const mismatch = formatSetupMismatch(current, targetStatuses);
  if (mismatch) {
    lines.splice(setupState.issues.length > 0 ? 4 : 3, 0, mismatch);
  }
  const suggestion = formatSetupSuggestion(recommended, current, targetStatuses);
  if (suggestion) {
    lines.splice(setupState.issues.length > 0 ? (mismatch ? 5 : 4) : (mismatch ? 4 : 3), 0, suggestion);
  }
  return lines;
}

async function defaultRunInitForShell(shell: string): Promise<string> {
  const writes: string[] = [];
  await runNodeInitCommand(
    ["--shell", shell],
    { dryRun: false },
    {
      stdout: {
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      } as NodeJS.WriteStream,
    },
  );
  const output = writes.join("").trim();
  if (!output) {
    return `Initialized codex-sw for ${shell}`;
  }
  const lines = output.split(/\r?\n/).filter(Boolean);
  if (lines.length === 1) {
    return lines[0] ?? `Initialized codex-sw for ${shell}`;
  }
  return `${lines[0]} | ${lines[lines.length - 1]}`;
}

function formatSetupInitMessage(
  initResult: string,
  shell: string,
  runtime: ReturnType<typeof getPlatformRuntime>,
): string {
  const targetPath = resolveSetupInitTargetPath(shell, runtime);
  const prefix = `Initialized codex-sw for ${shell}`;
  if (!initResult.startsWith(prefix)) {
    return initResult;
  }
  const withPath = `${prefix} -> ${targetPath}`;
  return `${withPath}${initResult.slice(prefix.length)}`;
}

function findSetupDefaultSelection(
  options: Array<{ id: string }>,
  platform: ReturnType<typeof getPlatformRuntime>["platform"],
  env: NodeJS.ProcessEnv,
): number {
  const recommended = resolveRecommendedSetupTarget(platform, env);
  const index = options.findIndex((option) => option.id === recommended);
  return index >= 0 ? index : 0;
}

function resolveRecommendedSetupTarget(
  platform: ReturnType<typeof getPlatformRuntime>["platform"],
  env: NodeJS.ProcessEnv,
): string {
  if (platform === "windows") {
    const launcher = (env.CODEX_SWITCHER_WINDOWS_CLI_LAUNCHER || "powershell").toLowerCase();
    if (launcher === "wt" || launcher === "wt.exe" || launcher === "windows-terminal") {
      return "windows-terminal";
    }
    if (launcher === "cmd" || launcher === "cmd.exe") {
      return "cmd";
    }
    return "powershell";
  }
  return "zsh";
}

function resolveCurrentSetupTarget(
  platform: ReturnType<typeof getPlatformRuntime>["platform"],
  env: NodeJS.ProcessEnv,
): string {
  if (platform === "windows") {
    return resolveRecommendedSetupTarget(platform, env);
  }
  const shell = (env.SHELL || "").toLowerCase();
  if (shell.includes("bash")) {
    return "bash";
  }
  return "zsh";
}

function resolveSetupInitTargetPath(
  target: string,
  runtime: ReturnType<typeof getPlatformRuntime>,
): string {
  if (target === "cmd") {
    return join(runtime.paths.homeDir, "cmd-init.bat");
  }
  if (target === "powershell" || target === "windows-terminal") {
    return runtime.shellInitFiles[1] ?? runtime.shellInitFiles[0] ?? "-";
  }
  if (target === "bash") {
    return runtime.shellInitFiles[1] ?? runtime.shellInitFiles[0] ?? "-";
  }
  return runtime.shellInitFiles[0] ?? "-";
}

function formatSetupRecommendationLabel(target: string): string {
  if (target === "windows-terminal") {
    return "Windows Terminal";
  }
  if (target === "powershell") {
    return "PowerShell";
  }
  if (target === "cmd") {
    return "cmd";
  }
  return target;
}

async function runLogPage(
  terminal: ReturnType<typeof createTerminal>,
  deps: {
    title: string;
    readContent: () => Promise<string>;
    stdout?: Pick<NodeJS.WriteStream, "write">;
  },
): Promise<void> {
  let offset = 0;
  const stdout = deps.stdout ?? process.stdout;

  while (true) {
    terminal.clear();
    const raw = await deps.readContent();
    const bodyLines = raw.trim()
      ? raw.trimEnd().split(/\r?\n/)
      : ["(empty log)"];
    const viewLines = Math.max(4, terminal.rows - 5);
    const visible = bodyLines.slice(offset, offset + viewLines);
    stdout.write(
      `codex-sw-node - ${deps.title}\n\n${visible.join("\n")}\n\nUp/Down scroll  Esc/q back\n`,
    );

    const key = await terminal.readKey();
    if (key === "quit" || key === "escape") {
      return;
    }
    if (key === "up") {
      offset = Math.max(0, offset - 1);
    }
    if (key === "down") {
      offset = Math.min(Math.max(0, bodyLines.length - 1), offset + 1);
    }
  }
}

async function runAppPage(
  terminal: ReturnType<typeof createTerminal>,
  api: ReturnType<typeof createCoreApi>,
  context: {
    stateDir: string;
  },
  deps?: {
    launchAppNew?: typeof launchNewCodexApp;
    restartApp?: typeof restartCurrentCodexApp;
    stopManagedApp?: typeof stopManagedCodexApp;
    env?: NodeJS.ProcessEnv;
    getManagedAppState?: () => Promise<{
      lastInstanceId: string | null;
      instances: Array<{ instanceId: string; pid: number }>;
    }>;
    stdout?: Pick<NodeJS.WriteStream, "write">;
  },
): Promise<void> {
  let selected = 0;
  let message = "";
  const stdout = deps?.stdout ?? process.stdout;
  const launcherEnv = deps?.env ?? process.env;

  while (true) {
    terminal.clear();
    const current = api.getStatus().app.current || "default/default";
    const [currentEnv = "default", currentAccount = "default"] = current.split("/");
    const managed =
      (await deps?.getManagedAppState?.()) ??
      {
        lastInstanceId: await readLastManagedAppInstanceId(
          resolveManagedAppStatePaths(context.stateDir),
        ),
        instances: await listManagedAppInstances(resolveManagedAppStatePaths(context.stateDir)),
      };
    stdout.write(
      renderAppScreen({
        status: {
          currentEnv,
          currentAccount,
          launcher: formatAppLauncherDisplay(getPlatformRuntime().platform, launcherEnv),
          instances: managed.instances.map((instance) => ({
            ...instance,
            isLatest: instance.instanceId === managed.lastInstanceId,
          })),
        },
        selected,
        message,
      }),
    );

    const key = await terminal.readKey();
    if (key === "quit" || key === "escape") {
      return;
    }
    if (key === "up") {
      selected = (selected - 1 + APP_PAGE_ACTIONS.length) % APP_PAGE_ACTIONS.length;
      continue;
    }
    if (key === "down") {
      selected = (selected + 1) % APP_PAGE_ACTIONS.length;
      continue;
    }
    if (key === "enter") {
      const action = APP_PAGE_ACTIONS[selected]?.id ?? "restart-current";
      const appInput = {
        codexHome: currentEnv === "default"
          ? getPlatformRuntime().paths.defaultHome
          : api.getOverview().envs.find((env) => env.name === currentEnv)?.path || "",
        stateDir: context.stateDir,
      };

      if (action === "stop-managed") {
        const stopped = await (deps?.stopManagedApp ?? stopManagedCodexApp)({
          stateDir: context.stateDir,
        });
        message = stopped ? "Stopped managed app process" : "No managed app process to stop";
      } else if (action === "launch-new") {
        await (deps?.launchAppNew ?? launchNewCodexApp)(appInput);
        message =
          `Opened Codex App with: ${currentEnv}/${currentAccount} (${formatAppLauncherSummary(getPlatformRuntime().platform, launcherEnv)})`;
      } else {
        await (deps?.restartApp ?? restartCurrentCodexApp)(appInput);
        message =
          `Opened Codex App with: ${currentEnv}/${currentAccount} (${formatAppLauncherSummary(getPlatformRuntime().platform, launcherEnv)})`;
      }
    }
  }
}

async function runProxyPage(
  terminal: ReturnType<typeof createTerminal>,
  deps: {
    getProxyStatus: () => Promise<{
      source: "manual" | "auto-env" | "auto-system" | "off";
      value: string;
    }>;
    clearManualProxy: () => Promise<void>;
    setManualProxy?: (value: string) => Promise<string>;
    runProxyTest?: () => Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>;
    stdout?: Pick<NodeJS.WriteStream, "write">;
  },
): Promise<void> {
  let selected = 0;
  let message = "";
  const stdout = deps.stdout ?? process.stdout;
  let manualInputMode = false;
  let manualInputValue = "";

  while (true) {
    terminal.clear();
    const status = await deps.getProxyStatus();
    stdout.write(
      renderProxyScreen({
        status,
        selected,
        message,
      }),
    );
    if (manualInputMode) {
      stdout.write(`Enter proxy (host:port or scheme://host:port): ${manualInputValue}\n`);
    }

    const key = await terminal.readKey();
    if (key === "quit" || key === "escape") {
      if (manualInputMode) {
        manualInputMode = false;
        manualInputValue = "";
        message = "Manual proxy input cancelled";
        continue;
      }
      return;
    }
    if (manualInputMode) {
      if (key === "enter") {
        const normalized = await (deps.setManualProxy ?? (async (value: string) =>
          setManualUsageProxy(
            getPlatformRuntime().paths.stateDir,
            value,
          )))(manualInputValue);
        manualInputMode = false;
        manualInputValue = "";
        message = `Set usage API proxy: ${normalized}`;
        continue;
      }
      if (key === "backspace") {
        manualInputValue = manualInputValue.slice(0, -1);
        continue;
      }
      if (key.startsWith("char:")) {
        manualInputValue += key.slice("char:".length);
        continue;
      }
      continue;
    }
    if (key === "up") {
      selected = (selected - 1 + PROXY_PAGE_ACTIONS.length) % PROXY_PAGE_ACTIONS.length;
      continue;
    }
    if (key === "down") {
      selected = (selected + 1) % PROXY_PAGE_ACTIONS.length;
      continue;
    }
    if (key === "enter") {
      const action = PROXY_PAGE_ACTIONS[selected]?.id ?? "auto";
      if (action === "auto") {
        await deps.clearManualProxy();
        message = "Manual usage API proxy disabled";
      } else if (action === "manual") {
        manualInputMode = true;
        manualInputValue = status.source === "manual" ? status.value : "";
        message = "";
      } else {
        const result = await (deps.runProxyTest ??
          (async () =>
            defaultRunProxyTest({
              stateDir: getPlatformRuntime().paths.stateDir,
            })))();
        message = (result.stdout || result.stderr || "proxy test produced no output").trim();
      }
    }
  }
}

async function runStatusPage(
  terminal: ReturnType<typeof createTerminal>,
  api: ReturnType<typeof createCoreApi>,
): Promise<void> {
  let offset = 0;
  const runtime = getNodeCliRuntime();
  const status = api.getStatus();
  const setupSummary = await buildSetupStatusSummary(runtime, process.env);

  while (true) {
    terminal.clear();
    process.stdout.write(
      renderStatusScreen({
        status: {
          ...status,
          setup: setupSummary,
        },
        accounts: api.getOverview().accounts,
        offset,
        viewLines: Math.max(6, terminal.rows - 6),
      }),
    );

    const key = await terminal.readKey();
    if (key === "quit" || key === "escape") {
      return;
    }
    if (key === "up") {
      offset = Math.max(0, offset - 1);
    }
    if (key === "down") {
      offset += 1;
    }
  }
}

async function buildSetupStatusSummary(
  runtime: ReturnType<typeof getPlatformRuntime>,
  env: NodeJS.ProcessEnv,
): Promise<{
  summary: string;
  suggestion: string;
}> {
  const current = resolveCurrentSetupTarget(runtime.platform, env);
  const recommended = resolveRecommendedSetupTarget(runtime.platform, env);
  const options = runtime.platform === "windows" ? SETUP_OPTIONS_WINDOWS : SETUP_OPTIONS_UNIX;
  const targetStatuses = await Promise.all(
    options.map(async (option) => ({
      target: option.id,
      setupState: await evaluateSetupState(option.id, runtime),
    })),
  );
  return {
    summary: formatSetupMismatch(current, targetStatuses) ?? "",
    suggestion: formatSetupSuggestion(recommended, current, targetStatuses),
  };
}

async function runAccountsPage(
  terminal: ReturnType<typeof createTerminal>,
  api: ReturnType<typeof createCoreApi>,
): Promise<void> {
  let offset = 0;

  while (true) {
    terminal.clear();
    process.stdout.write(
      renderAccountsScreen({
        accounts: api.getOverview().accounts,
        offset,
        viewLines: Math.max(6, terminal.rows - 6),
      }),
    );

    const key = await terminal.readKey();
    if (key === "quit" || key === "escape") {
      return;
    }
    if (key === "up") {
      offset = Math.max(0, offset - 1);
    }
    if (key === "down") {
      offset += 1;
    }
  }
}

async function runEnvsPage(
  terminal: ReturnType<typeof createTerminal>,
  api: ReturnType<typeof createCoreApi>,
): Promise<void> {
  let offset = 0;

  while (true) {
    terminal.clear();
    process.stdout.write(
      renderEnvsScreen({
        envs: api.getOverview().envs,
        offset,
        viewLines: Math.max(6, terminal.rows - 6),
      }),
    );

    const key = await terminal.readKey();
    if (key === "quit" || key === "escape") {
      return;
    }
    if (key === "up") {
      offset = Math.max(0, offset - 1);
    }
    if (key === "down") {
      offset += 1;
    }
  }
}

async function runSwitchPage(
  terminal: ReturnType<typeof createTerminal>,
  api: ReturnType<typeof createCoreApi>,
  launchCli: typeof launchCodexCli,
  launchAppNew: typeof launchNewCodexApp,
  restartApp: typeof restartCurrentCodexApp,
  stateDir: string,
): Promise<void> {
  let stage: "target" | "env" | "account" | "action" | "summary" = "target";
  let targetIndex = 0;
  let envIndex = 0;
  let accountIndex = 0;
  let actionIndex = 0;

  while (true) {
    const overview = api.getOverview();
    const targets = listTargetOptions();
    const target = targets[targetIndex] ?? "cli";
    const envs = listEnvOptions(overview.envs, target);
    const env = envs[envIndex] ?? envs[0];
    const accounts = env ? listAccountOptions(overview.accounts, env.name, target) : [];
    const account = accounts[accountIndex] ?? accounts[0];
    const appActions = ["restart-current", "launch-new"];
    const action = target === "cli" ? "launch-cli" : (appActions[actionIndex] ?? "restart-current");

    terminal.clear();
    process.stdout.write(renderSwitchStage(stage, {
      target,
      envName: env?.name ?? "-",
      accountName: account?.name ?? "-",
      actionLabel: action,
      targets,
      envs,
      accounts,
      appActions,
      targetIndex,
      envIndex,
      accountIndex,
      actionIndex,
    }));

    const key = await terminal.readKey();
    if (key === "quit" || key === "escape") {
      if (stage === "target") {
        return;
      }
      if (stage === "summary") {
        stage = target === "cli" ? "account" : "action";
        continue;
      }
      if (stage === "action") {
        stage = "account";
        continue;
      }
      if (stage === "account") {
        stage = "env";
        continue;
      }
      if (stage === "env") {
        stage = "target";
      }
      continue;
    }

    if (key === "up") {
      if (stage === "target") {
        targetIndex = (targetIndex - 1 + targets.length) % targets.length;
      } else if (stage === "env" && envs.length > 0) {
        envIndex = (envIndex - 1 + envs.length) % envs.length;
      } else if (stage === "account" && accounts.length > 0) {
        accountIndex = (accountIndex - 1 + accounts.length) % accounts.length;
      } else if (stage === "action") {
        actionIndex = (actionIndex - 1 + appActions.length) % appActions.length;
      }
      continue;
    }

    if (key === "down") {
      if (stage === "target") {
        targetIndex = (targetIndex + 1) % targets.length;
      } else if (stage === "env" && envs.length > 0) {
        envIndex = (envIndex + 1) % envs.length;
      } else if (stage === "account" && accounts.length > 0) {
        accountIndex = (accountIndex + 1) % accounts.length;
      } else if (stage === "action") {
        actionIndex = (actionIndex + 1) % appActions.length;
      }
      continue;
    }

    if (key === "enter") {
      if (stage === "target") {
        envIndex = 0;
        accountIndex = 0;
        stage = "env";
      } else if (stage === "env") {
        accountIndex = 0;
        stage = "account";
      } else if (stage === "account") {
        stage = target === "cli" ? "summary" : "action";
      } else if (stage === "action") {
        stage = "summary";
      } else {
        if (env && account) {
          api = await executeSwitchSelection(api, {
            target,
            envName: env.name,
            accountName: account.name,
            action,
            stateDir,
          }, launchCli, launchAppNew, restartApp);
        }
        return;
      }
    }
  }
}

async function executeSwitchSelection(
  api: ReturnType<typeof createCoreApi>,
  input: {
    target: "cli" | "app";
    envName: string;
    accountName: string;
    action: string;
    stateDir: string;
  },
  launchCli: typeof launchCodexCli,
  launchAppNew: typeof launchNewCodexApp,
  restartApp: typeof restartCurrentCodexApp,
) {
  const nextState = await executeAccountUse({
    envName: input.envName,
    accountName: input.accountName,
    target: input.target,
  });

  if (input.target === "cli") {
    await launchCli({
      codexHome: nextState.envs[nextState.targets.cli.env]?.path || "",
    });
  } else {
    const appInput = {
      codexHome: nextState.envs[nextState.targets.app.env]?.path || "",
      stateDir: input.stateDir,
    };
    if (input.action === "launch-new") {
      await launchAppNew(appInput);
    } else {
      await restartApp(appInput);
    }
  }

  return createCoreApi({
    getState: () => nextState,
  });
}

export const __internal = {
  runNodeTuiWithDeps,
  executeSwitchSelection,
  runNodeAccountLoginCommand,
  runNodeCliCommand,
  runNodeOpsListCommand,
  runNodeRecoverCommand,
  runNodeInstallCommand,
  runNodeUninstallCommand,
  runNodeTokenRefreshCommand,
  runNodeAppCommand,
  runNodeProxyCommand,
  runProxyConnectivityTest,
  runAppPage,
  runProxyPage,
  runSetupPage,
};

function renderSwitchStage(
  stage: "target" | "env" | "account" | "summary",
  input: {
    target: "cli" | "app";
    envName: string;
    accountName: string;
    actionLabel: string;
    targets: Array<"cli" | "app">;
    envs: Array<{ name: string }>;
    accounts: Array<{ name: string; authMode: string; runtime?: { preferredAuthMethod?: string } }>;
    appActions: string[];
    targetIndex: number;
    envIndex: number;
    accountIndex: number;
    actionIndex: number;
  },
): string {
  if (stage === "summary") {
    return renderSwitchSummary({
      target: input.target,
      envName: input.envName,
      accountName: input.accountName,
      actionLabel: input.actionLabel,
    });
  }

  const title =
    stage === "target"
      ? "Select target"
      : stage === "env"
        ? "Select environment"
        : stage === "account"
          ? "Select account"
          : "Select action";

  const options =
    stage === "target"
      ? input.targets.map((item, index) => `${index === input.targetIndex ? ">" : " "} ${item}`)
      : stage === "env"
        ? input.envs.map((item, index) => `${index === input.envIndex ? ">" : " "} ${item.name}`)
        : stage === "account"
          ? input.accounts.map(
              (item, index) =>
                `${index === input.accountIndex ? ">" : " "} ${item.name} (${item.authMode}/${item.runtime?.preferredAuthMethod ?? "-"})`,
            )
          : input.appActions.map(
              (item, index) => `${index === input.actionIndex ? ">" : " "} ${item}`,
            );

  return [
    "codex-sw-node - Switch",
    "",
    `Target:  ${input.target}`,
    `Env:     ${input.envName}`,
    `Account: ${input.accountName}`,
    "",
    title,
    ...options,
    "",
    "Up/Down move  Enter select  Esc/q back",
    "",
  ].join("\n");
}
