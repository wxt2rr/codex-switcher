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

export function createTaskRunner(): TaskRunner {
  const recent: TaskRecord[] = [];
  let nextId = 1;

  return {
    async run<T>(task: TaskDefinition<T>): Promise<TaskRecord<T>> {
      const record: TaskRecord<T> = {
        id: `task-${nextId++}`,
        kind: task.kind,
        summary: task.summary,
        status: "running",
        startedAt: new Date().toISOString(),
        progress: [],
        logs: [],
      };

      const context: TaskExecutionContext = {
        log(message) {
          record.logs.push(message);
        },
        updateProgress(step) {
          record.progress.push(step);
        },
      };

      try {
        const output = await task.execute(context);
        record.status = "succeeded";
        record.output = output;
        record.finishedAt = new Date().toISOString();
        recent.unshift(record);
        return record;
      } catch (error) {
        record.status = "failed";
        record.error = error instanceof Error ? error.message : String(error);
        record.finishedAt = new Date().toISOString();
        recent.unshift(record);
        throw error;
      }
    },

    listRecent() {
      return recent.slice();
    },
  };
}
