export function decodeReasoning(protocol, body) {
    const raw = protocol === "anthropic"
        ? body.thinking
        : protocol === "gemini"
            ? (isObject(body.generationConfig) ? body.generationConfig.thinkingConfig : isObject(body.generation_config) ? body.generation_config.thinking_config : undefined)
            : body.reasoning;
    const chatEffort = protocol === "chat_completions" ? asString(body.reasoning_effort) : undefined;
    const anthropicEffort = protocol === "anthropic" && isObject(body.output_config) ? asString(body.output_config.effort) : undefined;
    if (!isObject(raw) && !chatEffort && !anthropicEffort)
        return undefined;
    const source = isObject(raw) ? raw : {};
    const effort = chatEffort ?? anthropicEffort ?? asString(source.effort);
    const budgetTokens = asNumber(source.budget_tokens) ?? asNumber(source.budgetTokens) ?? asNumber(source.thinkingBudget) ?? asNumber(source.thinking_budget);
    const mode = source.type === "adaptive" || source.mode === "adaptive" ? "adaptive" : source.type === "disabled" || source.mode === "disabled" ? "disabled" : source.type === "enabled" || source.enabled === true || effort !== undefined || budgetTokens !== undefined ? "enabled" : undefined;
    const enabled = mode !== "disabled" && (mode === "enabled" || mode === "adaptive" || effort !== undefined || budgetTokens !== undefined);
    return {
        ...(enabled ? { enabled: true } : {}),
        ...(mode ? { mode } : {}),
        ...(isReasoningEffort(effort) ? { effort } : {}),
        ...(budgetTokens !== undefined && budgetTokens > 0 ? { budgetTokens: Math.floor(budgetTokens) } : {}),
        ...(source.return_thinking === true || source.returnThinking === true || source.includeThoughts === true || source.include_thoughts === true ? { returnThinking: true } : {}),
        ...(isReasoningSummary(source.summary) ? { summary: source.summary } : {}),
        ...(isObject(raw) ? { raw } : {}),
    };
}
export function encodeReasoning(protocol, state) {
    if (!state || state.enabled === false || state.mode === "disabled")
        return undefined;
    if (protocol === "anthropic") {
        if (state.mode === "adaptive")
            return { type: "adaptive" };
        return {
            type: "enabled",
            budget_tokens: state.budgetTokens ?? 1024,
        };
    }
    if (protocol === "gemini") {
        return {
            thinkingConfig: {
                ...(state.budgetTokens !== undefined ? { thinkingBudget: state.budgetTokens } : {}),
                ...(state.returnThinking !== undefined ? { includeThoughts: state.returnThinking } : {}),
            },
        };
    }
    return {
        ...(state.effort ? { effort: state.effort } : {}),
        ...(state.budgetTokens !== undefined ? { budget_tokens: state.budgetTokens } : {}),
        ...(state.returnThinking !== undefined ? { return_thinking: state.returnThinking } : {}),
        ...(state.summary ? { summary: state.summary } : {}),
    };
}
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asString(value) { return typeof value === "string" ? value : undefined; }
function asNumber(value) { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function isReasoningEffort(value) {
    return value === "low" || value === "medium" || value === "high" || value === "xhigh";
}
function isReasoningSummary(value) {
    return value === "auto" || value === "concise" || value === "detailed";
}
//# sourceMappingURL=reasoning-converter.js.map