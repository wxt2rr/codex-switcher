import assert from "node:assert/strict";
import test from "node:test";
import { buildStreamHistory, ToolExchangeHistory } from "./tool-exchange-history.js";
test("generic history restores calls before Responses tool outputs", () => {
    const history = new ToolExchangeHistory();
    history.record("session", "chat_completions", {
        id: "resp-1",
        choices: [{ message: { role: "assistant", tool_calls: [
                        { id: "a", type: "function", function: { name: "alpha", arguments: "{}" } },
                        { id: "b", type: "function", function: { name: "beta", arguments: "{}" } },
                    ] } }],
    });
    const enriched = history.enrich("session", "responses", {
        model: "model",
        previous_response_id: "resp-1",
        input: [
            { type: "function_call_output", call_id: "b", output: "B" },
            { type: "function_call_output", call_id: "a", output: "A" },
        ],
    });
    assert.deepEqual(enriched.input.map((item) => item.type), ["function_call", "function_call", "function_call_output", "function_call_output"]);
    assert.deepEqual(enriched.input.slice(0, 2).map((item) => item.call_id), ["a", "b"]);
    assert.equal("previous_response_id" in enriched, false);
});
test("generic history snapshots and reloads without retaining unrelated data", () => {
    const first = new ToolExchangeHistory();
    first.record("session", "responses", { id: "resp", output: [{ type: "function_call", call_id: "call", name: "read", arguments: "{}" }] });
    const second = new ToolExchangeHistory();
    second.load(first.snapshot());
    const restored = second.enrich("session", "responses", { previous_response_id: "resp", input: [{ type: "function_call_output", call_id: "call", output: "ok" }] });
    assert.equal(restored.input[0]?.type, "function_call");
});
test("generic history drops polluted empty and malformed tool calls", () => {
    const history = new ToolExchangeHistory();
    history.record("session", "chat_completions", {
        id: "resp-polluted",
        choices: [{ message: { role: "assistant", tool_calls: [
                        { id: "empty", function: { name: "empty", arguments: "" } },
                        { id: "bad", function: { name: "bad", arguments: "{oops" } },
                        { id: "valid", function: { name: "valid", arguments: "{}" } },
                    ] } }],
    });
    const restored = history.enrich("session", "responses", {
        previous_response_id: "resp-polluted",
        input: [{ type: "function_call_output", call_id: "valid", output: "ok" }],
    });
    assert.deepEqual(restored.input.map((item) => item.call_id), ["valid", "valid"]);
    assert.equal(JSON.stringify(restored).includes('arguments":""'), false);
});
test("generic history restores custom and hosted Responses calls without flattening their kind", () => {
    const history = new ToolExchangeHistory();
    history.record("session", "responses", {
        id: "resp-special",
        output: [
            { type: "custom_tool_call", call_id: "custom-1", name: "emit", input: "plain text" },
            { type: "web_search_call", call_id: "hosted-1", status: "completed", action: { type: "search" } },
        ],
    });
    const enriched = history.enrich("session", "responses", {
        previous_response_id: "resp-special",
        input: [
            { type: "custom_tool_call_output", call_id: "custom-1", output: "ok" },
            { type: "web_search_call_output", call_id: "hosted-1", output: "ok" },
        ],
    });
    assert.deepEqual(enriched.input.slice(0, 2).map((item) => item.type), ["custom_tool_call", "web_search_call"]);
    assert.equal(enriched.input[0]?.input, "plain text");
});
test("generic history restores assistant text and reasoning before later tool outputs", () => {
    const history = new ToolExchangeHistory();
    history.record("session", "chat_completions", {
        id: "resp-text",
        choices: [{ message: { role: "assistant", content: "I will inspect this", reasoning_content: "plan", tool_calls: [{ id: "call", type: "function", function: { name: "read", arguments: "{}" } }] } }],
    });
    const enriched = history.enrich("session", "responses", {
        previous_response_id: "resp-text",
        input: [{ type: "function_call_output", call_id: "call", output: "done" }],
    });
    const input = enriched.input;
    assert.equal(input[0]?.type, "reasoning");
    assert.equal(input[1]?.type, "message");
    assert.equal((input[1]?.content)[0]?.type, "output_text");
    assert.equal(input[2]?.type, "function_call");
    assert.equal(input[3]?.type, "function_call_output");
});
test("generic history normalizes multimodal Chat and Gemini output items", () => {
    const chat = new ToolExchangeHistory();
    chat.record("chat", "chat_completions", {
        id: "chat-media",
        choices: [{ message: { role: "assistant", content: [
                        { type: "text", text: "answer" },
                        { type: "image_url", image_url: { url: "https://example.test/image.png" } },
                    ] } }],
    });
    const chatNext = chat.enrich("chat", "responses", { previous_response_id: "chat-media", input: [{ type: "input_text", text: "next" }] });
    assert.deepEqual(chatNext.input[0]?.content, [
        { type: "output_text", text: "answer" },
        { type: "output_image", image_url: { url: "https://example.test/image.png" } },
    ]);
    const gemini = new ToolExchangeHistory();
    gemini.record("gemini", "gemini", {
        responseId: "gemini-media",
        candidates: [{ content: { role: "model", parts: [
                        { text: "answer" },
                        { inlineData: { mimeType: "image/png", data: "abc" } },
                    ] } }],
    });
    const geminiNext = gemini.enrich("gemini", "responses", { previous_response_id: "gemini-media", input: [{ type: "input_text", text: "next" }] });
    assert.equal(geminiNext.input[0]?.type, "message");
    assert.equal(JSON.stringify(geminiNext).includes("image/png"), true);
});
test("generic history pairs same-name Gemini calls and responses FIFO", () => {
    const history = new ToolExchangeHistory();
    history.record("gemini-tools", "gemini", {
        responseId: "gemini-tools-response",
        candidates: [{ content: { role: "model", parts: [
                        { functionCall: { name: "lookup", args: { q: "a" } }, thoughtSignature: "sig-a" },
                        { functionCall: { name: "lookup", args: { q: "b" } }, thoughtSignature: "sig-b" },
                        { functionResponse: { name: "lookup", response: { ok: "a" } } },
                        { functionResponse: { name: "lookup", response: { ok: "b" } } },
                    ] } }],
    });
    const restored = history.enrich("gemini-tools", "responses", { previous_response_id: "gemini-tools-response", input: [] });
    const input = restored.input;
    assert.deepEqual(input.filter((item) => item.type === "function_call").map((item) => item.call_id), ["name:lookup", "name:lookup:1"]);
    assert.deepEqual(input.filter((item) => item.type === "function_call_output").map((item) => item.call_id), ["name:lookup", "name:lookup:1"]);
    assert.equal(input.find((item) => item.type === "function_call")?.thought_signature, "sig-a");
});
test("generic history deduplicates a client replay of the previous output", () => {
    const history = new ToolExchangeHistory();
    history.record("dedupe", "responses", {
        id: "resp-dedupe",
        output: [{ id: "msg-1", type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }] }],
    });
    const restored = history.enrich("dedupe", "responses", {
        previous_response_id: "resp-dedupe",
        input: [
            { id: "msg-1", type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }] },
            { type: "input_text", text: "follow up" },
        ],
    });
    assert.deepEqual(restored.input.map((item) => item.type), ["message", "input_text"]);
});
test("generic history preserves tool-result errors and strips encrypted compaction", () => {
    const history = new ToolExchangeHistory();
    history.record("safe", "responses", {
        id: "resp-safe",
        output: [
            { type: "message", content: [{ type: "output_text", text: "answer" }] },
            { type: "function_call_output", call_id: "call-1", output: "denied", is_error: true },
            { type: "compaction", encrypted_content: "secret" },
            { type: "compaction_summary", summary: "readable" },
        ],
    });
    const restored = history.enrich("safe", "responses", { previous_response_id: "resp-safe", input: [] });
    assert.equal(JSON.stringify(restored).includes("secret"), false);
    assert.equal(JSON.stringify(restored).includes('"is_error":true'), true);
    assert.equal(JSON.stringify(restored).includes("readable"), true);
});
test("stream history keeps message boundaries around interleaved media and calls", () => {
    const history = buildStreamHistory([
        { type: "text_delta", text: "before" },
        { type: "tool_call_delta", callId: "call-1", name: "lookup", argumentsDelta: "{}", argumentsFinal: true, kind: "function" },
        { type: "media", mediaType: "image", media: { image_url: { url: "https://example.test/a.png" } } },
        { type: "text_delta", text: "after" },
        { type: "tool_result", callId: "call-1", output: "ok", isError: false, kind: "function" },
    ]);
    assert.deepEqual(history.items.map((item) => item.type), ["message", "function_call", "message", "function_call_output"]);
    assert.equal(JSON.stringify(history.items[0]).includes("before"), true);
    assert.equal(JSON.stringify(history.items[2]).includes("output_image"), true);
    assert.equal(JSON.stringify(history.items[2]).includes("after"), true);
    assert.equal(history.calls[0]?.id, "call-1");
});
test("stream history keeps distinct Responses message item locations", () => {
    const history = buildStreamHistory([
        { type: "text_delta", text: "first", itemId: "msg-a", outputIndex: 0 },
        { type: "text_delta", text: "second", itemId: "msg-b", outputIndex: 1 },
    ]);
    assert.deepEqual(history.items.map((item) => item.id), ["msg-a", "msg-b"]);
    assert.deepEqual(history.items.map((item) => (item.content[0]?.text)), ["first", "second"]);
});
test("stream history preserves signature-only reasoning and bounded response replay", () => {
    const history = buildStreamHistory([
        { type: "reasoning_delta", text: "", signature: "sig" },
    ]);
    assert.deepEqual(history.items, [{ type: "reasoning", summary: [{ type: "summary_text", text: "", signature: "sig" }] }]);
    const bounded = new ToolExchangeHistory(2);
    bounded.record("session", "responses", { id: "one", output: [{ type: "message", content: [{ type: "output_text", text: "one" }] }] });
    bounded.record("session", "responses", { id: "two", output: [{ type: "message", content: [{ type: "output_text", text: "two" }] }] });
    bounded.record("session", "responses", { id: "three", output: [{ type: "message", content: [{ type: "output_text", text: "three" }] }] });
    const snapshot = bounded.snapshot();
    assert.deepEqual(Object.keys(snapshot.responseItems?.session ?? {}), ["two", "three"]);
});
test("stream history keeps partial reasoning, media and tool arguments replayable after interruption", () => {
    const history = buildStreamHistory([
        { type: "reasoning_delta", text: "plan" },
        { type: "media", mediaType: "file", media: { file: { file_id: "file-1" } } },
        { type: "tool_call_delta", callId: "call-partial", name: "lookup", argumentsDelta: "{\"q\":", kind: "function" },
        { type: "tool_call_delta", callId: "call-partial", argumentsDelta: "\"x\"}", argumentsFinal: true, kind: "function" },
    ]);
    assert.deepEqual(history.items.map((item) => item.type), ["reasoning", "message", "function_call"]);
    assert.equal(JSON.stringify(history.items).includes("file-1"), true);
    assert.equal(history.calls[0]?.arguments, '{"q":"x"}');
});
test("generic history sanitizes encrypted items again when loading a persisted snapshot", () => {
    const history = new ToolExchangeHistory();
    history.load({
        sessions: { safe: { response: [{ id: "call", name: "lookup", arguments: "{}" }] } },
        responseItems: { safe: { response: [
                    { type: "compaction", encrypted_content: "must-not-replay" },
                    { type: "compaction_summary", summary: "readable" },
                ] } },
    });
    const restored = history.enrich("safe", "responses", { previous_response_id: "response", input: [] });
    assert.equal(JSON.stringify(restored).includes("must-not-replay"), false);
    assert.equal(JSON.stringify(restored).includes("readable"), true);
});
test("generic history preserves Gemini tool-result media and error flags", () => {
    const history = new ToolExchangeHistory();
    history.record("gemini-media-tool", "gemini", {
        responseId: "gemini-media-tool-response",
        candidates: [{ content: { role: "model", parts: [
                        { functionCall: { name: "inspect", args: { path: "a" } }, thoughtSignature: "sig" },
                        { functionResponse: { name: "inspect", response: { parts: [{ inlineData: { mimeType: "image/png", data: "abc" } }] }, isError: true } },
                    ] } }],
    });
    const restored = history.enrich("gemini-media-tool", "responses", { previous_response_id: "gemini-media-tool-response", input: [] });
    const output = restored.input;
    const result = output.find((item) => item.type === "function_call_output");
    assert.equal(result?.is_error, true);
    assert.equal(JSON.stringify(result).includes("image/png"), true);
    assert.equal(output.find((item) => item.type === "function_call")?.thought_signature, "sig");
});
//# sourceMappingURL=tool-exchange-history.test.js.map