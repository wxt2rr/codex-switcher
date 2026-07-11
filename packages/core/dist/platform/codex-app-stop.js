import process from "node:process";
export function buildManagedAppStopPlan(input) {
    if (input.platform === "windows") {
        return [
            {
                kind: "spawn",
                command: "taskkill",
                args: ["/PID", String(input.pid), "/T", "/F"],
            },
        ];
    }
    const steps = [];
    if (input.platform === "macos" && input.preferAppQuit) {
        const applicationName = input.applicationName?.trim() || "Codex";
        steps.push({
            kind: "spawn",
            command: "osascript",
            args: ["-e", `tell application ${JSON.stringify(applicationName)} to quit`],
            optional: true,
        });
        steps.push({
            kind: "spawn",
            command: "pkill",
            args: ["-x", applicationName],
            optional: true,
        });
    }
    steps.push({
        kind: "signal",
        pid: input.pid,
        signal: "SIGTERM",
    });
    return steps;
}
export async function executeManagedAppStopPlan(plan, executor = defaultManagedAppStopExecutor) {
    for (const step of plan) {
        try {
            if (step.kind === "spawn") {
                await executor.spawn(step.command, step.args);
            }
            else {
                await executor.signal(step.pid, step.signal);
            }
        }
        catch (error) {
            if (step.kind === "spawn" && isIgnorableWindowsTaskkillError(step, error)) {
                continue;
            }
            if (step.kind === "spawn" && step.optional) {
                continue;
            }
            throw error;
        }
    }
    return true;
}
function isIgnorableWindowsTaskkillError(step, error) {
    if (step.kind !== "spawn" || step.command.toLowerCase() !== "taskkill") {
        return false;
    }
    const stderr = typeof error === "object" &&
        error !== null &&
        "stderr" in error
        ? String(error.stderr ?? "")
        : "";
    return /not found|no running instance|process .* could not be found/i.test(stderr);
}
async function defaultManagedAppStopExecutorSpawn(command, args) {
    const { spawn } = await import("node:child_process");
    await new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: "ignore",
        });
        child.on("error", reject);
        child.on("exit", (code) => {
            if (code === 0 || code === null) {
                resolve();
                return;
            }
            reject(new Error(`${command} exited with code ${code}`));
        });
    });
}
const defaultManagedAppStopExecutor = {
    spawn: defaultManagedAppStopExecutorSpawn,
    async signal(pid, signal) {
        process.kill(pid, signal);
    },
};
//# sourceMappingURL=codex-app-stop.js.map