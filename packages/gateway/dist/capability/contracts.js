const SOURCE_PRIORITY = {
    legacy: 10,
    discovery: 20,
    preset: 30,
    provider: 40,
    probe: 50,
    observed: 60,
};
export function capabilityKey(context, capability) {
    return [
        context.providerId?.trim().toLowerCase() || "unknown-provider",
        normalizeEndpoint(context.endpoint),
        context.protocol.trim().toLowerCase() || "unknown-protocol",
        context.modelId.trim(),
        context.credentialId?.trim() || "*",
        capability,
    ].join("|");
}
export function normalizeEndpoint(value) {
    if (!value?.trim())
        return "*";
    try {
        const parsed = new URL(value);
        parsed.username = "";
        parsed.password = "";
        parsed.search = "";
        parsed.hash = "";
        return parsed.toString().replace(/\/$/, "").toLowerCase();
    }
    catch {
        return value.trim().replace(/\/$/, "").toLowerCase();
    }
}
export function normalizeCapabilityObservation(value, fallbackSource = "discovery", now = Date.now()) {
    if (value === true)
        return { status: "supported", source: fallbackSource, checkedAt: now };
    if (value === false)
        return { status: "unsupported", source: fallbackSource, checkedAt: now };
    if (typeof value === "string" && isCapabilityStatus(value)) {
        return { status: value, source: fallbackSource, checkedAt: now };
    }
    if (!isRecord(value) || !isCapabilityStatus(value.status))
        return undefined;
    const source = isCapabilitySource(value.source) ? value.source : fallbackSource;
    return {
        status: value.status,
        source,
        ...(typeof value.checkedAt === "number" ? { checkedAt: value.checkedAt } : { checkedAt: now }),
        ...(typeof value.expiresAt === "number" ? { expiresAt: value.expiresAt } : {}),
        ...(typeof value.evidence === "string" ? { evidence: value.evidence.slice(0, 500) } : {}),
    };
}
export function normalizeCapabilityProfile(value, fallbackSource = "discovery", now = Date.now()) {
    if (!isRecord(value))
        return {};
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
        const observation = normalizeCapabilityObservation(item, fallbackSource, now);
        return observation ? [[key, observation]] : [];
    }));
}
export function profileFromLegacyCapabilities(capabilities, source = "legacy") {
    if (!capabilities)
        return {};
    const result = {};
    const add = (id, value) => {
        if (value !== undefined)
            result[id] = { status: value ? "supported" : "unsupported", source };
    };
    add("output.reasoning", capabilities.reasoning);
    add("tools.function", capabilities.tools);
    add("input.image", capabilities.vision);
    add("output.streaming", capabilities.streaming);
    return result;
}
export function capabilityProfileFromModel(value, source = "discovery") {
    const result = profileFromLegacyCapabilities({
        reasoning: value.reasoning === true ? true : value.reasoning === false ? false : undefined,
        tools: value.tools === true ? true : value.tools === false ? false : undefined,
        vision: value.vision === true ? true : value.vision === false ? false : undefined,
        streaming: value.streaming === true ? true : value.streaming === false ? false : undefined,
    }, source);
    const explicit = value.capabilityProfile ?? value.capabilities;
    Object.assign(result, normalizeCapabilityProfile(explicit, source));
    const search = value.supports_search_tool ?? value.supportsSearchTool;
    if (typeof search === "boolean")
        result["tools.hosted.web_search"] = { status: search ? "supported" : "unsupported", source };
    return result;
}
/** Conservative built-in rules for providers whose hosted-tool dialect is known. */
export function knownCapabilityProfile(context) {
    const provider = context.providerId?.trim().toLowerCase() ?? "";
    const endpoint = normalizeEndpoint(context.endpoint);
    const model = context.modelId.trim().toLowerCase();
    const result = {};
    if (endpoint.includes("dashscope.aliyuncs.com") && /kimi|moonshot|k[23]/i.test(model) && context.protocol === "chat_completions") {
        result["tools.hosted.web_search"] = { status: "unsupported", source: "preset", evidence: "DashScope compatible-mode Kimi Chat Completions does not accept OpenAI hosted web_search" };
    }
    if ((provider === "openai" || provider === "chatgpt" || provider === "codex") && endpoint.includes("api.openai.com") && context.protocol === "responses") {
        result["tools.hosted.web_search"] = { status: "supported", source: "preset" };
    }
    if (/(moonshot\.cn|moonshot\.ai|kimi\.com)/.test(endpoint) && context.protocol === "chat_completions") {
        result["tools.strict_pairing"] = { status: "supported", source: "preset", evidence: "Kimi validates assistant/tool adjacency and call order strictly" };
        result["tools.requires_name"] = { status: "supported", source: "preset", evidence: "Kimi resolves tool results using preceding call metadata" };
        result["schema.ref_siblings"] = { status: "supported", source: "preset", evidence: "Gateway applies the Moonshot allOf compatibility rewrite" };
    }
    return result;
}
export function mergeCapabilityProfiles(...profiles) {
    const result = {};
    for (const profile of profiles) {
        for (const [id, observation] of Object.entries(profile ?? {})) {
            const previous = result[id];
            if (!previous || shouldReplace(previous, observation))
                result[id] = { ...observation };
        }
    }
    return result;
}
export function isCapabilityFresh(observation, now = Date.now()) {
    return Boolean(observation && (observation.expiresAt === undefined || observation.expiresAt > now));
}
export function classifyCapabilityMismatch(input) {
    const message = [input.message, errorText(input.body)].filter(Boolean).join(" ").toLowerCase();
    const status = input.status;
    if (!message || (status !== undefined && status < 400))
        return undefined;
    const requested = input.requestedCapabilities ?? [];
    const evidence = (input.message || errorText(input.body) || "Upstream rejected capability").slice(0, 500);
    const hostedRequested = requested.filter((capability) => capability.startsWith("tools.hosted."));
    const explicit = [
        ["tools.hosted.web_search", [/web[_ -]?search|search_options|hosted.*search|\$web_search|search tool/]],
        ["tools.hosted.code_interpreter", [/code[_ -]?interpreter|python tool|container tool/]],
        ["tools.hosted.computer_use", [/computer[_ -]?use|computer tool|mouse|keyboard/]],
        ["tools.parallel", [/parallel.*tool|multiple tool|too many tool calls/]],
        ["tools.function", [/function.*tool|tool.*function|tool_calls|invalid tool/]],
        ["tools.strict_pairing", [/tool_call_id.*not found|preceding.*tool|tool message.*follow|unresolvable tool/]],
        ["schema.ref_siblings", [/\$ref.*sibling|moonshot.*schema|json schema.*ref/]],
    ];
    for (const [capability, patterns] of explicit) {
        if (requested.includes(capability) && patterns.some((pattern) => pattern.test(message))) {
            return { capability, status: "unsupported", source: "observed", statusCode: status, evidence };
        }
    }
    if (requested.includes("tools.function") && /tool_call_id.*not found|preceding.*tool|tool message.*follow|unresolvable tool/.test(message)) {
        return { capability: "tools.strict_pairing", status: "unsupported", source: "observed", statusCode: status, evidence };
    }
    // Generic schema errors are only useful when the request contains one
    // Hosted Tool. With several hosted tools present, guessing would poison the
    // cache and cause the wrong tool to be removed on future requests.
    if (hostedRequested.length === 1 && /function.*required|expected.*object|invalid.*tool|tool.*schema/.test(message)) {
        return { capability: hostedRequested[0], status: "unsupported", source: "observed", statusCode: status, evidence };
    }
    return undefined;
}
function shouldReplace(previous, next) {
    const previousTime = previous.checkedAt ?? 0;
    const nextTime = next.checkedAt ?? 0;
    if (nextTime !== previousTime)
        return nextTime > previousTime;
    return SOURCE_PRIORITY[next.source] >= SOURCE_PRIORITY[previous.source];
}
function errorText(value) {
    if (typeof value === "string")
        return value;
    if (!isRecord(value))
        return "";
    const error = isRecord(value.error) ? value.error : value;
    return [error.message, error.code, error.type, error.detail].filter((item) => typeof item === "string").join(" ");
}
function isCapabilityStatus(value) {
    return value === "supported" || value === "unsupported" || value === "unknown" || value === "degraded";
}
function isCapabilitySource(value) {
    return value === "provider" || value === "preset" || value === "discovery" || value === "probe" || value === "observed" || value === "legacy";
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=contracts.js.map