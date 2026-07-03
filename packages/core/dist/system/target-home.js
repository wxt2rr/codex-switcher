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
    if (runtime.independentModelEnabled && runtime.preferredAuthMethod === "chatgpt") {
        const providerId = normalizeProviderId(runtime.independentModelProviderId);
        managedLines.push("");
        managedLines.push(`model_provider = ${quoteTomlString(providerId)}`);
        managedLines.push("");
        managedLines.push(`[model_providers.${providerId}]`);
        managedLines.push(`name = ${quoteTomlString(providerId)}`);
        managedLines.push('model = "gpt-5.4"');
        managedLines.push(`base_url = ${quoteTomlString(runtime.independentModelBaseUrl ?? "")}`);
        managedLines.push(`experimental_bearer_token = ${quoteTomlString(runtime.independentModelApiKey ?? "")}`);
        managedLines.push("requires_openai_auth = true");
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
    const lines = content.split(/\r?\n/);
    const kept = [];
    const managedProviderIds = new Set(lines
        .map((line) => line.trim().match(/^model_provider\s*=\s*"([^"]+)"$/)?.[1] ?? "")
        .filter(Boolean));
    let skipManagedProviderSection = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            if (!skipManagedProviderSection) {
                kept.push(line);
            }
            continue;
        }
        const providerHeaderMatch = trimmed.match(/^\[model_providers\.([A-Za-z0-9_-]+)\]$/);
        if (providerHeaderMatch) {
            if (managedProviderIds.has(providerHeaderMatch[1] ?? "")) {
                skipManagedProviderSection = true;
                continue;
            }
        }
        if (skipManagedProviderSection) {
            if (trimmed.startsWith("[")) {
                skipManagedProviderSection = false;
            }
            else {
                continue;
            }
        }
        if (trimmed.startsWith("preferred_auth_method") ||
            trimmed.startsWith("openai_base_url") ||
            trimmed.startsWith("model_provider = ")) {
            continue;
        }
        kept.push(line);
    }
    while (kept.length > 0 && kept[0]?.trim() === "") {
        kept.shift();
    }
    while (kept.length > 0 && kept[kept.length - 1]?.trim() === "") {
        kept.pop();
    }
    return kept.join("\n");
}
function quoteTomlString(value) {
    return JSON.stringify(value);
}
function normalizeProviderId(value) {
    const trimmed = (value ?? "").trim();
    return trimmed || "custom";
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