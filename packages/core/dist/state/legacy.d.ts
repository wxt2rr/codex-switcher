import { type AccountState, type SwitcherState } from "./store.js";
export interface ReadLegacyStateOptions {
    stateDir: string;
    envsDir: string;
    defaultHome: string;
    now?: string;
}
export interface WriteLegacyPointersOptions {
    stateDir: string;
    target: "cli" | "app";
    env: string;
    account: string;
}
export interface WriteLegacyRuntimeOptions {
    stateDir: string;
    envName: string;
    accountName: string;
    runtime: AccountState["runtime"];
}
export interface CreateLegacyEnvOptions {
    envsDir: string;
    envName: string;
}
export interface UpdateLegacyEnvOptions {
    stateDir: string;
    envsDir: string;
    envName: string;
    nextEnvName: string;
    homePath: string;
}
export declare function readLegacyState(options: ReadLegacyStateOptions): Promise<SwitcherState>;
export declare function writeLegacyPointers(options: WriteLegacyPointersOptions): Promise<void>;
export declare function writeLegacyRuntime(options: WriteLegacyRuntimeOptions): Promise<void>;
export declare function createLegacyEnv(options: CreateLegacyEnvOptions): Promise<void>;
export declare function updateLegacyEnv(options: UpdateLegacyEnvOptions): Promise<void>;
