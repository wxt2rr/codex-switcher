export interface ResolvedCommand {
    source: "env" | "candidate";
    path: string;
}
export interface WindowsLauncherCommandStatus {
    command: string;
    resolved: ResolvedCommand | null;
}
export interface WindowsReadinessSnapshot {
    launchers: WindowsLauncherCommandStatus[];
    cliCandidates: string[];
    appCandidates: string[];
    shellInitFiles: string[];
}
export declare function resolveCommandPath(command: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): Promise<ResolvedCommand | null>;
export declare function resolveCodexAppPath(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): Promise<string | null>;
export declare function resolveWindowsLauncherCommands(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): Promise<WindowsLauncherCommandStatus[]>;
export declare function getWindowsReadinessSnapshot(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): Promise<WindowsReadinessSnapshot>;
export declare function codexCliCandidatePaths(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string[];
export declare function codexAppCandidatePaths(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string[];
