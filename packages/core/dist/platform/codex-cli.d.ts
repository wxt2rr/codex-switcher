export interface CodexCliLaunchInput {
    codexHome: string;
    args?: string[];
    env?: NodeJS.ProcessEnv;
}
export interface CodexCliRunnerResult {
    exitCode: number;
}
export type CodexCliRunner = (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<CodexCliRunnerResult>;
export declare function launchCodexCli(input: CodexCliLaunchInput, runner?: CodexCliRunner): Promise<CodexCliRunnerResult>;
