import assert from "node:assert/strict";
import test from "node:test";
import { convertGatewayResponse, decodeResponseEvents, encodeResponseEvents } from "./response-converter.js";
const responseBodies = {
    responses: { id: "resp-1", output: [{ type: "message", content: [{ type: "output_text", text: "hello" }] }, { type: "reasoning", content: [{ type: "reasoning_text", text: "think" }] }, { type: "function_call", call_id: "call-1", name: "search", arguments: "{\"q\":\"hello\"}" }], usage: { input_tokens: 4, output_tokens: 3, reasoning_tokens: 2, cached_tokens: 1 } },
    chat_completions: { id: "chat-1", choices: [{ message: { role: "assistant", content: "hello", reasoning_content: "think", tool_calls: [{ id: "call-1", type: "function", function: { name: "search", arguments: "{\"q\":\"hello\"}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 4, completion_tokens: 3, completion_tokens_details: { reasoning_tokens: 2 }, prompt_tokens_details: { cached_tokens: 1 } } },
    anthropic: { id: "anthropic-1", content: [{ type: "thinking", thinking: "think" }, { type: "text", text: "hello" }, { type: "tool_use", id: "call-1", name: "search", input: { q: "hello" } }], stop_reason: "tool_use", usage: { input_tokens: 4, output_tokens: 3, cache_read_input_tokens: 1 } },
    gemini: { responseId: "gemini-1", candidates: [{ content: { parts: [{ text: "think", thought: true }, { text: "hello" }, { functionCall: { name: "search", args: { q: "hello" } } }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3, thoughtsTokenCount: 2 } },
};
test("response conversion normalizes all four source protocols", async () => {
    for (const source of Object.keys(responseBodies)) {
        const events = decodeResponseEvents(source, responseBodies[source]);
        assert.equal(events.some((event) => event.type === "text_delta" && event.text === "hello"), true, source);
        assert.equal(events.some((event) => event.type === "reasoning_delta"), true, source);
        assert.equal(events.some((event) => event.type === "tool_call_delta"), true, source);
        for (const target of Object.keys(responseBodies)) {
            const result = await convertGatewayResponse(source, target, responseBodies[source], { originModelName: "logical", upstreamModelName: "upstream" });
            assert.ok(JSON.stringify(result.value).includes("hello"), `${source}->${target}`);
            assert.ok(JSON.stringify(result.value).includes("search"), `${source}->${target}`);
        }
    }
});
test("response encoding accumulates tool argument deltas and usage", () => {
    const events = decodeResponseEvents("chat_completions", { id: "r", choices: [{ delta: { content: "hello", tool_calls: [{ id: "c", function: { name: "search", arguments: "{\"q\":" } }] }, finish_reason: null }], usage: { prompt_tokens: 2, completion_tokens: 3 } });
    const value = encodeResponseEvents("responses", events, { upstreamModelName: "upstream" });
    assert.equal(value.object, "response");
    assert.equal(JSON.stringify(value).includes("hello"), true);
    assert.equal(JSON.stringify(value).includes("search"), true);
});
//# sourceMappingURL=response-converter.test.js.map