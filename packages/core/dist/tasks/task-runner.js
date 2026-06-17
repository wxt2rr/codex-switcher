export function createTaskRunner() {
    const recent = [];
    let nextId = 1;
    return {
        async run(task) {
            const record = {
                id: `task-${nextId++}`,
                kind: task.kind,
                summary: task.summary,
                status: "running",
                startedAt: new Date().toISOString(),
                progress: [],
                logs: [],
            };
            const context = {
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
            }
            catch (error) {
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
//# sourceMappingURL=task-runner.js.map