import { homedir } from "node:os";
import { join } from "node:path";
import { detectPlatform } from "./os.js";
export function resolveHomeDir(env = process.env, platform = process.platform) {
    const normalized = detectPlatform(platform);
    let home = env.HOME;
    if (normalized === "windows") {
        home =
            env.USERPROFILE ||
                (env.HOMEDRIVE && env.HOMEPATH ? `${env.HOMEDRIVE}${env.HOMEPATH}` : undefined) ||
                env.HOME;
    }
    home ||= homedir();
    if (!home) {
        throw new Error("Unable to resolve user home directory");
    }
    return home;
}
export function resolveRuntimePaths(env = process.env, platform = process.platform) {
    const homeDir = resolveHomeDir(env, platform);
    return {
        homeDir,
        stateDir: env.CODEX_SWITCHER_STATE_DIR || join(homeDir, ".codex-switcher"),
        envsDir: env.CODEX_SWITCHER_ENVS_DIR || join(homeDir, ".codex-envs"),
        defaultHome: env.CODEX_SWITCHER_DEFAULT_HOME || join(homeDir, ".codex"),
    };
}
export function executableCandidates(baseName, platform = process.platform) {
    if (detectPlatform(platform) !== "windows") {
        return [baseName];
    }
    return [baseName, `${baseName}.exe`, `${baseName}.cmd`, `${baseName}.bat`];
}
export function shellInitFiles(env = process.env, platform = process.platform) {
    const homeDir = resolveHomeDir(env, platform);
    const normalized = detectPlatform(platform);
    if (normalized === "windows") {
        const documentsDir = env.USERPROFILE || homeDir;
        return [
            join(documentsDir, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"),
            join(documentsDir, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"),
        ];
    }
    return [join(homeDir, ".zshrc"), join(homeDir, ".bashrc")];
}
export function getPlatformRuntime(env = process.env, platform = process.platform) {
    return {
        platform: detectPlatform(platform),
        paths: resolveRuntimePaths(env, platform),
        codexCliCandidates: executableCandidates("codex", platform),
        npmCommand: detectPlatform(platform) === "windows" ? "npm.cmd" : "npm",
        shellInitFiles: shellInitFiles(env, platform),
    };
}
//# sourceMappingURL=runtime.js.map