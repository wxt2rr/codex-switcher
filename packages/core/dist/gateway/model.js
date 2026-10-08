export const GATEWAY_SCHEMA_VERSION = 1;
const EXCLUDED_GATEWAY_ROUTING_KEYS = new Set([
    "classifier",
    "classifiers",
    "intent",
    "intents",
    "intentrules",
    "intentrulesjson",
    "intentrouting",
    "intentroutingenabled",
    "promptrouting",
    "prompt",
    "prompts",
    "rules",
]);
/** Returns true when a Gateway document contains the permanently unsupported prompt/intent surface. */
export function containsExcludedGatewayRoutingFields(value) {
    if (Array.isArray(value))
        return value.some(containsExcludedGatewayRoutingFields);
    if (!isRecord(value))
        return false;
    return Object.entries(value).some(([key, child]) => {
        const normalized = key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
        return EXCLUDED_GATEWAY_ROUTING_KEYS.has(normalized) || containsExcludedGatewayRoutingFields(child);
    });
}
export function isGatewayEnvironmentState(value) {
    if (!isRecord(value))
        return false;
    if (containsExcludedGatewayRoutingFields(value))
        return false;
    if (value.schemaVersion !== GATEWAY_SCHEMA_VERSION)
        return false;
    if (value.mode !== "direct" && value.mode !== "gateway")
        return false;
    if (typeof value.gatewayId !== "string")
        return false;
    if (!isRecord(value.providers))
        return false;
    if (!isRecord(value.credentials))
        return false;
    if (!isRecord(value.models))
        return false;
    if (!isRecord(value.routeGroups))
        return false;
    if (Object.values(value.providers).some((provider) => !isRecord(provider)
        || provider.requestHeaders !== undefined && !isStringMap(provider.requestHeaders)
        || provider.proxyUrl !== undefined && !isGatewayProxyUrl(provider.proxyUrl)))
        return false;
    if (Object.values(value.credentials).some((credential) => !isRecord(credential)
        || credential.modelIds !== undefined && (!Array.isArray(credential.modelIds) || credential.modelIds.some((modelId) => typeof modelId !== "string"))
        || credential.requestHeaders !== undefined && !isStringMap(credential.requestHeaders)
        || credential.proxyUrl !== undefined && !isGatewayProxyUrl(credential.proxyUrl)))
        return false;
    if (value.routeRules !== undefined && (!Array.isArray(value.routeRules) || value.routeRules.some((rule) => !isGatewayRouteRule(rule))))
        return false;
    return (typeof value.catalogVersion === "number" &&
        Number.isInteger(value.catalogVersion) &&
        value.catalogVersion >= 0);
}
function isGatewayRouteRule(value) {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.targetModelId !== "string"
        || typeof value.priority !== "number" || typeof value.enabled !== "boolean" || !isRecord(value.match))
        return false;
    const match = value.match;
    if (match.tokenCount !== undefined && (!isRecord(match.tokenCount)
        || match.tokenCount.min !== undefined && typeof match.tokenCount.min !== "number"
        || match.tokenCount.max !== undefined && typeof match.tokenCount.max !== "number"))
        return false;
    for (const key of ["reasoningProfiles", "agentIds", "modelIds", "providerIds"]) {
        if (match[key] !== undefined && (!Array.isArray(match[key]) || match[key].some((item) => typeof item !== "string")))
            return false;
    }
    if (match.hasImages !== undefined && typeof match.hasImages !== "boolean")
        return false;
    if (match.reasoning !== undefined && typeof match.reasoning !== "boolean")
        return false;
    if (match.contextCompacted !== undefined && typeof match.contextCompacted !== "boolean")
        return false;
    if (match.time !== undefined && (!isRecord(match.time)
        || typeof match.time.startHour !== "number" || typeof match.time.endHour !== "number"
        || match.time.daysOfWeek !== undefined && (!Array.isArray(match.time.daysOfWeek) || match.time.daysOfWeek.some((day) => typeof day !== "number"))
        || match.time.timezone !== undefined && match.time.timezone !== "local" && match.time.timezone !== "utc"))
        return false;
    return true;
}
function isStringMap(value) {
    const blocked = new Set(["authorization", "cookie", "set-cookie", "proxy-authorization"]);
    return isRecord(value) && Object.entries(value).every(([key, child]) => Boolean(key.trim())
        && !blocked.has(key.trim().toLowerCase())
        && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)
        && typeof child === "string");
}
export function isGatewayProxyUrl(value) {
    if (typeof value !== "string" || !value.trim())
        return false;
    try {
        const parsed = new URL(value.trim());
        return (["http:", "https:", "socks5:"].includes(parsed.protocol))
            && !parsed.username && !parsed.password && Boolean(parsed.hostname)
            && (!parsed.port || Number(parsed.port) > 0 && Number(parsed.port) <= 65535);
    }
    catch {
        return false;
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=model.js.map