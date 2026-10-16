/** Removes only hosted tools that the selected route cannot safely encode. */
export function filterUnsupportedHostedTools(body, profile, policy = "allow") {
    if (policy === "allow" || !Array.isArray(body.tools))
        return { body, omitted: [] };
    const omitted = [];
    const tools = body.tools.filter((raw) => {
        if (!isRecord(raw))
            return true;
        const type = typeof raw.type === "string" ? raw.type : "";
        const capability = hostedCapabilityForType(type);
        if (!capability)
            return true;
        const observation = profile?.[capability];
        if (observation?.status === "supported")
            return true;
        omitted.push({ type, capability, reason: observation?.status === "unsupported" ? "unsupported" : "unknown" });
        return false;
    });
    if (!omitted.length)
        return { body, omitted };
    const next = { ...body };
    if (tools.length)
        next.tools = tools;
    else
        delete next.tools;
    const choice = next.tool_choice;
    const choiceType = typeof choice === "string" ? choice
        : isRecord(choice) && typeof choice.type === "string" ? choice.type
            : undefined;
    const choiceName = isRecord(choice)
        ? typeof choice.name === "string" ? choice.name : isRecord(choice.function) && typeof choice.function.name === "string" ? choice.function.name : undefined
        : undefined;
    if ((choiceType && omitted.some((item) => item.type === choiceType)) || (choiceName && omitted.some((item) => item.type === choiceName)))
        delete next.tool_choice;
    // A required choice cannot be satisfied after all hosted tools have been
    // removed. Leaving it in the payload makes otherwise valid degraded
    // requests fail again with an invalid tool_choice error.
    if (!tools.length && next.tool_choice !== undefined)
        delete next.tool_choice;
    return { body: next, omitted };
}
export function planCapability(input) {
    const status = input.observation?.status ?? "unknown";
    if (status === "supported")
        return { capability: input.capability, status, action: "native", reason: "Capability is supported by the selected route" };
    if (status === "unsupported") {
        if (input.fallback === "fallback" && input.fallbackAvailable)
            return { capability: input.capability, status, action: "fallback", reason: "Native capability is unavailable; fallback is configured" };
        if (input.fallback === "required")
            return { capability: input.capability, status, action: "error", reason: "The request requires an unsupported capability" };
        return { capability: input.capability, status, action: "omit", reason: "Native capability is unavailable; safe degradation removed it" };
    }
    if (input.fallback === "required")
        return { capability: input.capability, status, action: "probe", reason: "Capability is unknown and must be verified before sending" };
    if (input.fallback === "fallback" && input.fallbackAvailable)
        return { capability: input.capability, status, action: "fallback", reason: "Capability is unknown; configured fallback will handle it" };
    return { capability: input.capability, status, action: "omit", reason: "Capability is unknown; fail-safe mode avoids an incompatible tool shape" };
}
/** Maps a provider-native hosted tool type to the stable capability namespace. */
export function hostedCapabilityForType(type) {
    if (["web_search", "web_search_preview", "web_search_options"].includes(type))
        return "tools.hosted.web_search";
    if (["code_interpreter", "code_interpreter_preview", "python"].includes(type))
        return "tools.hosted.code_interpreter";
    if (["computer_use", "computer_use_preview"].includes(type))
        return "tools.hosted.computer_use";
    return undefined;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=planner.js.map