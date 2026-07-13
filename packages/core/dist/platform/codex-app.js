import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { resolveCodexAppPath } from "./command-discovery.js";
import { buildManagedAppStopPlan, executeManagedAppStopPlan, waitForManagedAppExit, } from "./codex-app-stop.js";
import { listManagedAppInstances, resolveManagedAppStatePaths, setManagedAppInstance, stopManagedAppPid, writeManagedAppPid, } from "./codex-app-runtime.js";
import { detectPlatform } from "./os.js";
const managedAppActionQueues = new Map();
async function withManagedAppActionLock(stateDir, action) {
    const previous = managedAppActionQueues.get(stateDir) ?? Promise.resolve();
    let release = () => undefined;
    const gate = new Promise((resolve) => { release = resolve; });
    const queued = previous.then(() => gate);
    managedAppActionQueues.set(stateDir, queued);
    await previous;
    try {
        return await action();
    }
    finally {
        release();
        if (managedAppActionQueues.get(stateDir) === queued)
            managedAppActionQueues.delete(stateDir);
    }
}
export async function launchCodexApp(input, runner = defaultCodexAppRunner) {
    const explicitBin = input.env?.CODEX_SWITCHER_APP_BIN;
    const resolved = explicitBin || (await resolveCodexAppPath(input.env));
    if (!resolved) {
        throw new Error("Codex.app binary not found. set CODEX_SWITCHER_APP_BIN manually");
    }
    const mergedEnv = {
        ...process.env,
        ...input.env,
        CODEX_HOME: input.codexHome,
        CODEX_SWITCHER_MANAGED: "1",
    };
    const launchSpec = buildCodexAppLaunchSpec(resolved, mergedEnv, process.platform, input.userDataDir);
    return runner(launchSpec.command, launchSpec.args, mergedEnv);
}
export function buildCodexAppLaunchSpec(appPath, env = process.env, platform = process.platform, userDataDir) {
    if (detectPlatform(platform) !== "windows") {
        return {
            command: appPath,
            args: userDataDir ? [`--user-data-dir=${userDataDir}`] : [],
        };
    }
    const launcher = resolveWindowsAppLauncher(env);
    if (launcher === "wt" || launcher === "windows-terminal" || launcher === "wt.exe") {
        return {
            command: "wt.exe",
            args: ["-w", "new", appPath],
        };
    }
    if (launcher === "powershell" || launcher === "pwsh" || launcher === "powershell.exe") {
        return {
            command: "powershell.exe",
            args: [
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                `Start-Process -FilePath '${escapePowerShellSingleQuoted(appPath)}'`,
            ],
        };
    }
    return {
        command: "cmd.exe",
        args: [
            "/d",
            "/s",
            "/c",
            `start "" /b "${escapeCmdDoubleQuoted(appPath)}"`,
        ],
    };
}
export function resolveWindowsAppLauncher(env = process.env) {
    return (env.CODEX_SWITCHER_WINDOWS_APP_LAUNCHER || "cmd").toLowerCase();
}
export async function launchNewCodexApp(input, runner = defaultCodexAppRunner) {
    return withManagedAppActionLock(input.stateDir, () => launchNewCodexAppUnlocked(input, runner));
}
async function launchNewCodexAppUnlocked(input, runner) {
    const paths = resolveManagedAppStatePaths(input.stateDir);
    const instanceId = await nextManagedAppInstanceId(paths);
    const userDataDir = join(paths.appProfilesDir, instanceId);
    await mkdir(userDataDir, { recursive: true });
    let result;
    try {
        result = await launchCodexApp({ ...input, userDataDir }, runner);
    }
    catch (error) {
        await rm(userDataDir, { recursive: true, force: true });
        throw error;
    }
    if (result.pid !== null) {
        await setManagedAppInstance(paths, {
            instanceId,
            pid: result.pid,
            targetKey: input.targetKey,
        });
    }
    else {
        await writeManagedAppPid(paths, null);
    }
    return result;
}
export async function stopManagedCodexApp(input, stopper = defaultManagedAppStopper) {
    return withManagedAppActionLock(input.stateDir, () => stopManagedCodexAppUnlocked(input, stopper));
}
async function stopManagedCodexAppUnlocked(input, stopper) {
    return stopManagedAppPid(resolveManagedAppStatePaths(input.stateDir), stopper, input.applicationName, input.targetKey);
}
export async function restartCurrentCodexApp(input, runner = defaultCodexAppRunner, stopper = defaultManagedAppStopper) {
    return withManagedAppActionLock(input.stateDir, async () => {
        await stopManagedCodexAppUnlocked({ stateDir: input.stateDir, targetKey: input.targetKey }, stopper);
        return launchNewCodexAppUnlocked(input, runner);
    });
}
async function defaultManagedAppStopper(pid, applicationName) {
    try {
        const platform = detectPlatform(process.env.CODEX_SWITCHER_TEST_PLATFORM || process.platform);
        await executeManagedAppStopPlan(buildManagedAppStopPlan({
            platform,
            pid,
            preferAppQuit: Boolean(applicationName),
            applicationName,
        }));
        await waitForManagedAppExit({ platform, pid });
        return true;
    }
    catch (error) {
        const code = typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof error.code === "string"
            ? error.code
            : "";
        if (code === "ESRCH" || code === "EPERM") {
            return false;
        }
        throw error;
    }
}
function resolveMacOsApplicationName(appPath) {
    if (!appPath)
        return undefined;
    const match = /\/([^/]+)\.app(?:\/|$)/.exec(appPath);
    return match?.[1];
}
async function nextManagedAppInstanceId(paths) {
    const instances = await listManagedAppInstances(paths);
    let max = 0;
    for (const instance of instances) {
        const match = /^instance-(\d+)$/.exec(instance.instanceId);
        if (!match) {
            continue;
        }
        max = Math.max(max, Number(match[1]));
    }
    return `instance-${max + 1}`;
}
async function defaultCodexAppRunner(command, args, env) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const child = spawn(command, args, {
            env,
            detached: true,
            stdio: "ignore",
        });
        const rejectOnce = (error) => {
            if (settled)
                return;
            settled = true;
            reject(error);
        };
        child.on("error", rejectOnce);
        child.on("exit", (code, signal) => {
            rejectOnce(new Error(`Codex App exited before its window was ready (code ${code ?? "none"}, signal ${signal ?? "none"})`));
        });
        child.on("spawn", () => {
            child.unref();
            setTimeout(() => {
                if (settled)
                    return;
                settled = true;
                resolve({
                    pid: child.pid ?? null,
                });
            }, 1_000);
        });
    });
}
function escapeCmdDoubleQuoted(value) {
    return value.replace(/"/g, '""');
}
function escapePowerShellSingleQuoted(value) {
    return value.replace(/'/g, "''");
}
//# sourceMappingURL=codex-app.js.map