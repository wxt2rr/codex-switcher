import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
export const DEFAULT_SCHEMA_VERSION = 1;
const STATE_FILE_NAME = "core-state.json";
export function createStateStore(options) {
    const stateFile = join(options.rootDir, STATE_FILE_NAME);
    return {
        paths: {
            rootDir: options.rootDir,
            stateFile,
        },
        async load() {
            let raw;
            try {
                raw = await readFile(stateFile, "utf8");
            }
            catch (error) {
                throw createStoreError("STATE_IO_ERROR", "Failed to read state file", error);
            }
            let parsed;
            try {
                parsed = JSON.parse(raw);
            }
            catch (error) {
                throw createStoreError("INVALID_STATE", "State file is not valid JSON", error);
            }
            return validateState(parsed);
        },
        async save(state) {
            const validated = validateState(state);
            await mkdir(dirname(stateFile), { recursive: true });
            const tempFile = `${stateFile}.tmp`;
            await writeFile(tempFile, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
            await rename(tempFile, stateFile);
        },
        async writeRaw(content) {
            await mkdir(dirname(stateFile), { recursive: true });
            await writeFile(stateFile, content, "utf8");
        },
    };
}
function validateState(value) {
    if (!isRecord(value)) {
        throw createStoreError("INVALID_STATE", "State root must be an object");
    }
    if (value.schemaVersion !== DEFAULT_SCHEMA_VERSION) {
        throw createStoreError("INVALID_STATE", "Unsupported state schema version");
    }
    if (typeof value.generatedAt !== "string") {
        throw createStoreError("INVALID_STATE", "State generatedAt must be a string");
    }
    const targets = validateTargets(value.targets);
    const envs = validateEnvs(value.envs);
    const tasks = validateTasks(value.tasks);
    return {
        schemaVersion: DEFAULT_SCHEMA_VERSION,
        generatedAt: value.generatedAt,
        targets,
        envs,
        tasks,
    };
}
function validateTargets(value) {
    if (!isRecord(value)) {
        throw createStoreError("INVALID_STATE", "State targets must be an object");
    }
    return {
        cli: validateTargetPointer(value.cli, "cli"),
        app: validateTargetPointer(value.app, "app"),
    };
}
function validateTargetPointer(value, name) {
    if (!isRecord(value) || typeof value.env !== "string" || typeof value.account !== "string") {
        throw createStoreError("INVALID_STATE", `State target '${name}' must include env/account strings`);
    }
    return { env: value.env, account: value.account };
}
function validateEnvs(value) {
    if (!isRecord(value)) {
        throw createStoreError("INVALID_STATE", "State envs must be an object");
    }
    return Object.fromEntries(Object.entries(value).map(([envName, envValue]) => [
        envName,
        validateEnvState(envName, envValue),
    ]));
}
function validateEnvState(name, value) {
    if (!isRecord(value)) {
        throw createStoreError("INVALID_STATE", `Env '${name}' must be an object`);
    }
    if (typeof value.name !== "string" || typeof value.path !== "string") {
        throw createStoreError("INVALID_STATE", `Env '${name}' must include string name/path fields`);
    }
    if (!isRecord(value.accounts)) {
        throw createStoreError("INVALID_STATE", `Env '${name}' accounts must be an object`);
    }
    return {
        name: value.name,
        path: value.path,
        accounts: Object.fromEntries(Object.entries(value.accounts).map(([accountName, accountValue]) => [
            accountName,
            validateAccountState(accountName, accountValue),
        ])),
    };
}
function validateAccountState(name, value) {
    if (!isRecord(value)) {
        throw createStoreError("INVALID_STATE", `Account '${name}' must be an object`);
    }
    if (typeof value.name !== "string") {
        throw createStoreError("INVALID_STATE", `Account '${name}' must include a string name`);
    }
    if (!isAuthMode(value.authMode)) {
        throw createStoreError("INVALID_STATE", `Account '${name}' has invalid authMode`);
    }
    const accountState = {
        name: value.name,
        authMode: value.authMode,
        runtime: validateRuntimeSettings(name, value.runtime),
    };
    if (isAuthDataRecord(value.authData)) {
        accountState.authData = value.authData;
    }
    return accountState;
}
function validateRuntimeSettings(accountName, value) {
    if (!isRecord(value)) {
        throw createStoreError("INVALID_STATE", `Account '${accountName}' runtime must be an object`);
    }
    if (!isPreferredAuthMethod(value.preferredAuthMethod)) {
        throw createStoreError("INVALID_STATE", `Account '${accountName}' runtime has invalid preferredAuthMethod`);
    }
    if (!isOpenAIBaseUrlMode(value.openaiBaseUrlMode)) {
        throw createStoreError("INVALID_STATE", `Account '${accountName}' runtime has invalid openaiBaseUrlMode`);
    }
    const runtime = {
        preferredAuthMethod: value.preferredAuthMethod,
        openaiBaseUrlMode: value.openaiBaseUrlMode,
        apiProtocol: isAccountApiProtocol(value.apiProtocol) ? value.apiProtocol : "responses",
        compatibilityRouteEnabled: value.compatibilityRouteEnabled === true,
        compatibilityReasoningProfile: isReasoningProfile(value.compatibilityReasoningProfile)
            ? value.compatibilityReasoningProfile
            : "auto",
        compatibilityLongConversationStrategy: value.compatibilityLongConversationStrategy === "continuity"
            ? "continuity"
            : "safe",
        compatibilityInstructionRole: value.compatibilityInstructionRole === "system" || value.compatibilityInstructionRole === "developer"
            ? value.compatibilityInstructionRole
            : "auto",
    };
    if (typeof value.openaiBaseUrl === "string") {
        runtime.openaiBaseUrl = value.openaiBaseUrl;
    }
    if (typeof value.providerId === "string") {
        runtime.providerId = value.providerId;
    }
    if (typeof value.model === "string") {
        runtime.model = value.model;
    }
    if (typeof value.independentModelEnabled === "boolean") {
        runtime.independentModelEnabled = value.independentModelEnabled;
    }
    if (typeof value.independentModelProviderId === "string") {
        runtime.independentModelProviderId = value.independentModelProviderId;
    }
    if (typeof value.independentModelApiKey === "string") {
        runtime.independentModelApiKey = value.independentModelApiKey;
    }
    if (typeof value.independentModelBaseUrl === "string") {
        runtime.independentModelBaseUrl = value.independentModelBaseUrl;
    }
    for (const key of [
        "compatibilityRouteBaseUrl",
        "compatibilityRouteToken",
        "compatibilityRouteProviderId",
        "compatibilityUpstreamModel",
    ]) {
        if (typeof value[key] === "string")
            runtime[key] = value[key];
    }
    if (isRecord(value.compatibilityRequestOverrides)) {
        runtime.compatibilityRequestOverrides = value.compatibilityRequestOverrides;
    }
    return runtime;
}
function isAccountApiProtocol(value) {
    return value === "responses" || value === "chat_completions";
}
function isReasoningProfile(value) {
    return value === "auto" || value === "standard" || value === "reasoning_content" || value === "think_tags";
}
function validateTasks(value) {
    if (!isRecord(value) || !Array.isArray(value.recent)) {
        throw createStoreError("INVALID_STATE", "State tasks.recent must be an array");
    }
    return {
        recent: value.recent.map(validateTaskSummary),
    };
}
function validateTaskSummary(value) {
    if (!isRecord(value)) {
        throw createStoreError("INVALID_STATE", "Task summary must be an object");
    }
    if (typeof value.id !== "string" ||
        typeof value.kind !== "string" ||
        typeof value.startedAt !== "string" ||
        !isTaskStatus(value.status)) {
        throw createStoreError("INVALID_STATE", "Task summary is missing required fields");
    }
    return {
        id: value.id,
        kind: value.kind,
        status: value.status,
        startedAt: value.startedAt,
        finishedAt: typeof value.finishedAt === "string" ? value.finishedAt : undefined,
        summary: typeof value.summary === "string" ? value.summary : undefined,
    };
}
function createStoreError(code, message, cause) {
    const error = new Error(message);
    error.code = code;
    error.cause = cause;
    return error;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isAuthMode(value) {
    return value === "auth" || value === "apikey" || value === "provider-profile";
}
function isPreferredAuthMethod(value) {
    return value === "chatgpt" || value === "apikey";
}
function isOpenAIBaseUrlMode(value) {
    return value === "default" || value === "custom";
}
function isTaskStatus(value) {
    return (value === "pending" ||
        value === "running" ||
        value === "succeeded" ||
        value === "failed");
}
function isAuthDataRecord(value) {
    return isRecord(value) && Object.values(value).every(isAuthDataValue);
}
function isAuthDataValue(value) {
    if (value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean") {
        return true;
    }
    if (Array.isArray(value)) {
        return true;
    }
    return isRecord(value);
}
//# sourceMappingURL=store.js.map