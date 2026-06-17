import type { TaskRecord, TaskRunner } from "./task-runner.js";
export interface ExternalCommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}
export type ExternalCommandRunner = (command: string, args: string[], env?: Record<string, string>) => Promise<ExternalCommandResult>;
export interface BridgeTaskServiceOptions {
    runner: ExternalCommandRunner;
    tasks: TaskRunner;
}
export declare function createBridgeTaskService(options: BridgeTaskServiceOptions): {
    runAuthLogin(input: {
        codexBin: string;
        codexHome: string;
    }): Promise<TaskRecord<ExternalCommandResult>>;
    runProxyTest(input: {
        command: string;
        args: string[];
    }): Promise<TaskRecord<ExternalCommandResult>>;
};
