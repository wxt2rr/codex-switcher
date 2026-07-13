import process from "node:process";

import { type SwitcherPlatform } from "./os.js";

export interface ManagedAppStopPlanInput {
  platform: SwitcherPlatform;
  pid: number;
  preferAppQuit?: boolean;
  applicationName?: string;
}

export type ManagedAppStopPlanStep =
  | {
      kind: "spawn";
      command: string;
      args: string[];
      optional?: boolean;
    }
  | {
      kind: "signal";
      pid: number;
      signal: NodeJS.Signals;
    };

export interface ManagedAppStopExecutor {
  spawn(command: string, args: string[]): Promise<void>;
  signal(pid: number, signal: NodeJS.Signals): Promise<void>;
}

export interface ManagedAppExitWaiter {
  isRunning(pid: number): Promise<boolean>;
  signal(pid: number, signal: NodeJS.Signals): Promise<void>;
  delay(ms: number): Promise<void>;
}

export function buildManagedAppStopPlan(
  input: ManagedAppStopPlanInput,
): ManagedAppStopPlanStep[] {
  if (input.platform === "windows") {
    return [
      {
        kind: "spawn",
        command: "taskkill",
        args: ["/PID", String(input.pid), "/T", "/F"],
      },
    ];
  }

  const steps: ManagedAppStopPlanStep[] = [];

  if (input.platform === "macos" && input.preferAppQuit) {
    const applicationName = input.applicationName?.trim() || "Codex";
    steps.push({
      kind: "spawn",
      command: "osascript",
      args: ["-e", `tell application ${JSON.stringify(applicationName)} to quit`],
      optional: true,
    });
    steps.push({
      kind: "spawn",
      command: "pkill",
      args: ["-x", applicationName],
      optional: true,
    });
  }

  steps.push({
    kind: "signal",
    pid: -Math.abs(input.pid),
    signal: "SIGTERM",
  });

  return steps;
}

export async function waitForManagedAppExit(
  input: { platform: SwitcherPlatform; pid: number; gracefulTimeoutMs?: number; forceTimeoutMs?: number; pollMs?: number },
  waiter: ManagedAppExitWaiter = defaultManagedAppExitWaiter,
): Promise<void> {
  if (input.platform === "windows") return;
  const processGroupId = -Math.abs(input.pid);
  const processId = Math.abs(input.pid);
  const pollMs = input.pollMs ?? 50;
  let useProcessGroup = true;
  const isRunning = async () => {
    try {
      return await waiter.isRunning(useProcessGroup ? processGroupId : processId);
    } catch (error) {
      if (!useProcessGroup || !isProcessPermissionError(error)) throw error;
      useProcessGroup = false;
      return waiter.isRunning(processId);
    }
  };
  const waitUntilStopped = async (timeoutMs: number) => {
    const attempts = Math.max(1, Math.ceil(timeoutMs / pollMs));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (!await isRunning()) return true;
      await waiter.delay(pollMs);
    }
    return !await isRunning();
  };
  if (await waitUntilStopped(input.gracefulTimeoutMs ?? 3000)) return;
  try {
    await waiter.signal(useProcessGroup ? processGroupId : processId, "SIGKILL");
  } catch (error) {
    if (useProcessGroup && isProcessPermissionError(error)) {
      useProcessGroup = false;
      await waiter.signal(processId, "SIGKILL");
    } else if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
  if (!await waitUntilStopped(input.forceTimeoutMs ?? 1500)) {
    throw new Error(`Managed Codex App process group ${Math.abs(input.pid)} did not exit`);
  }
}

export async function executeManagedAppStopPlan(
  plan: ManagedAppStopPlanStep[],
  executor: ManagedAppStopExecutor = defaultManagedAppStopExecutor,
): Promise<boolean> {
  for (const step of plan) {
    try {
      if (step.kind === "spawn") {
        await executor.spawn(step.command, step.args);
      } else {
        try {
          await executor.signal(step.pid, step.signal);
        } catch (error) {
          if (step.pid < 0 && isProcessPermissionError(error)) {
            await executor.signal(Math.abs(step.pid), step.signal);
          } else {
            throw error;
          }
        }
      }
    } catch (error) {
      if (step.kind === "spawn" && isIgnorableWindowsTaskkillError(step, error)) {
        continue;
      }
      if (step.kind === "spawn" && step.optional) {
        continue;
      }
      throw error;
    }
  }

  return true;
}

function isProcessPermissionError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "EPERM";
}

function isIgnorableWindowsTaskkillError(
  step: ManagedAppStopPlanStep,
  error: unknown,
): boolean {
  if (step.kind !== "spawn" || step.command.toLowerCase() !== "taskkill") {
    return false;
  }

  const stderr =
    typeof error === "object" &&
    error !== null &&
    "stderr" in error
      ? String((error as { stderr?: unknown }).stderr ?? "")
      : "";

  return /not found|no running instance|process .* could not be found/i.test(stderr);
}

async function defaultManagedAppStopExecutorSpawn(
  command: string,
  args: string[],
): Promise<void> {
  const { spawn } = await import("node:child_process");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "ignore",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0 || code === null) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

const defaultManagedAppStopExecutor: ManagedAppStopExecutor = {
  spawn: defaultManagedAppStopExecutorSpawn,
  async signal(pid, signal) {
    process.kill(pid, signal);
  },
};

const defaultManagedAppExitWaiter: ManagedAppExitWaiter = {
  async isRunning(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  },
  async signal(pid, signal) {
    process.kill(pid, signal);
  },
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};
