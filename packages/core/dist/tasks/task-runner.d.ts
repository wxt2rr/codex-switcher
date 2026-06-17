export type TaskStatus = "running" | "succeeded" | "failed";
export interface TaskRecord<T = unknown> {
    id: string;
    kind: string;
    summary: string;
    status: TaskStatus;
    startedAt: string;
    finishedAt?: string;
    progress: string[];
    logs: string[];
    output?: T;
    error?: string;
}
export interface TaskExecutionContext {
    log(message: string): void;
    updateProgress(step: string): void;
}
export interface TaskDefinition<T> {
    kind: string;
    summary: string;
    execute(context: TaskExecutionContext): Promise<T>;
}
export interface TaskRunner {
    run<T>(task: TaskDefinition<T>): Promise<TaskRecord<T>>;
    listRecent(): TaskRecord[];
}
export declare function createTaskRunner(): TaskRunner;
