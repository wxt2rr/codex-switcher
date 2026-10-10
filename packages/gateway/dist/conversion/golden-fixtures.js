export const GOLDEN_PROTOCOLS = ["responses", "chat_completions", "anthropic", "gemini"];
export const GOLDEN_REQUESTS = {
    responses: {
        model: "logical-model",
        instructions: "Use the tool when needed",
        input: [{ role: "user", content: [{ type: "input_text", text: "hello" }, { type: "input_image", image_url: "https://example.test/image.png" }] }],
        tools: [{ type: "function", name: "search", description: "Search", parameters: { type: "object", properties: { q: { type: "string" } } } }],
        reasoning: { effort: "medium" },
        stream: true,
    },
    chat_completions: {
        model: "logical-model",
        messages: [{ role: "system", content: "Use the tool when needed" }, { role: "user", content: [{ type: "text", text: "hello" }, { type: "image_url", image_url: { url: "https://example.test/image.png" } }] }],
        tools: [{ type: "function", function: { name: "search", description: "Search", parameters: { type: "object", properties: { q: { type: "string" } } } } }],
        reasoning: { effort: "medium" },
        stream: true,
    },
    anthropic: {
        model: "logical-model",
        system: "Use the tool when needed",
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }, { type: "image", source: { type: "url", url: "https://example.test/image.png" } }] }],
        tools: [{ name: "search", description: "Search", input_schema: { type: "object", properties: { q: { type: "string" } } } }],
        thinking: { type: "enabled", budget_tokens: 512 },
        stream: true,
    },
    gemini: {
        model: "logical-model",
        systemInstruction: { parts: [{ text: "Use the tool when needed" }] },
        contents: [{ role: "user", parts: [{ text: "hello" }, { inlineData: { mimeType: "image/png", data: "aGVsbG8=" } }] }],
        tools: [{ functionDeclarations: [{ name: "search", description: "Search", parameters: { type: "object", properties: { q: { type: "string" } } } }] }],
        generationConfig: { thinkingConfig: { thinkingBudget: 512, includeThoughts: true } },
    },
};
export const GOLDEN_RESPONSES = {
    responses: {
        id: "response-1",
        output: [
            { type: "message", content: [{ type: "output_text", text: "hello" }] },
            { type: "reasoning", summary: [{ type: "summary_text", text: "think" }] },
            { type: "function_call", call_id: "call-1", name: "search", arguments: "{\"q\":\"hello\"}" },
        ],
        status: "completed",
        usage: { input_tokens: 4, output_tokens: 3, reasoning_tokens: 2, cached_tokens: 1, total_tokens: 7 },
    },
    chat_completions: {
        id: "chat-1",
        choices: [{ index: 0, message: { role: "assistant", content: "hello", reasoning_content: "think", tool_calls: [{ id: "call-1", type: "function", function: { name: "search", arguments: "{\"q\":\"hello\"}" } }] }, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 4, completion_tokens: 3, completion_tokens_details: { reasoning_tokens: 2 }, prompt_tokens_details: { cached_tokens: 1 }, total_tokens: 7 },
    },
    anthropic: {
        id: "anthropic-1",
        content: [{ type: "thinking", thinking: "think" }, { type: "text", text: "hello" }, { type: "tool_use", id: "call-1", name: "search", input: { q: "hello" } }],
        stop_reason: "tool_use",
        usage: { input_tokens: 4, output_tokens: 3, cache_read_input_tokens: 1 },
    },
    gemini: {
        responseId: "gemini-1",
        candidates: [{ content: { role: "model", parts: [{ text: "think", thought: true }, { text: "hello" }, { functionCall: { name: "search", args: { q: "hello" } } }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3, thoughtsTokenCount: 2, cachedContentTokenCount: 1, totalTokenCount: 7 },
    },
};
//# sourceMappingURL=golden-fixtures.js.map