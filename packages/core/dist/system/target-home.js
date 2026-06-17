import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
export async function applyTargetHomeState(options) {
    const pointer = options.state.targets[options.target];
    const env = options.state.envs[pointer.env];
    const account = env?.accounts[pointer.account];
    if (!env) {
        throw new Error(`Cannot apply target home state for ${options.target}`);
    }
    await mkdir(env.path, { recursive: true });
    if (!account) {
        await clearTargetHomeState(env.path);
        return;
    }
    if (account.authData) {
        await writeFile(join(env.path, "auth.json"), `${JSON.stringify(account.authData, null, 2)}\n`, "utf8");
    }
    else {
        await rm(join(env.path, "auth.json"), { force: true });
    }
    await writeManagedConfig(join(env.path, "config.toml"), account.runtime);
}
export async function clearTargetHomeState(homePath) {
    await rm(join(homePath, "auth.json"), { force: true });
    await clearManagedConfig(join(homePath, "config.toml"));
}
async function writeManagedConfig(configPath, runtime) {
    const existing = await readText(configPath);
    const cleaned = removeManagedConfigLines(existing);
    const managedLines = [`preferred_auth_method = "${runtime.preferredAuthMethod}"`];
    if (runtime.preferredAuthMethod === "apikey" &&
        runtime.openaiBaseUrlMode === "custom" &&
        runtime.openaiBaseUrl) {
        managedLines.push(`openai_base_url = "${runtime.openaiBaseUrl}"`);
    }
    const content = `${managedLines.join("\n")}${cleaned ? `\n${cleaned}` : ""}\n`;
    await writeFile(configPath, content, "utf8");
}
async function clearManagedConfig(configPath) {
    const existing = await readText(configPath);
    if (!existing) {
        return;
    }
    const cleaned = removeManagedConfigLines(existing);
    await writeFile(configPath, cleaned ? `${cleaned}\n` : "", "utf8");
}
function removeManagedConfigLines(content) {
    return content
        .split(/\r?\n/)
        .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
            return false;
        }
        return (!trimmed.startsWith("preferred_auth_method") &&
            !trimmed.startsWith("openai_base_url"));
    })
        .join("\n");
}
async function readText(path) {
    try {
        return await readFile(path, "utf8");
    }
    catch {
        return "";
    }
}
//# sourceMappingURL=target-home.js.map