import type { SwitcherState, TargetName } from "../state/store.js";
export interface EnvSummary {
    name: string;
    path: string;
    isCurrentCli: boolean;
    isCurrentApp: boolean;
    accountCount: number;
}
export interface CreateEnvInput {
    envName: string;
    homePath: string;
    cloneFromEnv?: string;
    now: string;
}
export interface RemoveEnvInput {
    envName: string;
}
export interface SelectEnvInput {
    target: TargetName;
    envName: string;
    now: string;
}
export interface EnvServiceError extends Error {
    code: "ENV_EXISTS" | "ENV_NOT_FOUND" | "RESERVED_ENV";
}
export declare function createEnvService(): {
    listEnvs(state: SwitcherState): EnvSummary[];
    createEnv(state: SwitcherState, input: CreateEnvInput): SwitcherState;
    removeEnv(state: SwitcherState, input: RemoveEnvInput): SwitcherState;
    selectEnv(state: SwitcherState, input: SelectEnvInput): SwitcherState;
};
