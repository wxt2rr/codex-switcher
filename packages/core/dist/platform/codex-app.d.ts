import { type ManagedAppStopper } from "./codex-app-runtime.js";
export interface CodexAppLaunchInput {
    codexHome: string;
    env?: NodeJS.ProcessEnv;
    userDataDir?: string;
}
export interface CodexAppRunnerResult {
    pid: number | null;
}
export type CodexAppRunner = (command: string, args: string[], env: NodeJS.ProcessEnv, options?: {
    acceptEarlyExit?: boolean;
}) => Promise<CodexAppRunnerResult>;
export interface CodexAppActionInput extends CodexAppLaunchInput {
    stateDir: string;
    targetKey?: string;
}
export interface CodexAppLaunchSpec {
    command: string;
    args: string[];
    acceptEarlyExit?: boolean;
}
export interface StopManagedCodexAppInput {
    stateDir: string;
    applicationName?: string;
    targetKey?: string;
}
export declare function launchCodexApp(input: CodexAppLaunchInput, runner?: CodexAppRunner): Promise<CodexAppRunnerResult>;
export declare function buildCodexAppLaunchSpec(appPath: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, userDataDir?: string): CodexAppLaunchSpec;
export declare function resolveWindowsAppLauncher(env?: NodeJS.ProcessEnv): string;
export declare function launchNewCodexApp(input: CodexAppActionInput, runner?: CodexAppRunner): Promise<CodexAppRunnerResult>;
export declare function stopManagedCodexApp(input: StopManagedCodexAppInput, stopper?: ManagedAppStopper): Promise<boolean>;
export declare function restartCurrentCodexApp(input: CodexAppActionInput, runner?: CodexAppRunner, stopper?: ManagedAppStopper): Promise<CodexAppRunnerResult>;
