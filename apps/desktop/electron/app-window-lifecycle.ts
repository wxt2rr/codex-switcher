export type AppWindowLaunchMode = "reconcile" | "additional";
export type AppWindowLaunchAction = "restart" | "new";

export interface AppWindowLaunchPlan {
  stopPackagedProcesses: boolean;
  materializePackagedHome: boolean;
  actions: AppWindowLaunchAction[];
}

export class AppWindowLaunchError extends Error {
  readonly launchedCount: number;

  constructor(launchedCount: number, cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(`App window launch stopped after ${launchedCount} successful window${launchedCount === 1 ? "" : "s"}: ${causeMessage}`,
      { cause });
    this.name = "AppWindowLaunchError";
    this.launchedCount = launchedCount;
  }
}

export function assertCanMultiOpen(input: {
  target: "cli" | "app";
  envName: string;
  accountName: string;
  activeEnvName: string;
  activeAccountName: string;
  currentCount: number;
  maximumCount: number;
}): void {
  if (input.target !== "app") throw new Error("Multi-open is only supported for App accounts");
  if (input.activeEnvName !== input.envName || input.activeAccountName !== input.accountName) {
    throw new Error("Only the active App account supports multi-open");
  }
  if (input.currentCount >= input.maximumCount) {
    throw new Error(`App multi-open supports up to ${input.maximumCount} windows per environment`);
  }
}

export async function launchAndPersistAdditionalAppWindow(input: {
  currentCount: number;
  maximumCount: number;
  launch: () => Promise<void>;
  saveCount: (count: number) => Promise<number>;
}): Promise<number> {
  if (input.currentCount >= input.maximumCount) {
    throw new Error(`App multi-open supports up to ${input.maximumCount} windows per environment`);
  }
  await input.launch();
  return input.saveCount(input.currentCount + 1);
}

export function resolveCurrentAppWindowCount(persistedCount: number, trackedCount?: number): number {
  if (trackedCount === undefined) return Math.max(1, Math.trunc(persistedCount) || 1);
  return Math.max(1, Math.trunc(trackedCount) || 0);
}

export function buildAppWindowLaunchPlan(input: {
  mode: AppWindowLaunchMode;
  desiredCount: number;
  packagedWindowsTarget: boolean;
}): AppWindowLaunchPlan {
  const desiredCount = Math.max(1, Math.trunc(input.desiredCount) || 1);
  if (input.mode === "additional") {
    return {
      stopPackagedProcesses: false,
      materializePackagedHome: false,
      actions: ["new"],
    };
  }
  if (input.packagedWindowsTarget) {
    return {
      stopPackagedProcesses: true,
      materializePackagedHome: true,
      actions: Array.from({ length: desiredCount }, () => "new" as const),
    };
  }
  return {
    stopPackagedProcesses: false,
    materializePackagedHome: false,
    actions: ["restart", ...Array.from({ length: desiredCount - 1 }, () => "new" as const)],
  };
}

export async function executeAppWindowLaunchPlan(
  plan: AppWindowLaunchPlan,
  actions: { restart: () => Promise<void>; launchNew: () => Promise<void> },
): Promise<number> {
  let launchedCount = 0;
  try {
    for (const action of plan.actions) {
      if (action === "restart") await actions.restart();
      else await actions.launchNew();
      launchedCount += 1;
    }
    return launchedCount;
  } catch (error) {
    throw new AppWindowLaunchError(launchedCount, error);
  }
}
