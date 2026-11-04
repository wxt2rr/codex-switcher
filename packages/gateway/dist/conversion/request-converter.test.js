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
test("request conversion preserves Chat image data URLs for a Responses upstream", async () => {
    const result = await convertGatewayRequest("chat_completions", "responses", {
        model: "logical",
        messages: [{ role: "user", content: [
                    { type: "text", text: "what is in this image?" },
                    { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } },
                ] }],
        stream: true,
    }, { upstreamModelName: "vision-model" });
    assert.deepEqual(result.value.input, [{ role: "user", content: [
                { type: "input_text", text: "what is in this image?" },
                { type: "input_image", image_url: "data:image/png;base64,QUJD" },
            ] }]);
});
test("request conversion accepts the compatible Chat image_url string shorthand", async () => {
    const result = await convertGatewayRequest("chat_completions", "responses", {
        model: "logical",
        messages: [{ role: "user", content: [{ type: "image_url", image_url: "data:image/png;base64,QUJD" }] }],
    }, { upstreamModelName: "vision-model" });
    assert.deepEqual(result.value.input, [{ role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,QUJD" }] }]);
});
test("request conversion emits the official Responses function-tool shape", async () => {
    const result = await convertGatewayRequest("chat_completions", "responses", {
        model: "logical",
        messages: [{ role: "user", content: "hello" }],
        tools: [{ type: "function", function: { name: "search", description: "Search", parameters: { type: "object" }, strict: true } }],
    }, { upstreamModelName: "gpt" });
    assert.deepEqual(result.value.tools, [{ type: "function", name: "search", description: "Search", parameters: { type: "object" }, strict: true }]);
    assert.equal(result.value.tools[0]?.function, undefined);
});
test("request conversion groups Responses namespace tools and maps tool choice per target", async () => {
    const result = await convertGatewayRequest("responses", "chat_completions", {
        model: "logical",
        input: "hello",
        tools: [{ type: "namespace", name: "crm", description: "CRM", tools: [{ type: "function", name: "lookup", parameters: { type: "object" } }] }],
        tool_choice: { type: "function", name: "lookup" },
        parallel_tool_calls: true,
    }, { upstreamModelName: "chat" });
    assert.deepEqual(result.value.tools, [{ type: "function", function: { name: "crm__lookup", parameters: { type: "object" } } }]);
    assert.deepEqual(result.value.tool_choice, { type: "function", function: { name: "crm__lookup" } });
    assert.deepEqual(result.metadata?.toolNameMap, { crm__lookup: "lookup" });
    assert.equal(result.value.parallel_tool_calls, true);
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
        { role: "tool", name: "search", content: "result", tool_call_id: "call-1" },
    ]);
    assert.equal(chat.diagnostics.some((item) => item.code === "custom_tool_downgrade"), true);
    assert.equal(chat.diagnostics.some((item) => item.code === "web_search_tool_downgrade"), true);
    const anthropic = await convertGatewayRequest("chat_completions", "anthropic", {
        model: "logical", messages: [{ role: "developer", content: "developer policy" }, { role: "user", content: "hello" }],
    }, { upstreamModelName: "claude" });
    assert.equal(anthropic.value.system, "developer policy");
    assert.deepEqual(anthropic.value.messages, [{ role: "user", content: "hello" }]);
});
test("request conversion repairs strict Chat tool history", async () => {
    const responses = {
        model: "logical",
        input: [
            { type: "function_call_output", call_id: "orphan", output: "stale" },
            { type: "function_call", call_id: "call-b", name: "b", arguments: "{}" },
            { type: "function_call", call_id: "call-a", name: "a", arguments: "{}" },
            { type: "function_call_output", call_id: "call-a", output: "A" },
            { type: "function_call_output", call_id: "call-a", output: "duplicate" },
        ],
    };
    const result = await convertGatewayRequest("responses", "chat_completions", responses, { upstreamModelName: "kimi-k3" });
    const messages = result.value.messages;
    assert.equal(messages[0]?.role, "user");
    assert.deepEqual((messages[1]?.tool_calls).map((call) => call.id), ["call-b", "call-a"]);
    assert.deepEqual(messages.slice(2).map((message) => message.tool_call_id), ["call-b", "call-a"]);
    assert.equal(result.diagnostics.some((item) => item.code === "tool_exchange_orphan_tool_result"), true);
    assert.equal(result.diagnostics.some((item) => item.code === "tool_exchange_duplicate_tool_result"), true);
    assert.equal(result.diagnostics.some((item) => item.code === "tool_exchange_synthetic_tool_result"), true);
});
test("request conversion normalizes developer messages for Chat Completions by default", async () => {
    const request = {
        model: "logical",
        input: [{ role: "developer", content: "developer policy" }, { role: "user", content: "hello" }],
    };
    const compatible = await convertGatewayRequest("responses", "chat_completions", request, { upstreamModelName: "chat-model" });
    assert.deepEqual(compatible.value.messages, [
        { role: "system", content: "developer policy" },
        { role: "user", content: "hello" },
    ]);
    const explicitDeveloper = await convertGatewayRequest("responses", "chat_completions", request, { upstreamModelName: "chat-model" }, { instructionRole: "developer" });
    assert.deepEqual(explicitDeveloper.value.messages, [
        { role: "developer", content: "developer policy" },
        { role: "user", content: "hello" },
    ]);
});
test("request conversion applies a route capability profile to hosted tools", async () => {
    const responses = {
        model: "logical",
        input: "search for the answer",
        tools: [{ type: "web_search_preview" }, { type: "function", function: { name: "echo", parameters: { type: "object" } } }],
    };
    const result = await convertGatewayRequest("responses", "chat_completions", responses, { upstreamModelName: "kimi-k3" }, {
        capabilityPolicy: "safe",
        capabilityProfile: {
            "tools.hosted.web_search": { status: "unsupported", source: "observed" },
            "tools.function": { status: "supported", source: "provider" },
        },
    });
    assert.deepEqual(result.value.tools, [{ type: "function", function: { name: "echo", parameters: { type: "object" } } }]);
    assert.equal(result.diagnostics.some((item) => item.code === "capability_tool_omitted"), true);
});
test("request conversion removes explicitly unsupported sampling parameters", async () => {
    const profile = {
        "params.temperature": { status: "unsupported", source: "observed" },
        "params.top_p": { status: "unsupported", source: "observed" },
    };
    const result = await convertGatewayRequest("responses", "chat_completions", {
        model: "logical",
        input: "hello",
        temperature: 0.2,
        top_p: 0.8,
    }, { upstreamModelName: "kimi" }, {
        capabilityProfile: profile,
        capabilityPolicy: "safe",
    });
    assert.equal(result.value.temperature, undefined);
    assert.equal(result.value.top_p, undefined);
});
test("request conversion preserves unknown sampling capabilities", async () => {
    const result = await convertGatewayRequest("responses", "chat_completions", {
        model: "logical",
        input: "hello",
        temperature: 0.2,
        top_p: 0.8,
    }, { upstreamModelName: "legacy" }, {
        capabilityProfile: {},
        capabilityPolicy: "safe",
    });
    assert.equal(result.value.temperature, 0.2);
    assert.equal(result.value.top_p, 0.8);
});
test("Gemini raw generationConfig cannot reintroduce unsupported sampling parameters", async () => {
    const result = await convertGatewayRequest("gemini", "gemini", {
        model: "gemini",
        contents: [{ role: "user", parts: [{ text: "hello" }] }],
        generationConfig: { temperature: 0.2, topP: 0.8, topK: 12, maxOutputTokens: 100 },
    }, { upstreamModelName: "gemini-upstream" }, {
        capabilityProfile: {
            "params.temperature": { status: "unsupported", source: "observed" },
            "params.top_p": { status: "unsupported", source: "observed" },
            "params.top_k": { status: "unsupported", source: "observed" },
        },
        capabilityPolicy: "safe",
    });
    assert.deepEqual(result.value.generationConfig, { maxOutputTokens: 100 });
});
test("request conversion preserves tool choice, parallel tools and provider token dialect", async () => {
    const result = await convertGatewayRequest("responses", "chat_completions", {
        model: "logical",
        max_output_tokens: 123,
        parallel_tool_calls: true,
        tool_choice: "required",
        input: "hello",
    }, { upstreamModelName: "k3", upstreamEndpoint: "https://api.kimi.com/coding" });
    assert.equal(result.value.max_tokens, 123);
    assert.equal(result.value.parallel_tool_calls, true);
    assert.equal(result.value.tool_choice, "required");
});
test("Anthropic output_config format is preserved through the canonical IR", async () => {
    const result = await convertGatewayRequest("anthropic", "anthropic", {
        model: "claude",
        messages: [{ role: "user", content: "return json" }],
        max_tokens: 128,
        output_config: { format: { type: "json_schema", schema: { type: "object", properties: { ok: { type: "boolean" } } } }, effort: "high" },
    }, { upstreamModelName: "claude" });
    assert.deepEqual(result.value.output_config, { format: { type: "json_schema", schema: { type: "object", properties: { ok: { type: "boolean" } } } }, effort: "high" });
});
test("Anthropic receives the caller token budget instead of the compatibility default", async () => {
    const result = await convertGatewayRequest("chat_completions", "anthropic", {
        model: "logical",
        messages: [{ role: "user", content: "hello" }],
        max_completion_tokens: 777,
    }, { upstreamModelName: "claude" });
    assert.equal(result.value.max_tokens, 777);
});
test("request conversion preserves shared controls and maps structured output", async () => {
    const chat = await convertGatewayRequest("chat_completions", "responses", {
        model: "logical",
        messages: [{ role: "user", content: "hello" }],
        max_completion_tokens: 321,
        temperature: 0.2,
        top_p: 0.8,
        stop: ["END"],
        service_tier: "priority",
        prompt_cache_key: "session-1",
        response_format: { type: "json_object" },
        stream_options: { include_usage: true },
    }, { upstreamModelName: "gpt" });
    assert.equal(chat.value.max_output_tokens, 321);
    assert.equal(chat.value.temperature, 0.2);
    assert.equal(chat.value.top_p, 0.8);
    assert.deepEqual(chat.value.stop, ["END"]);
    assert.equal(chat.value.service_tier, "priority");
    assert.equal(chat.value.prompt_cache_key, "session-1");
    assert.deepEqual(chat.value.text, { format: { type: "json_object" } });
    assert.deepEqual(chat.value.stream_options, { include_usage: true });
});
test("Responses history chaining is only emitted to a Responses target", async () => {
    const request = {
        model: "logical",
        previous_response_id: "resp-1",
        input: "hello",
    };
    const chat = await convertGatewayRequest("responses", "chat_completions", request, { upstreamModelName: "chat" });
    assert.equal("previous_response_id" in chat.value, false);
    const responses = await convertGatewayRequest("responses", "responses", request, { upstreamModelName: "gpt" });
    assert.equal(responses.value.previous_response_id, "resp-1");
});
test("Responses allowed_tools restricts non-Responses tool definitions", async () => {
    const result = await convertGatewayRequest("responses", "chat_completions", {
        model: "logical",
        input: "hello",
        tools: [
            { type: "function", name: "allowed", parameters: { type: "object" } },
            { type: "function", name: "hidden", parameters: { type: "object" } },
        ],
        tool_choice: { type: "allowed_tools", mode: "auto", tools: [{ type: "function", name: "allowed" }] },
    }, { upstreamModelName: "chat" });
    assert.deepEqual(result.value.tools, [{ type: "function", function: { name: "allowed", parameters: { type: "object" } } }]);
    assert.equal(result.value.tool_choice, "auto");
});
test("custom and tool-search tools retain executable fallback contracts", async () => {
    const result = await convertGatewayRequest("responses", "chat_completions", {
        model: "logical",
        input: "discover",
        tools: [{ type: "custom", name: "emit_text" }, { type: "tool_search" }],
    }, { upstreamModelName: "chat" });
    assert.deepEqual(result.value.tools, [
        { type: "function", function: { name: "emit_text", parameters: { type: "object", properties: { input: { type: "string" } }, required: ["input"], additionalProperties: false } } },
        { type: "function", function: { name: "tool_search", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } } },
    ]);
});
test("Gemini snake_case requests are normalized without mutating schema property names", async () => {
    const result = await convertGatewayRequest("gemini", "chat_completions", {
        model: "gemini",
        system_instruction: { parts: [{ text: "rules" }] },
        contents: [{ role: "user", parts: [{ text: "look" }, { inline_data: { mime_type: "image/png", data: "abc" } }] }],
        tools: [{ function_declarations: [{ name: "lookup", parameters: { type: "object", properties: { snake_case: { type: "string" } } } }] }],
        generation_config: { max_output_tokens: 77, stop_sequences: ["END"], thinking_config: { thinking_budget: 512, include_thoughts: true } },
    }, { upstreamModelName: "chat" });
    assert.equal(result.value.max_tokens, 77);
    assert.deepEqual(result.value.tools[0]?.function, { name: "lookup", parameters: { type: "object", properties: { snake_case: { type: "string" } } } });
    assert.equal(JSON.stringify(result.value).includes("image/png"), true);
});
test("Gemini structured output maps responseSchema in both directions", async () => {
    const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };
    const fromGemini = await convertGatewayRequest("gemini", "chat_completions", {
        model: "gemini",
        contents: [{ role: "user", parts: [{ text: "json" }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: schema },
    }, { upstreamModelName: "chat" });
    assert.deepEqual(fromGemini.value.response_format, { type: "json_schema", schema });
    const toGemini = await convertGatewayRequest("chat_completions", "gemini", {
        model: "chat",
        messages: [{ role: "user", content: "json" }],
        response_format: { type: "json_schema", json_schema: { name: "answer", schema } },
    }, { upstreamModelName: "gemini" });
    assert.deepEqual(toGemini.value.generationConfig.responseSchema, schema);
});
test("Gemini tool choice keeps the native functionCallingConfig shape", async () => {
    const result = await convertGatewayRequest("gemini", "gemini", {
        model: "gemini",
        contents: [{ role: "user", parts: [{ text: "hello" }] }],
        tools: [{ functionDeclarations: [{ name: "lookup", parameters: { type: "object" } }] }],
        toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["lookup"] } },
    }, { upstreamModelName: "gemini-upstream" });
    assert.deepEqual(result.value.toolConfig, { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["lookup"] } });
});
test("namespace flattening is collision-safe and deterministic", async () => {
    const request = {
        model: "logical",
        input: "hello",
        tools: [
            { type: "namespace", name: "crm", tools: [{ type: "function", name: "lookup", parameters: { type: "object" } }] },
            { type: "namespace", name: "billing", tools: [{ type: "function", name: "lookup", parameters: { type: "object" } }] },
            { type: "function", name: "crm__lookup", parameters: { type: "object" } },
        ],
    };
    const result = await convertGatewayRequest("responses", "chat_completions", request, { upstreamModelName: "chat" });
    assert.deepEqual(result.value.tools.map((tool) => (tool.function.name)), ["crm__lookup__2", "billing__lookup", "crm__lookup"]);
    assert.deepEqual(result.metadata?.toolNameMap, { crm__lookup__2: "lookup", billing__lookup: "lookup" });
});
test("long qualified tool names carry a deterministic collision-resistant suffix and encrypted schema markers are removed", async () => {
    const longNamespace = `namespace_${"x".repeat(80)}`;
    const longName = `tool_${"y".repeat(80)}`;
    const result = await convertGatewayRequest("responses", "chat_completions", {
        model: "logical",
        input: "hello",
        tools: [{ type: "namespace", name: longNamespace, tools: [{ type: "function", name: longName, parameters: { type: "object", encrypted: true, properties: { encrypted: { type: "string" } } } }] }],
    }, { upstreamModelName: "chat" });
    const tool = result.value.tools[0];
    const functionValue = tool.function;
    const name = functionValue.name;
    assert.equal(name.length <= 64, true);
    assert.equal(name.includes("__"), true);
    const schema = functionValue.parameters;
    assert.equal(schema.encrypted, undefined);
    assert.deepEqual(schema.properties.encrypted, { type: "string" });
});
test("hosted tool envelopes are decoded by their native protocol and only mapped to documented equivalents", async () => {
    const geminiSearch = await convertGatewayRequest("gemini", "responses", {
        model: "gemini",
        contents: [{ role: "user", parts: [{ text: "search" }] }],
        tools: [{ googleSearch: {} }],
    }, { upstreamModelName: "gpt" });
    assert.deepEqual(geminiSearch.value.tools, [{ type: "web_search_preview" }]);
    const geminiCode = await convertGatewayRequest("gemini", "responses", {
        model: "gemini",
        contents: [{ role: "user", parts: [{ text: "run code" }] }],
        tools: [{ codeExecution: {} }],
    }, { upstreamModelName: "gpt" });
    assert.deepEqual(geminiCode.value.tools, [{ type: "code_interpreter" }]);
    const anthropicSearch = await convertGatewayRequest("anthropic", "anthropic", {
        model: "claude",
        messages: [{ role: "user", content: "search" }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }],
    }, { upstreamModelName: "claude" });
    assert.deepEqual(anthropicSearch.value.tools, [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }]);
});
test("Chat web search uses the top-level web_search_options contract", async () => {
    const fromResponses = await convertGatewayRequest("responses", "chat_completions", {
        model: "gpt",
        input: "search the web",
        tools: [{ type: "web_search_preview" }],
    }, { upstreamModelName: "chat" });
    assert.deepEqual(fromResponses.value.web_search_options, {});
    assert.equal(fromResponses.value.tools, undefined);
    const fromChat = await convertGatewayRequest("chat_completions", "chat_completions", {
        model: "gpt",
        messages: [{ role: "user", content: "search" }],
        web_search_options: { search_context_size: "high" },
    }, { upstreamModelName: "chat" });
    assert.deepEqual(fromChat.value.web_search_options, { search_context_size: "high" });
    assert.equal(fromChat.value.tools, undefined);
});
test("request conversion pairs Anthropic and Gemini embedded tool results", async () => {
    const anthropic = await convertGatewayRequest("anthropic", "chat_completions", {
        model: "claude", messages: [
            { role: "assistant", content: [{ type: "tool_use", id: "tool-1", name: "lookup", input: { q: "x" } }] },
            { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "answer" }] },
        ],
    }, { upstreamModelName: "chat" });
    assert.deepEqual(anthropic.value.messages, [
        { role: "assistant", content: null, tool_calls: [{ id: "tool-1", type: "function", function: { name: "lookup", arguments: "{\"q\":\"x\"}" } }] },
        { role: "tool", name: "lookup", content: "answer", tool_call_id: "tool-1" },
    ]);
    const gemini = await convertGatewayRequest("gemini", "chat_completions", {
        model: "gemini", contents: [
            { role: "model", parts: [{ functionCall: { name: "lookup", args: { q: "x" } } }] },
            { role: "user", parts: [{ functionResponse: { name: "lookup", response: { result: "answer" } } }] },
        ],
    }, { upstreamModelName: "chat" });
    const messages = gemini.value.messages;
    assert.equal(messages[0]?.role, "assistant");
    assert.equal(messages[1]?.tool_call_id, "name:lookup");
    assert.equal(gemini.diagnostics.some((item) => item.code === "tool_exchange_orphan_tool_result"), false);
});
//# sourceMappingURL=request-converter.test.js.map