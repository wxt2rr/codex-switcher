import { type SwitcherPlatform } from "./os.js";
export interface SwitcherRuntimePaths {
    homeDir: string;
    stateDir: string;
    envsDir: string;
    defaultHome: string;
}
export interface SwitcherPlatformRuntime {
    platform: SwitcherPlatform;
    paths: SwitcherRuntimePaths;
    codexCliCandidates: string[];
    npmCommand: string;
    shellInitFiles: string[];
}
export declare function resolveHomeDir(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string;
export declare function resolveRuntimePaths(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): SwitcherRuntimePaths;
export declare function executableCandidates(baseName: string, platform?: NodeJS.Platform): string[];
export declare function shellInitFiles(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string[];
export declare function getPlatformRuntime(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): SwitcherPlatformRuntime;
