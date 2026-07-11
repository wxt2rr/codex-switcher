import { spawn } from "node:child_process";
import process from "node:process";
import { resolveCodexAppPath } from "./command-discovery.js";
import { buildManagedAppStopPlan, executeManagedAppStopPlan, } from "./codex-app-stop.js";
import { listManagedAppInstances, resolveManagedAppStatePaths, setManagedAppInstance, stopManagedAppPid, writeManagedAppPid, } from "./codex-app-runtime.js";
import { detectPlatform } from "./os.js";
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
    const launchSpec = buildCodexAppLaunchSpec(resolved, mergedEnv);
    return runner(launchSpec.command, launchSpec.args, mergedEnv);
}
export function buildCodexAppLaunchSpec(appPath, env = process.env, platform = process.platform) {
    if (detectPlatform(platform) !== "windows") {
        return {
            command: appPath,
            args: [],
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
    const result = await launchCodexApp(input, runner);
    const paths = resolveManagedAppStatePaths(input.stateDir);
    if (result.pid !== null) {
        const instanceId = await nextManagedAppInstanceId(paths);
        await setManagedAppInstance(paths, {
            instanceId,
            pid: result.pid,
        });
    }
    else {
        await writeManagedAppPid(paths, null);
    }
    return result;
}
export async function stopManagedCodexApp(input, stopper = defaultManagedAppStopper) {
    return stopManagedAppPid(resolveManagedAppStatePaths(input.stateDir), stopper, input.applicationName);
}
export async function restartCurrentCodexApp(input, runner = defaultCodexAppRunner, stopper = defaultManagedAppStopper) {
    const applicationName = resolveMacOsApplicationName(input.env?.CODEX_SWITCHER_APP_BIN);
    await stopManagedCodexApp({ stateDir: input.stateDir, applicationName }, stopper);
    return launchNewCodexApp(input, runner);
}
async function defaultManagedAppStopper(pid, applicationName) {
    try {
        await executeManagedAppStopPlan(buildManagedAppStopPlan({
            platform: detectPlatform(process.env.CODEX_SWITCHER_TEST_PLATFORM ||
                process.platform),
            pid,
            preferAppQuit: true,
            applicationName,
        }));
        return true;
    }
    catch (error) {
        const code = typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof error.code === "string"
            ? error.code
            : "";
        if (code === "ESRCH") {
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
        const child = spawn(command, args, {
            env,
            detached: true,
            stdio: "ignore",
        });
        child.on("error", reject);
        child.on("spawn", () => {
            child.unref();
            resolve({
                pid: child.pid ?? null,
            });
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