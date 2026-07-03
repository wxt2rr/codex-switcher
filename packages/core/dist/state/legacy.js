import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_SCHEMA_VERSION, } from "./store.js";
const DEFAULT_ENV_NAME = "default";
const DEFAULT_ACCOUNT_NAME = "default";
export async function readLegacyState(options) {
    const envNames = await listEnvNames(options.envsDir);
    if (!envNames.includes(DEFAULT_ENV_NAME)) {
        envNames.unshift(DEFAULT_ENV_NAME);
    }
    const envs = Object.fromEntries(await Promise.all(envNames.map(async (envName) => [
        envName,
        await readLegacyEnvState(envName, options),
    ])));
    return {
        schemaVersion: DEFAULT_SCHEMA_VERSION,
        generatedAt: options.now ?? new Date().toISOString(),
        targets: {
            cli: {
                env: await readPointer(options.stateDir, "cli", "env", DEFAULT_ENV_NAME),
                account: await readPointer(options.stateDir, "cli", "account", DEFAULT_ACCOUNT_NAME),
            },
            app: {
                env: await readPointer(options.stateDir, "app", "env", DEFAULT_ENV_NAME),
                account: await readPointer(options.stateDir, "app", "account", DEFAULT_ACCOUNT_NAME),
            },
        },
        envs,
        tasks: {
            recent: [],
        },
    };
}
export async function writeLegacyPointers(options) {
    await mkdir(options.stateDir, { recursive: true });
    await writeFile(join(options.stateDir, `current_${options.target}_env`), `${options.env}\n`, "utf8");
    await writeFile(join(options.stateDir, `current_${options.target}_account`), `${options.account}\n`, "utf8");
}
export async function writeLegacyRuntime(options) {
    const runtimeDir = join(options.stateDir, "env-accounts", options.envName, options.accountName);
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(join(runtimeDir, "runtime.json"), `${JSON.stringify({
        preferred_auth_method: options.runtime.preferredAuthMethod,
        openai_base_url_mode: options.runtime.openaiBaseUrlMode,
        openai_base_url: options.runtime.openaiBaseUrl ?? "",
        independent_model_enabled: options.runtime.independentModelEnabled ?? false,
        independent_model_provider_id: options.runtime.independentModelProviderId ?? "custom",
        independent_model_api_key: options.runtime.independentModelApiKey ?? "",
        independent_model_base_url: options.runtime.independentModelBaseUrl ?? "",
    }, null, 2)}\n`, "utf8");
}
export async function createLegacyEnv(options) {
    if (options.envName === DEFAULT_ENV_NAME) {
        return;
    }
    await mkdir(join(options.envsDir, options.envName, "home"), { recursive: true });
}
export async function updateLegacyEnv(options) {
    if (options.envName !== options.nextEnvName && options.envName === DEFAULT_ENV_NAME) {
        throw new Error("Cannot rename reserved default env");
    }
    if (options.envName !== options.nextEnvName && options.nextEnvName !== DEFAULT_ENV_NAME) {
        await renameIfExists(join(options.envsDir, options.envName), join(options.envsDir, options.nextEnvName));
        await renameIfExists(join(options.stateDir, "env-accounts", options.envName), join(options.stateDir, "env-accounts", options.nextEnvName));
        await renameIfExists(getEnvMetaPath(options.stateDir, options.envName), getEnvMetaPath(options.stateDir, options.nextEnvName));
    }
    await writeLegacyEnvMeta(options.stateDir, options.nextEnvName, {
        homePath: options.homePath,
    });
}
async function readLegacyEnvState(envName, options) {
    const accountRoot = join(options.stateDir, "env-accounts", envName);
    const accountNames = await listDirectoryNames(accountRoot);
    const names = envName === DEFAULT_ENV_NAME && !accountNames.includes(DEFAULT_ACCOUNT_NAME)
        ? [DEFAULT_ACCOUNT_NAME, ...accountNames]
        : accountNames;
    const accounts = Object.fromEntries(await Promise.all(names.map(async (accountName) => [
        accountName,
        await readLegacyAccountState(accountRoot, accountName),
    ])));
    return {
        name: envName,
        path: (await readLegacyEnvMeta(options.stateDir, envName)).homePath ||
            (envName === DEFAULT_ENV_NAME
                ? options.defaultHome
                : join(options.envsDir, envName, "home")),
        accounts,
    };
}
async function readLegacyAccountState(accountRoot, accountName) {
    const runtimePath = join(accountRoot, accountName, "runtime.json");
    const runtimeRecord = await readRuntimeRecord(runtimePath);
    const authData = await readAuthRecord(join(accountRoot, accountName, "auth.json"));
    const accountState = {
        name: accountName,
        authMode: runtimeRecord.preferred_auth_method === "apikey" ? "apikey" : "auth",
        runtime: {
            preferredAuthMethod: normalizePreferredAuthMethod(runtimeRecord.preferred_auth_method),
            openaiBaseUrlMode: normalizeOpenAIBaseUrlMode(runtimeRecord.openai_base_url_mode),
            openaiBaseUrl: runtimeRecord.openai_base_url || undefined,
            independentModelEnabled: runtimeRecord.independent_model_enabled === true,
            independentModelProviderId: runtimeRecord.independent_model_provider_id || "custom",
            independentModelApiKey: runtimeRecord.independent_model_api_key || undefined,
            independentModelBaseUrl: runtimeRecord.independent_model_base_url || undefined,
        },
    };
    if (authData) {
        accountState.authData = authData;
    }
    return accountState;
}
async function readRuntimeRecord(path) {
    try {
        const raw = await readFile(path, "utf8");
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
async function readAuthRecord(path) {
    try {
        const raw = await readFile(path, "utf8");
        const parsed = JSON.parse(raw);
        const stringEntries = Object.entries(parsed).flatMap(([key, value]) => {
            if (typeof value === "string") {
                return [[key, value]];
            }
            if (value && typeof value === "object") {
                return [[key, JSON.stringify(value)]];
            }
            return [];
        });
        return stringEntries.length > 0 ? Object.fromEntries(stringEntries) : undefined;
    }
    catch {
        return undefined;
    }
}
async function readPointer(stateDir, target, kind, fallback) {
    const path = join(stateDir, `current_${target}_${kind}`);
    try {
        return (await readFile(path, "utf8")).trim() || fallback;
    }
    catch {
        return fallback;
    }
}
async function listEnvNames(envsDir) {
    return listDirectoryNames(envsDir);
}
async function listDirectoryNames(path) {
    try {
        const entries = await readdir(path, { withFileTypes: true });
        return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    }
    catch {
        return [];
    }
}
async function readLegacyEnvMeta(stateDir, envName) {
    try {
        const raw = await readFile(getEnvMetaPath(stateDir, envName), "utf8");
        const parsed = JSON.parse(raw);
        return typeof parsed.homePath === "string" && parsed.homePath
            ? { homePath: parsed.homePath }
            : {};
    }
    catch {
        return {};
    }
}
async function writeLegacyEnvMeta(stateDir, envName, value) {
    const metaPath = getEnvMetaPath(stateDir, envName);
    await mkdir(join(stateDir, "env-meta"), { recursive: true });
    await writeFile(`${metaPath}`, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function getEnvMetaPath(stateDir, envName) {
    return join(stateDir, "env-meta", `${envName}.json`);
}
async function renameIfExists(source, target) {
    try {
        await stat(source);
    }
    catch {
        return;
    }
    await mkdir(dirname(target), { recursive: true });
    await rename(source, target);
}
function normalizePreferredAuthMethod(value) {
    return value === "apikey" ? "apikey" : "chatgpt";
}
function normalizeOpenAIBaseUrlMode(value) {
    return value === "custom" ? "custom" : "default";
}
//# sourceMappingURL=legacy.js.map