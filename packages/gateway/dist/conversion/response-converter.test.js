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
test("response conversion keeps ID-less Gemini and indexed Chat tool calls separate", async () => {
    const gemini = await convertGatewayResponse("gemini", "responses", {
        responseId: "gemini-tools",
        candidates: [{ content: { role: "model", parts: [
                        { functionCall: { name: "alpha", args: { value: 1 } } },
                        { functionCall: { name: "beta", args: { value: 2 } } },
                    ] }, finishReason: "STOP" }],
    });
    assert.deepEqual(gemini.value.output.filter((item) => item.type === "function_call").map((item) => item.call_id), ["name:alpha", "name:beta"]);
    const chat = await convertGatewayResponse("chat_completions", "responses", {
        id: "chat-tools",
        choices: [{ delta: { tool_calls: [
                        { index: 0, function: { name: "alpha", arguments: "{}" } },
                        { index: 1, function: { name: "beta", arguments: "{}" } },
                    ] }, finish_reason: "tool_calls" }],
    });
    assert.deepEqual(chat.value.output.filter((item) => item.type === "function_call").map((item) => item.call_id), ["index:0", "index:1"]);
});
test("response encoding accumulates tool argument deltas and usage", () => {
    const events = decodeResponseEvents("chat_completions", { id: "r", choices: [{ delta: { content: "hello", tool_calls: [{ id: "c", function: { name: "search", arguments: "{\"q\":\"hello\"}" } }] }, finish_reason: null }], usage: { prompt_tokens: 2, completion_tokens: 3 } });
    const value = encodeResponseEvents("responses", events, { upstreamModelName: "upstream" });
    assert.equal(value.object, "response");
    assert.equal(JSON.stringify(value).includes("hello"), true);
    assert.equal(JSON.stringify(value).includes("search"), true);
});
test("response conversion omits empty and malformed tool arguments", async () => {
    const result = await convertGatewayResponse("chat_completions", "responses", {
        id: "invalid-tools",
        choices: [{ message: { role: "assistant", tool_calls: [
                        { id: "empty", function: { name: "empty", arguments: "" } },
                        { id: "bad", function: { name: "bad", arguments: "{oops" } },
                        { id: "valid", function: { name: "valid", arguments: "{}" } },
                    ] }, finish_reason: "tool_calls" }],
    });
    const calls = result.value.output.filter((item) => item.type === "function_call");
    assert.deepEqual(calls.map((call) => call.call_id), ["valid"]);
    assert.equal(JSON.stringify(result.value).includes('arguments":""'), false);
});
test("response conversion reports an invalid tool turn instead of silently completing", async () => {
    const result = await convertGatewayResponse("chat_completions", "responses", {
        id: "invalid-only-tools",
        choices: [{ message: { role: "assistant", content: "我来看一下这个项目的结构和说明文件。", tool_calls: [
                        { id: "broken", function: { name: "read", arguments: "" } },
                    ] }, finish_reason: "tool_calls" }],
    });
    assert.deepEqual(result.value.error, {
        code: "upstream_invalid_tool_call",
        message: "Upstream finished with 'tool_calls' but returned no valid tool call arguments (1 invalid call)",
        type: "gateway_error",
    });
});
test("response conversion rejects malformed tools even when the provider reports stop", async () => {
    const result = await convertGatewayResponse("chat_completions", "responses", {
        id: "invalid-stop-tools",
        choices: [{ message: { role: "assistant", content: "先检查一下。", tool_calls: [
                        { id: "broken-stop", function: { name: "read", arguments: "{" } },
                    ] }, finish_reason: "stop" }],
    });
    assert.equal(result.value.error?.code, "upstream_invalid_tool_call");
});
test("response conversion accepts object tool arguments", async () => {
    const result = await convertGatewayResponse("chat_completions", "responses", {
        id: "object-tools",
        choices: [{ message: { role: "assistant", tool_calls: [
                        { id: "object-call", function: { name: "read", arguments: { path: "README.md" } } },
                    ] }, finish_reason: "tool_calls" }],
    });
    assert.deepEqual(result.value.output.find((item) => item.type === "function_call")?.arguments, '{"path":"README.md"}');
});
test("response conversion accepts top-level Chat tool-call fields", async () => {
    const result = await convertGatewayResponse("chat_completions", "responses", {
        id: "top-level-tools",
        choices: [{ message: { role: "assistant", tool_calls: [
                        { id: "top-level-call", name: "read", arguments: { path: "README.md" } },
                    ] }, finish_reason: "tool_calls" }],
    });
    const call = result.value.output.find((item) => item.type === "function_call");
    assert.equal(call?.name, "read");
    assert.equal(call?.arguments, '{"path":"README.md"}');
});
//# sourceMappingURL=response-converter.test.js.map