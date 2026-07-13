import { type SwitcherPlatform } from "./os.js";
export interface ManagedAppStopPlanInput {
    platform: SwitcherPlatform;
    pid: number;
    preferAppQuit?: boolean;
    applicationName?: string;
}
export type ManagedAppStopPlanStep = {
    kind: "spawn";
    command: string;
    args: string[];
    optional?: boolean;
} | {
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
export declare function buildManagedAppStopPlan(input: ManagedAppStopPlanInput): ManagedAppStopPlanStep[];
export declare function waitForManagedAppExit(input: {
    platform: SwitcherPlatform;
    pid: number;
    gracefulTimeoutMs?: number;
    forceTimeoutMs?: number;
    pollMs?: number;
}, waiter?: ManagedAppExitWaiter): Promise<void>;
export declare function executeManagedAppStopPlan(plan: ManagedAppStopPlanStep[], executor?: ManagedAppStopExecutor): Promise<boolean>;
