import { spawn } from "node:child_process";
import process from "node:process";

import { resolveCodexAppPath } from "./command-discovery.js";
import {
  buildManagedAppStopPlan,
  executeManagedAppStopPlan,
} from "./codex-app-stop.js";
import {
  listManagedAppInstances,
  resolveManagedAppStatePaths,
  setManagedAppInstance,
  stopManagedAppPid,
  type ManagedAppStopper,
  writeManagedAppPid,
} from "./codex-app-runtime.js";
import { detectPlatform } from "./os.js";

export interface CodexAppLaunchInput {
  codexHome: string;
  env?: NodeJS.ProcessEnv;
}

export interface CodexAppRunnerResult {
  pid: number | null;
}

export type CodexAppRunner = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) => Promise<CodexAppRunnerResult>;

export interface CodexAppActionInput extends CodexAppLaunchInput {
  stateDir: string;
}

export interface CodexAppLaunchSpec {
  command: string;
  args: string[];
}

export interface StopManagedCodexAppInput {
  stateDir: string;
  applicationName?: string;
}

export async function launchCodexApp(
  input: CodexAppLaunchInput,
  runner: CodexAppRunner = defaultCodexAppRunner,
): Promise<CodexAppRunnerResult> {
  const explicitBin = input.env?.CODEX_SWITCHER_APP_BIN;
  const resolved = explicitBin || (await resolveCodexAppPath(input.env));
  if (!resolved) {
    throw new Error("Codex.app binary not found. set CODEX_SWITCHER_APP_BIN manually");
  }

  const mergedEnv = {
    ...process.env,
    ...input.env,
    CODEX_HOME: input.codexHome,
    CODEX_SWITCHER_MANAGED: "1",
  };
  const launchSpec = buildCodexAppLaunchSpec(resolved, mergedEnv);
  return runner(launchSpec.command, launchSpec.args, mergedEnv);
}

export function buildCodexAppLaunchSpec(
  appPath: string,
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): CodexAppLaunchSpec {
  if (detectPlatform(platform) !== "windows") {
    return {
      command: appPath,
      args: [],
    };
  }

  const launcher = resolveWindowsAppLauncher(env);
  if (launcher === "wt" || launcher === "windows-terminal" || launcher === "wt.exe") {
    return {
      command: "wt.exe",
      args: ["-w", "new", appPath],
    };
  }

  if (launcher === "powershell" || launcher === "pwsh" || launcher === "powershell.exe") {
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Start-Process -FilePath '${escapePowerShellSingleQuoted(appPath)}'`,
      ],
    };
  }

  return {
    command: "cmd.exe",
    args: [
      "/d",
      "/s",
      "/c",
      `start "" /b "${escapeCmdDoubleQuoted(appPath)}"`,
    ],
  };
}

export function resolveWindowsAppLauncher(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (env.CODEX_SWITCHER_WINDOWS_APP_LAUNCHER || "cmd").toLowerCase();
}

export async function launchNewCodexApp(
  input: CodexAppActionInput,
  runner: CodexAppRunner = defaultCodexAppRunner,
): Promise<CodexAppRunnerResult> {
  const result = await launchCodexApp(input, runner);
  const paths = resolveManagedAppStatePaths(input.stateDir);
  if (result.pid !== null) {
    const instanceId = await nextManagedAppInstanceId(paths);
    await setManagedAppInstance(paths, {
      instanceId,
      pid: result.pid,
    });
  } else {
    await writeManagedAppPid(paths, null);
  }
  return result;
}

export async function stopManagedCodexApp(
  input: StopManagedCodexAppInput,
  stopper: ManagedAppStopper = defaultManagedAppStopper,
): Promise<boolean> {
  return stopManagedAppPid(resolveManagedAppStatePaths(input.stateDir), stopper, input.applicationName);
}

export async function restartCurrentCodexApp(
  input: CodexAppActionInput,
  runner: CodexAppRunner = defaultCodexAppRunner,
  stopper: ManagedAppStopper = defaultManagedAppStopper,
): Promise<CodexAppRunnerResult> {
  const applicationName = resolveMacOsApplicationName(input.env?.CODEX_SWITCHER_APP_BIN);
  await stopManagedCodexApp({ stateDir: input.stateDir, applicationName }, stopper);
  return launchNewCodexApp(input, runner);
}

async function defaultManagedAppStopper(pid: number, applicationName?: string): Promise<boolean> {
  try {
    await executeManagedAppStopPlan(
      buildManagedAppStopPlan({
        platform: detectPlatform(
          (process.env.CODEX_SWITCHER_TEST_PLATFORM as NodeJS.Platform | undefined) ||
            process.platform,
        ),
        pid,
        preferAppQuit: true,
        applicationName,
      }),
    );
    return true;
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : "";

    if (code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

function resolveMacOsApplicationName(appPath: string | undefined): string | undefined {
  if (!appPath) return undefined;
  const match = /\/([^/]+)\.app(?:\/|$)/.exec(appPath);
  return match?.[1];
}

async function nextManagedAppInstanceId(
  paths: ReturnType<typeof resolveManagedAppStatePaths>,
): Promise<string> {
  const instances = await listManagedAppInstances(paths);
  let max = 0;
  for (const instance of instances) {
    const match = /^instance-(\d+)$/.exec(instance.instanceId);
    if (!match) {
      continue;
    }
    max = Math.max(max, Number(match[1]));
  }
  return `instance-${max + 1}`;
}

async function defaultCodexAppRunner(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<CodexAppRunnerResult> {
  return new Promise<CodexAppRunnerResult>((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      detached: true,
      stdio: "ignore",
    });

    child.on("error", reject);
    child.on("spawn", () => {
      child.unref();
      resolve({
        pid: child.pid ?? null,
      });
    });
  });
}

function escapeCmdDoubleQuoted(value: string): string {
  return value.replace(/"/g, '""');
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}
