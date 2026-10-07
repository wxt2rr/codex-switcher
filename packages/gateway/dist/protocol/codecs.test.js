import assert from "node:assert/strict";
import test from "node:test";
import { createGatewayRequestContext } from "../request/request-ir.js";
import { decodeGatewayRequest, encodeGatewayRequest, decodeGatewayResponse, encodeGatewayResponse } from "./codecs.js";
const context = createGatewayRequestContext({ requestId: "r1", environmentId: "env", agentId: "codex", protocol: "responses", logicalModelId: "logical" });
test("all four protocols decode into the same logical request", () => {
    const requests = [
        { protocol: "responses", body: { model: "m", input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }], tools: [{ type: "function", function: { name: "search", parameters: {} } }] } },
        { protocol: "chat_completions", body: { model: "m", messages: [{ role: "user", content: "hello" }], tools: [{ type: "function", function: { name: "search", parameters: {} } }] } },
        { protocol: "anthropic", body: { model: "m", messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }], tools: [{ name: "search", input_schema: {} }] } },
        { protocol: "gemini", body: { model: "m", contents: [{ role: "user", parts: [{ text: "hello" }] }], tools: [{ functionDeclarations: [{ name: "search", parameters: {} }] }] } },
    ];
    for (const item of requests) {
        const request = decodeGatewayRequest(item.protocol, item.body, { ...context, protocol: item.protocol });
        assert.equal(request.messages[0]?.parts[0]?.value, "hello");
        assert.equal(request.tools[0]?.name, "search");
    }
});
test("the IR encodes a tool, reasoning and system message for every protocol", () => {
    const request = decodeGatewayRequest("responses", { model: "m", input: [{ role: "system", content: "rules" }, { role: "user", content: "hello" }], reasoning: { effort: "high" }, tools: [{ type: "function", function: { name: "search", parameters: {} } }] }, context);
    for (const protocol of ["responses", "chat_completions", "anthropic", "gemini"]) {
        const body = encodeGatewayRequest(protocol, request, "upstream");
        assert.equal(body.model, "upstream");
        assert.ok(JSON.stringify(body).includes("search"));
        assert.ok(JSON.stringify(body).includes("rules"));
    }
});
test("response events round-trip across non-streaming protocol envelopes", () => {
    const body = { id: "resp-1", output: [{ type: "message", content: [{ type: "output_text", text: "hello" }] }], usage: { input_tokens: 2, output_tokens: 3 } };
    const events = decodeGatewayResponse("responses", body);
    assert.equal(events.some((event) => event.type === "text_delta" && event.text === "hello"), true);
    for (const protocol of ["responses", "chat_completions", "anthropic", "gemini"]) {
        assert.ok(encodeGatewayResponse(protocol, events));
    }
});
test("the full protocol matrix preserves images, reasoning, tools, tool calls, usage and cache counters", () => {
    const requests = {
        responses: {
            model: "logical",
            instructions: "follow the rules",
            input: [{ role: "user", content: [{ type: "input_text", text: "hello" }, { type: "input_image", image_url: "https://example.test/image.png" }] }],
            reasoning: { effort: "high" },
            tools: [{ type: "function", function: { name: "search", description: "Search", parameters: { type: "object" } } }],
            stream: true,
        },
        chat_completions: {
            model: "logical",
            messages: [{ role: "system", content: "follow the rules" }, { role: "user", content: [{ type: "text", text: "hello" }, { type: "image_url", image_url: { url: "https://example.test/image.png" } }] }],
            reasoning: { effort: "high" },
            tools: [{ type: "function", function: { name: "search", description: "Search", parameters: { type: "object" } } }],
            stream: true,
        },
        anthropic: {
            model: "logical",
            system: "follow the rules",
            messages: [{ role: "user", content: [{ type: "text", text: "hello" }, { type: "image", source: { type: "url", url: "https://example.test/image.png" } }] }],
            thinking: { type: "enabled", budget_tokens: 512 },
            tools: [{ name: "search", description: "Search", input_schema: { type: "object" } }],
            stream: true,
        },
        gemini: {
            model: "logical",
            systemInstruction: { parts: [{ text: "follow the rules" }] },
            contents: [{ role: "user", parts: [{ text: "hello" }, { inlineData: { mimeType: "image/png", data: "abc" } }] }],
            tools: [{ functionDeclarations: [{ name: "search", description: "Search", parameters: { type: "object" } }] }],
        },
    };
    for (const source of Object.keys(requests)) {
        const request = decodeGatewayRequest(source, requests[source], { ...context, protocol: source });
        assert.equal(request.messages.some((message) => message.role === "system"), true, source);
        assert.equal(request.messages.flatMap((message) => message.parts).some((part) => part.type === "image"), true, source);
        assert.equal(request.tools[0]?.name, "search", source);
        for (const target of Object.keys(requests)) {
            const encoded = encodeGatewayRequest(target, request, "upstream");
            assert.equal(encoded.model, "upstream", source + "->" + target);
            assert.ok(JSON.stringify(encoded).includes("search"), source + "->" + target);
            assert.ok(JSON.stringify(encoded).includes("hello"), source + "->" + target);
        }
    }
    const responseBodies = {
        responses: { id: "r", output: [{ type: "message", content: [{ type: "output_text", text: "hello" }] }, { type: "reasoning", content: [{ type: "reasoning_text", text: "think" }] }, { type: "function_call", call_id: "call-1", name: "search", arguments: "{\"q\":\"hello\"}" }], usage: { input_tokens: 4, output_tokens: 3, reasoning_tokens: 2, cached_tokens: 1 } },
        chat_completions: { id: "c", choices: [{ message: { role: "assistant", content: "hello", reasoning_content: "think", tool_calls: [{ id: "call-1", type: "function", function: { name: "search", arguments: "{\"q\":\"hello\"}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 4, completion_tokens: 3, completion_tokens_details: { reasoning_tokens: 2 }, prompt_tokens_details: { cached_tokens: 1 } } },
        anthropic: { id: "a", content: [{ type: "thinking", thinking: "think" }, { type: "text", text: "hello" }, { type: "tool_use", id: "call-1", name: "search", input: { q: "hello" } }], usage: { input_tokens: 4, output_tokens: 3, cache_read_input_tokens: 1 } },
        gemini: { candidates: [{ content: { parts: [{ text: "think", thought: true }, { text: "hello" }, { functionCall: { name: "search", args: { q: "hello" } } }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3, thoughtsTokenCount: 2 } },
    };
    for (const source of Object.keys(responseBodies)) {
        const events = decodeGatewayResponse(source, responseBodies[source]);
        assert.equal(events.some((event) => event.type === "tool_call_delta"), true, source);
        assert.equal(events.some((event) => event.type === "reasoning_delta"), true, source);
        assert.equal(events.some((event) => event.type === "usage"), true, source);
        for (const target of Object.keys(responseBodies)) {
            const encoded = encodeGatewayResponse(target, events);
            assert.ok(encoded, source + "->" + target);
            assert.ok(JSON.stringify(encoded).includes("hello"), source + "->" + target);
        }
    }
});
//# sourceMappingURL=codecs.test.js.map