import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { delimiter, join } from "node:path";
import { detectPlatform } from "./os.js";
import { executableCandidates, getPlatformRuntime, resolveHomeDir } from "./runtime.js";
export async function resolveCommandPath(command, env = process.env, platform = process.platform) {
    const pathValue = env.PATH || "";
    const dirs = pathValue.split(delimiter).filter(Boolean);
    for (const dir of dirs) {
        for (const candidate of executableCandidates(command, platform)) {
            const fullPath = join(dir, candidate);
            if (await isExecutable(fullPath)) {
                return { source: "env", path: fullPath };
            }
        }
    }
    for (const candidate of codexCliCandidatePaths(env, platform)) {
        if (await isExecutable(candidate)) {
            return { source: "candidate", path: candidate };
        }
    }
    return null;
}
export async function resolveCodexAppPath(env = process.env, platform = process.platform) {
    if (env.CODEX_SWITCHER_APP_BIN) {
        return (await isExecutable(env.CODEX_SWITCHER_APP_BIN)) ? env.CODEX_SWITCHER_APP_BIN : null;
    }
    for (const candidate of codexAppCandidatePaths(env, platform)) {
        if (await isExecutable(candidate)) {
            return candidate;
        }
    }
    return null;
}
export async function resolveWindowsLauncherCommands(env = process.env, platform = process.platform) {
    const commands = ["wt", "powershell", "cmd"];
    return Promise.all(commands.map(async (command) => ({
        command: `${command}.exe`,
        resolved: await resolveCommandPath(command, env, platform),
    })));
}
export async function getWindowsReadinessSnapshot(env = process.env, platform = process.platform) {
    return {
        launchers: await resolveWindowsLauncherCommands(env, platform),
        cliCandidates: codexCliCandidatePaths(env, platform),
        appCandidates: codexAppCandidatePaths(env, platform),
        shellInitFiles: getPlatformRuntime(env, platform).shellInitFiles,
    };
}
export function codexCliCandidatePaths(env = process.env, platform = process.platform) {
    if (env.CODEX_SWITCHER_CODEX_BIN) {
        return [env.CODEX_SWITCHER_CODEX_BIN];
    }
    const runtime = getPlatformRuntime(env, platform);
    const homeDir = runtime.paths.homeDir;
    if (runtime.platform === "windows") {
        return [
            join(homeDir, "AppData", "Local", "Programs", "Codex", "codex.exe"),
            join(homeDir, "AppData", "Local", "Programs", "Codex", "resources", "codex.exe"),
        ];
    }
    return [
        "/Applications/Codex.app/Contents/Resources/codex",
        join(homeDir, "Applications", "Codex.app", "Contents", "Resources", "codex"),
    ];
}
export function codexAppCandidatePaths(env = process.env, platform = process.platform) {
    const homeDir = resolveHomeDir(env, platform);
    const normalized = detectPlatform(platform);
    if (normalized === "windows") {
        const localAppData = env.LOCALAPPDATA || join(homeDir, "AppData", "Local");
        return [
            join(localAppData, "Microsoft", "WindowsApps", "ChatGPT.exe"),
            join(localAppData, "Programs", "ChatGPT", "ChatGPT.exe"),
            join(homeDir, "AppData", "Local", "Programs", "Codex", "Codex.exe"),
            join(homeDir, "AppData", "Local", "Programs", "Codex", "CodexApp.exe"),
        ];
    }
    return [
        join(homeDir, "Applications", "ChatGPT.app", "Contents", "MacOS", "ChatGPT"),
        join(homeDir, "Applications", "Codex.app", "Contents", "MacOS", "Codex"),
        "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
        "/Applications/Codex.app/Contents/MacOS/Codex",
    ];
}
async function isExecutable(path) {
    try {
        await access(path, fsConstants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=command-discovery.js.map