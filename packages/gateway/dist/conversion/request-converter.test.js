import assert from "node:assert/strict";
import test from "node:test";
import { ConversionLossError } from "./diagnostics.js";
import { convertGatewayRequest } from "./request-converter.js";
const requests = {
    responses: { model: "logical", instructions: "follow rules", input: [{ role: "user", content: [{ type: "input_text", text: "hello" }, { type: "input_image", image_url: "https://example.test/image.png" }] }], reasoning: { effort: "high" }, tools: [{ type: "function", function: { name: "search", description: "Search", parameters: { type: "object" } } }], stream: true },
    chat_completions: { model: "logical", messages: [{ role: "system", content: "follow rules" }, { role: "user", content: [{ type: "text", text: "hello" }, { type: "image_url", image_url: { url: "https://example.test/image.png" } }] }], reasoning: { effort: "high" }, tools: [{ type: "function", function: { name: "search", parameters: { type: "object" } } }], stream: true },
    anthropic: { model: "logical", system: "follow rules", messages: [{ role: "user", content: [{ type: "text", text: "hello" }, { type: "image", source: { type: "url", url: "https://example.test/image.png" } }] }], thinking: { type: "enabled", budget_tokens: 512 }, tools: [{ name: "search", input_schema: { type: "object" } }], stream: true },
    gemini: { model: "logical", systemInstruction: { parts: [{ text: "follow rules" }] }, contents: [{ role: "user", parts: [{ text: "hello" }, { inlineData: { mimeType: "image/png", data: "abc" } }] }], tools: [{ functionDeclarations: [{ name: "search", parameters: { type: "object" } }] }] },
};
test("request conversion covers the four-protocol matrix", async () => {
    for (const source of Object.keys(requests)) {
        for (const target of Object.keys(requests)) {
            const result = await convertGatewayRequest(source, target, requests[source], { upstreamModelName: "upstream" });
            assert.equal(result.value.model, "upstream", `${source}->${target}`);
            assert.ok(JSON.stringify(result.value).includes("hello"), `${source}->${target}`);
            assert.ok(JSON.stringify(result.value).includes("search"), `${source}->${target}`);
            assert.ok(result.steps.length >= 1, `${source}->${target}`);
        }
    }
});
test("request conversion reports media resolver and can enforce strict loss policy", async () => {
    const result = await convertGatewayRequest("responses", "anthropic", requests.responses, { upstreamModelName: "claude" });
    assert.equal(result.diagnostics.some((item) => item.code === "media_resolver_missing"), true);
    await assert.rejects(convertGatewayRequest("responses", "anthropic", requests.responses, { upstreamModelName: "claude" }, { toolLossPolicy: "strict" }), (error) => error instanceof ConversionLossError);
});
test("request conversion preserves tool calls, tool results and developer instructions", async () => {
    const responses = {
        model: "logical",
        instructions: "developer policy",
        input: [
            { role: "assistant", content: [{ type: "function_call", call_id: "call-1", name: "search", arguments: "{\"q\":\"hello\"}" }] },
            { type: "function_call_output", call_id: "call-1", output: "result" },
        ],
        tools: [
            { type: "custom", name: "custom_tool", description: "custom" },
            { type: "web_search_preview" },
        ],
    };
    const chat = await convertGatewayRequest("responses", "chat_completions", responses, { upstreamModelName: "chat-model" });
    assert.deepEqual(chat.value.messages, [
        { role: "system", content: "developer policy" },
        { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "search", arguments: "{\"q\":\"hello\"}" } }] },
        { role: "tool", content: "result", tool_call_id: "call-1" },
    ]);
    assert.equal(chat.diagnostics.some((item) => item.code === "custom_tool_downgrade"), true);
    assert.equal(chat.diagnostics.some((item) => item.code === "web_search_tool_downgrade"), true);
    const anthropic = await convertGatewayRequest("chat_completions", "anthropic", {
        model: "logical", messages: [{ role: "developer", content: "developer policy" }, { role: "user", content: "hello" }],
    }, { upstreamModelName: "claude" });
    assert.equal(anthropic.value.system, "developer policy");
    assert.deepEqual(anthropic.value.messages, [{ role: "user", content: "hello" }]);
});
//# sourceMappingURL=request-converter.test.js.map