export const GATEWAY_SCHEMA_VERSION = 1;
/** Returns the upstream wire protocols declared by a Provider. */
export function gatewayProviderProtocols(provider) {
    return [
        provider.endpoints.responses ? "responses" : undefined,
        provider.endpoints.chatCompletions ? "chat_completions" : undefined,
        provider.endpoints.anthropicMessages ? "anthropic" : undefined,
        provider.endpoints.gemini ? "gemini" : undefined,
    ].filter((protocol) => protocol !== undefined);
}
export function gatewayProviderSupportsProtocol(provider, protocol) {
    return gatewayProviderProtocols(provider).includes(protocol);
}
export function gatewayCredentialSupportsProtocol(credential, protocol) {
    return credential.supportedProtocols.includes(protocol);
}
export function gatewayModelSupportsProtocol(model, protocol) {
    return model.protocols.includes(protocol);
}
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
/**
 * Validates compiled route members without rejecting otherwise readable legacy
 * documents. This is deliberately separate from the shape guard above so an
 * old document can still be migrated and then repaired with diagnostics.
 */
export function validateGatewayRouteCompatibility(gateway) {
    const issues = [];
    for (const [groupId, group] of Object.entries(gateway.routeGroups)) {
        for (const nestedGroupId of group.nestedGroupIds ?? []) {
            if (!gateway.routeGroups[nestedGroupId]) {
                issues.push({
                    code: "NESTED_GROUP_NOT_FOUND",
                    routeGroupId: groupId,
                    message: `Route group '${groupId}' references missing group '${nestedGroupId}'`,
                });
            }
        }
        for (const member of group.members) {
            const model = gateway.models[member.modelId];
            const provider = gateway.providers[member.providerId];
            if (!provider) {
                issues.push({
                    code: "PROVIDER_NOT_FOUND",
                    routeGroupId: groupId,
                    modelId: member.modelId,
                    providerId: member.providerId,
                    message: `Route group '${groupId}' references missing provider '${member.providerId}'`,
                });
                continue;
            }
            if (!model) {
                issues.push({
                    code: "MODEL_NOT_FOUND",
                    routeGroupId: groupId,
                    modelId: member.modelId,
                    providerId: member.providerId,
                    message: `Route group '${groupId}' references missing model '${member.modelId}'`,
                });
                continue;
            }
            if (model.providerId !== member.providerId) {
                issues.push({
                    code: "PROVIDER_MODEL_MISMATCH",
                    routeGroupId: groupId,
                    modelId: member.modelId,
                    providerId: member.providerId,
                    message: `Model '${member.modelId}' belongs to provider '${model.providerId}', not '${member.providerId}'`,
                });
                continue;
            }
            const credentialIds = member.credentialSelector.credentialIds ?? Object.values(gateway.credentials)
                .filter((credential) => credential.providerId === member.providerId)
                .map((credential) => credential.id);
            const compatibleCredentials = credentialIds.filter((credentialId) => {
                const credential = gateway.credentials[credentialId];
                if (!credential || credential.providerId !== member.providerId)
                    return false;
                return model.protocols.some((protocol) => (gatewayProviderSupportsProtocol(provider, protocol)
                    && gatewayCredentialSupportsProtocol(credential, protocol)));
            });
            if (!compatibleCredentials.length) {
                issues.push({
                    code: "NO_PROTOCOL_INTERSECTION",
                    routeGroupId: groupId,
                    modelId: member.modelId,
                    providerId: member.providerId,
                    credentialId: credentialIds[0],
                    message: `Model '${model.displayName}' has no shared protocol with provider '${provider.displayName}' and its selected credentials`,
                });
            }
        }
    }
    return issues;
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