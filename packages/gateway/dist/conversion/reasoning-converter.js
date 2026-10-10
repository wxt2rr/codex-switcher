export function decodeReasoning(protocol, body) {
    const raw = protocol === "anthropic" ? body.thinking : body.reasoning;
    if (!isObject(raw))
        return undefined;
    const effort = asString(raw.effort);
    const budgetTokens = asNumber(raw.budget_tokens) ?? asNumber(raw.budgetTokens);
    const enabled = raw.type === "enabled" || raw.enabled === true || effort !== undefined || budgetTokens !== undefined;
    return {
        ...(enabled ? { enabled: true } : {}),
        ...(isReasoningEffort(effort) ? { effort } : {}),
        ...(budgetTokens !== undefined && budgetTokens > 0 ? { budgetTokens: Math.floor(budgetTokens) } : {}),
        ...(raw.return_thinking === true || raw.returnThinking === true ? { returnThinking: true } : {}),
    };
}
export function encodeReasoning(protocol, state) {
    if (!state || state.enabled === false)
        return undefined;
    if (protocol === "anthropic") {
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
//# sourceMappingURL=reasoning-converter.js.map