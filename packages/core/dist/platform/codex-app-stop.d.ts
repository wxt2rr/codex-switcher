import { type SwitcherPlatform } from "./os.js";
export interface ManagedAppStopPlanInput {
    platform: SwitcherPlatform;
    pid: number;
    preferAppQuit?: boolean;
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
export declare function buildManagedAppStopPlan(input: ManagedAppStopPlanInput): ManagedAppStopPlanStep[];
export declare function executeManagedAppStopPlan(plan: ManagedAppStopPlanStep[], executor?: ManagedAppStopExecutor): Promise<boolean>;
