import { spawn } from "node:child_process";
import { resolveCommandPath } from "./command-discovery.js";
export async function launchCodexCli(input, runner = defaultCodexCliRunner) {
    const explicitBin = input.env?.CODEX_SWITCHER_CODEX_BIN;
    const resolved = explicitBin ? { path: explicitBin } : await resolveCommandPath("codex", input.env);
    if (!resolved?.path) {
        throw new Error("codex binary not found. install Codex CLI or set CODEX_SWITCHER_CODEX_BIN");
    }
    return runner(resolved.path, input.args ?? [], {
        ...process.env,
        ...input.env,
        CODEX_HOME: input.codexHome,
    });
}
async function defaultCodexCliRunner(command, args, env) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            env,
            stdio: "inherit",
        });
        child.on("error", reject);
        child.on("exit", (code) => {
            resolve({
                exitCode: code ?? 1,
            });
        });
    });
}
//# sourceMappingURL=codex-cli.js.map