import assert from "node:assert/strict";
import test from "node:test";
import { convertStreamChunk, createResponseStreamState, finalizeResponseStream } from "./stream-state.js";
test("stream state preserves chunk order, tool argument deltas and final usage", async () => {
    const state = createResponseStreamState("chat_completions", "responses", { requestId: "stream-1", upstreamModelName: "gpt" }, { emitSequenceNumber: true });
    const first = await convertStreamChunk(state, { id: "chat-1", choices: [{ delta: { content: "hel", tool_calls: [{ id: "call-1", function: { name: "search", arguments: "{\"q\":" } }] }, finish_reason: null }] });
    const second = await convertStreamChunk(state, { id: "chat-1", choices: [{ delta: { content: "lo", tool_calls: [{ id: "call-1", function: { arguments: "\"hi\"}" } }] }, finish_reason: null }] });
    const final = await convertStreamChunk(state, { id: "chat-1", choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 2, completion_tokens: 4 } });
    assert.equal(first.value[0]?.type, "response.created");
    assert.equal(JSON.stringify([...first.value, ...second.value]).includes("hel"), true);
    assert.equal(JSON.stringify([...first.value, ...second.value]).includes("lo"), true);
    assert.equal(JSON.stringify([...first.value, ...second.value]).includes("function_call_arguments.delta"), true);
    assert.equal(JSON.stringify(final.value).includes("{\\\"q\\\":\\\"hi\\\"}"), true);
    assert.equal(final.value.some((event) => event.type === "response.completed"), true);
    assert.equal(first.value.some((event) => event.type === "response.output_item.added"), true);
    assert.equal(first.value.some((event) => event.type === "response.content_part.added"), true);
    assert.equal(final.value.some((event) => event.type === "response.output_text.done"), true);
    assert.equal(final.value.some((event) => event.type === "response.content_part.done"), true);
    assert.equal(final.value.some((event) => event.type === "response.output_item.done"), true);
    assert.equal(final.value.findIndex((event) => event.type === "response.usage") < final.value.findIndex((event) => event.type === "response.completed"), true);
    assert.equal(state.usage.inputTokens, 2);
    assert.equal(state.usage.outputTokens, 4);
    assert.equal(state.ended, true);
});
test("stream state joins indexed Chat fragments when only the first fragment has an id", async () => {
    const state = createResponseStreamState("chat_completions", "responses");
    await convertStreamChunk(state, {
        id: "chat-indexed-id",
        choices: [{ delta: { tool_calls: [{ index: 0, id: "call-weather", function: { name: "lookup", arguments: "{\"q\":" } }] }, finish_reason: null }],
    });
    const continuation = await convertStreamChunk(state, {
        id: "chat-indexed-id",
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"weather\"}" } }] }, finish_reason: null }],
    });
    const terminal = await finalizeResponseStream(state, "tool_calls");
    const completed = terminal.value.find((event) => event.type === "response.completed");
    assert.ok(completed);
    assert.equal(completed.response.output instanceof Array, true);
    assert.equal(JSON.stringify([...continuation.value, ...terminal.value]).includes("call-weather"), true);
});
test("stream state suppresses empty and malformed tool calls", async () => {
    const state = createResponseStreamState("chat_completions", "responses", { requestId: "invalid-stream" });
    const result = await convertStreamChunk(state, { id: "chat-invalid", choices: [{ delta: { tool_calls: [
                        { index: 0, id: "empty", function: { name: "empty", arguments: "" } },
                        { index: 1, id: "bad", function: { name: "bad", arguments: "{oops" } },
                        { index: 2, id: "valid", function: { name: "valid", arguments: "{}" } },
                    ] }, finish_reason: "tool_calls" }] });
    const serialized = JSON.stringify(result.value);
    assert.equal(serialized.includes('"call_id":"empty"'), false);
    assert.equal(serialized.includes('"call_id":"bad"'), false);
    assert.equal(serialized.includes('"call_id":"valid"'), true);
    assert.equal(serialized.includes('"arguments":""'), false);
});
test("stream state fails when tool_calls contains no valid call", async () => {
    const state = createResponseStreamState("chat_completions", "responses", { requestId: "invalid-only-stream" });
    const result = await convertStreamChunk(state, { id: "chat-invalid-only", choices: [{ delta: {
                    content: "我来看一下这个项目的结构和说明文件。",
                    tool_calls: [{ index: 0, id: "broken", function: { name: "read", arguments: "" } }],
                }, finish_reason: "tool_calls" }] });
    const failed = result.value.find((event) => event.type === "response.failed");
    assert.deepEqual(failed?.response?.error, {
        code: "upstream_invalid_tool_call",
        message: "Upstream finished with 'tool_calls' but returned no valid tool call arguments; the provider likely emitted an empty or malformed tool call: read(arguments=empty)",
        retryable: false,
    });
    assert.equal(result.value.some((event) => event.type === "response.completed"), false);
    assert.equal(state.ended, true);
});
test("stream state preserves object tool arguments", async () => {
    const state = createResponseStreamState("chat_completions", "responses", { requestId: "object-stream" });
    const result = await convertStreamChunk(state, { id: "chat-object", choices: [{ delta: {
                    tool_calls: [{ index: 0, id: "object-call", function: { name: "read", arguments: { path: "README.md" } } }],
                }, finish_reason: "tool_calls" }] });
    assert.equal(JSON.stringify(result.value).includes('{\\"path\\":\\"README.md\\"}'), true);
});
test("Responses-to-Chat streaming emits only complete tool arguments", async () => {
    const state = createResponseStreamState("responses", "chat_completions", { requestId: "responses-to-chat" });
    const first = await convertStreamChunk(state, {
        type: "response.function_call_arguments.delta",
        call_id: "call-1",
        name: "lookup",
        delta: "{\"q\":"
    });
    assert.equal(first.value.some((event) => Array.isArray(event.choices)
        && event.choices.some((choice) => {
            const delta = choice.delta;
            return Array.isArray(delta?.tool_calls);
        })), false);
    const final = await convertStreamChunk(state, {
        type: "response.completed",
        response: { id: "responses-to-chat", status: "completed" },
    });
    const toolChunk = final.value.find((event) => Array.isArray(event.choices)
        && event.choices.some((choice) => Array.isArray(choice.delta?.tool_calls)));
    const delta = (toolChunk?.choices?.[0])?.delta;
    const toolCall = delta?.tool_calls?.[0];
    assert.equal(toolCall?.function?.arguments, undefined);
    // A split call is only emitted once the terminal frame supplies the rest.
    const complete = createResponseStreamState("responses", "chat_completions", { requestId: "responses-to-chat-complete" });
    await convertStreamChunk(complete, { type: "response.function_call_arguments.delta", call_id: "call-2", name: "lookup", delta: "{\"q\":" });
    const completeResult = await convertStreamChunk(complete, { type: "response.function_call_arguments.delta", call_id: "call-2", delta: "\"x\"}" });
    assert.equal(completeResult.value.length, 0);
    const completeFinal = await convertStreamChunk(complete, { type: "response.completed", response: { status: "completed" } });
    const completeTool = completeFinal.value.find((event) => Array.isArray(event.choices)
        && event.choices.some((choice) => Array.isArray(choice.delta?.tool_calls)));
    const completeDelta = (completeTool?.choices?.[0])?.delta;
    assert.equal(((completeDelta?.tool_calls)[0]?.function).arguments, "{\"q\":\"x\"}");
});
test("Responses-to-Chat streaming emits standard indexes for parallel tool calls", async () => {
    const state = createResponseStreamState("responses", "chat_completions", { requestId: "responses-to-chat-parallel" });
    await convertStreamChunk(state, { type: "response.function_call_arguments.delta", call_id: "call-a", name: "alpha", delta: "{}" });
    await convertStreamChunk(state, { type: "response.function_call_arguments.delta", call_id: "call-b", name: "beta", delta: "{}" });
    const terminal = await convertStreamChunk(state, { type: "response.completed", response: { id: "responses-to-chat-parallel", status: "completed" } });
    const toolChunks = terminal.value.filter((event) => Array.isArray(event.choices)
        && event.choices.some((choice) => Array.isArray(choice.delta?.tool_calls)));
    const toolCalls = toolChunks.flatMap((event) => event.choices
        .flatMap((choice) => choice.delta?.tool_calls ?? []));
    assert.deepEqual(toolCalls.map((toolCall) => toolCall.index), [0, 1]);
    assert.deepEqual(toolCalls.map((toolCall) => toolCall.id), ["call-a", "call-b"]);
});
test("stream finalization emits a terminal event and rejects reuse", async () => {
    const state = createResponseStreamState("responses", "chat_completions", { requestId: "stream-2" });
    const result = await finalizeResponseStream(state);
    assert.equal(result.value[0]?.object, "chat.completion.chunk");
    assert.equal(state.ended, true);
    await assert.rejects(convertStreamChunk(state, { id: "r", output: [] }), /already finalized/);
});
test("stream decoder understands native Responses and Anthropic event envelopes", async () => {
    const responses = createResponseStreamState("responses", "chat_completions", { requestId: "responses-stream" });
    const responseText = await convertStreamChunk(responses, { type: "response.output_text.delta", delta: "hello" });
    assert.equal(JSON.stringify(responseText.value).includes('"hello"'), true);
    const responseEnd = await convertStreamChunk(responses, { type: "response.completed", response: { id: "r", status: "completed", usage: { input_tokens: 3, output_tokens: 2 } } });
    assert.equal(JSON.stringify(responseEnd.value).includes('"finish_reason":"stop"'), true);
    const anthropic = createResponseStreamState("anthropic", "responses", { requestId: "anthropic-stream" });
    const thinking = await convertStreamChunk(anthropic, { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "think" } });
    assert.equal(thinking.value.some((event) => event.type === "response.reasoning_summary_text.delta"), true);
    const text = await convertStreamChunk(anthropic, { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "hello" } });
    assert.equal(text.value.some((event) => event.type === "response.output_text.delta"), true);
    const end = await convertStreamChunk(anthropic, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { input_tokens: 3, output_tokens: 2 } });
    assert.equal(end.value.some((event) => event.type === "response.completed"), true);
    const anthropicTarget = createResponseStreamState("chat_completions", "anthropic", { requestId: "anthropic-target" });
    const targetText = await convertStreamChunk(anthropicTarget, { choices: [{ delta: { content: "hello" }, finish_reason: null }] });
    assert.equal(targetText.value.some((event) => event.type === "content_block_start"), true);
    assert.equal(targetText.value.some((event) => event.type === "content_block_delta"), true);
    const targetEnd = await convertStreamChunk(anthropicTarget, { choices: [{ delta: {}, finish_reason: "stop" }] });
    assert.equal(targetEnd.value.some((event) => event.type === "message_delta"), true);
    assert.equal(targetEnd.value.some((event) => event.type === "message_stop"), true);
});
test("Anthropic target reuses one text block across Chat and Responses deltas", async () => {
    const chat = createResponseStreamState("chat_completions", "anthropic", { requestId: "anthropic-chat-text" });
    const chatResults = [];
    for (const text of ["目录", "`", "再", "让我"]) {
        chatResults.push(await convertStreamChunk(chat, { choices: [{ delta: { content: text }, finish_reason: null }] }));
    }
    chatResults.push(await convertStreamChunk(chat, { choices: [{ delta: {}, finish_reason: "stop" }] }));
    const chatEvents = chatResults.flatMap((result) => result.value);
    assert.deepEqual(chatEvents.filter((event) => event.type === "content_block_start").map((event) => event.index), [0]);
    assert.deepEqual(chatEvents.filter((event) => event.type === "content_block_stop").map((event) => event.index), [0]);
    assert.equal(chatEvents.filter((event) => event.type === "content_block_delta").length, 4);
    const responses = createResponseStreamState("responses", "anthropic", { requestId: "anthropic-responses-text" });
    const responsesResults = [];
    for (const text of ["one", "two", "three"]) {
        responsesResults.push(await convertStreamChunk(responses, { type: "response.output_text.delta", delta: text }));
    }
    responsesResults.push(await convertStreamChunk(responses, { type: "response.completed", response: { status: "completed" } }));
    const responseEvents = responsesResults.flatMap((result) => result.value);
    assert.deepEqual(responseEvents.filter((event) => event.type === "content_block_start").map((event) => event.index), [0]);
    assert.deepEqual(responseEvents.filter((event) => event.type === "content_block_stop").map((event) => event.index), [0]);
});
test("Anthropic target reuses thinking blocks and closes them on type changes", async () => {
    const state = createResponseStreamState("responses", "anthropic", { requestId: "anthropic-thinking-blocks" });
    const results = [];
    results.push(await convertStreamChunk(state, { type: "response.reasoning_summary_text.delta", delta: "plan" }));
    results.push(await convertStreamChunk(state, { type: "response.reasoning_summary_text.delta", delta: " more" }));
    results.push(await convertStreamChunk(state, { type: "response.output_text.delta", delta: "answer" }));
    results.push(await convertStreamChunk(state, { type: "response.output_text.delta", delta: " done" }));
    results.push(await convertStreamChunk(state, { type: "response.completed", response: { status: "completed" } }));
    const events = results.flatMap((result) => result.value);
    assert.deepEqual(events.filter((event) => event.type === "content_block_start").map((event) => event.index), [0, 1]);
    assert.deepEqual(events.filter((event) => event.type === "content_block_delta").map((event) => event.index), [0, 0, 1, 1]);
    assert.deepEqual(events.filter((event) => event.type === "content_block_stop").map((event) => event.index), [0, 1]);
});
test("Anthropic target closes an open text block before media and tool results", async () => {
    const media = createResponseStreamState("responses", "anthropic", { requestId: "anthropic-media-boundary" });
    const mediaResults = [
        await convertStreamChunk(media, { type: "response.output_text.delta", delta: "before" }),
        await convertStreamChunk(media, { type: "response.output_item.done", output_index: 1, item: { id: "image-1", type: "message", role: "assistant", content: [{ type: "output_image", image_url: "https://example.test/image.png" }] } }),
        await convertStreamChunk(media, { type: "response.output_text.delta", delta: "after" }),
        await convertStreamChunk(media, { type: "response.completed", response: { status: "completed" } }),
    ];
    const mediaEvents = mediaResults.flatMap((result) => result.value);
    assert.deepEqual(mediaEvents.filter((event) => event.type === "content_block_start").map((event) => event.index), [0, 1, 2]);
    assert.deepEqual(mediaEvents.filter((event) => event.type === "content_block_stop").map((event) => event.index), [0, 1, 2]);
    const toolResult = createResponseStreamState("responses", "anthropic", { requestId: "anthropic-tool-result-boundary" });
    const toolResults = [
        await convertStreamChunk(toolResult, { type: "response.output_text.delta", delta: "before" }),
        await convertStreamChunk(toolResult, { type: "response.output_item.done", output_index: 1, item: { id: "output-1", type: "function_call_output", call_id: "call-1", output: "ok" } }),
        await convertStreamChunk(toolResult, { type: "response.output_text.delta", delta: "after" }),
        await convertStreamChunk(toolResult, { type: "response.completed", response: { status: "completed" } }),
    ];
    const toolEvents = toolResults.flatMap((result) => result.value);
    assert.deepEqual(toolEvents.filter((event) => event.type === "content_block_start").map((event) => event.index), [0, 1, 2]);
    assert.deepEqual(toolEvents.filter((event) => event.type === "content_block_stop").map((event) => event.index), [0, 1, 2]);
});
test("stream conversion reports unknown provider events without fabricating output", async () => {
    const state = createResponseStreamState("responses", "chat_completions", { requestId: "unknown-event" });
    const result = await convertStreamChunk(state, { type: "response.future_event", response_id: "unknown-event", payload: { opaque: true } });
    assert.deepEqual(result.value.filter((event) => Array.isArray(event.choices)), [
        { id: "unknown-event", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] },
    ]);
    assert.equal(result.diagnostics[0]?.code, "unknown_stream_event");
});
test("Responses streaming keeps incomplete detail metadata", async () => {
    const state = createResponseStreamState("responses", "responses", { requestId: "incomplete-stream" });
    const result = await convertStreamChunk(state, {
        type: "response.incomplete",
        response: { id: "incomplete-stream", status: "incomplete", incomplete_details: { reason: "max_output_tokens", limit: 64 } },
    });
    const terminal = result.value.find((event) => event.type === "response.incomplete");
    assert.deepEqual(terminal?.response?.incomplete_details, { reason: "max_output_tokens", limit: 64 });
});
test("Responses stream preserves custom calls and rejects hosted calls on non-Responses targets", async () => {
    const custom = createResponseStreamState("responses", "responses", { requestId: "custom-stream" });
    await convertStreamChunk(custom, { type: "response.custom_tool_call_input.delta", call_id: "custom-1", name: "emit_text", delta: "plain" });
    await convertStreamChunk(custom, { type: "response.custom_tool_call_input.done", call_id: "custom-1", name: "emit_text", input: "plain" });
    const customEnd = await convertStreamChunk(custom, { type: "response.completed", response: { status: "completed" } });
    assert.equal(customEnd.value.some((event) => event.type === "response.completed" && JSON.stringify(event).includes("custom_tool_call")), true);
    const customDowngrade = createResponseStreamState("responses", "chat_completions", { requestId: "custom-downgrade" });
    await convertStreamChunk(customDowngrade, { type: "response.custom_tool_call_input.delta", call_id: "custom-2", name: "emit_json", delta: "{\"ok\":true}" });
    const customDowngradeEnd = await convertStreamChunk(customDowngrade, { type: "response.completed", response: { status: "completed" } });
    assert.equal(customDowngradeEnd.value.some((event) => Array.isArray(event.choices) && JSON.stringify(event).includes("emit_json")), true);
    const hosted = createResponseStreamState("responses", "chat_completions", { requestId: "hosted-stream" });
    await convertStreamChunk(hosted, { type: "response.output_item.added", item: { type: "web_search_call", id: "search-1", status: "in_progress" } });
    const hostedEnd = await convertStreamChunk(hosted, { type: "response.completed", response: { status: "completed" } });
    assert.equal(hostedEnd.value.some((event) => event.error?.code === "unsupported_hosted_tool_response"), true);
});
test("Responses streaming preserves custom tool text and emits a complete item lifecycle", async () => {
    const state = createResponseStreamState("responses", "chat_completions", { requestId: "custom-stream-wrapper" });
    const delta = await convertStreamChunk(state, {
        type: "response.custom_tool_call_input.delta",
        call_id: "custom-3",
        name: "emit_text",
        delta: "plain text",
    });
    const end = await convertStreamChunk(state, { type: "response.completed", response: { status: "completed" } });
    const serialized = JSON.stringify([...delta.value, ...end.value]);
    assert.equal(serialized.includes('"name":"emit_text"'), true);
    assert.equal(serialized.includes('"arguments":"{\\"input\\":\\"plain text\\"}"'), true);
    assert.equal(end.value.some((event) => event.object === "chat.completion.chunk"), true);
});
test("stream conversion covers every protocol direction with native terminal chunks", async () => {
    const chunks = {
        responses: [{ type: "response.output_text.delta", delta: "hello" }, { type: "response.completed", response: { status: "completed", usage: { input_tokens: 1, output_tokens: 1 } } }],
        chat_completions: [{ id: "chat", choices: [{ delta: { content: "hello" }, finish_reason: null }] }, { id: "chat", choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }],
        anthropic: [{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } }, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { input_tokens: 1, output_tokens: 1 } }],
        gemini: [{ responseId: "gemini", candidates: [{ content: { parts: [{ text: "hello" }] } }] }, { responseId: "gemini", candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }],
    };
    const protocols = Object.keys(chunks);
    for (const source of protocols)
        for (const target of protocols) {
            const state = createResponseStreamState(source, target, { requestId: `${source}-${target}` });
            const results = [];
            for (const chunk of chunks[source])
                results.push(await convertStreamChunk(state, chunk));
            assert.equal(results.some((result) => result.value.length > 0), true, `${source}->${target}`);
        }
});
test("stream conversion preserves media parts and thinking signatures", async () => {
    const state = createResponseStreamState("gemini", "responses", { requestId: "rich-stream" });
    const media = await convertStreamChunk(state, {
        responseId: "gemini-rich",
        candidates: [{ content: { parts: [
                        { text: "think", thought: true, thoughtSignature: "sig-g" },
                        { inlineData: { mimeType: "image/png", data: "abc" } },
                    ] } }],
    });
    assert.equal(JSON.stringify(media.value).includes("image/png"), true);
    assert.equal(JSON.stringify(media.value).includes("sig-g"), true);
    const end = await convertStreamChunk(state, { responseId: "gemini-rich", candidates: [{ finishReason: "STOP" }] });
    assert.equal(end.value.some((event) => event.type === "response.completed"), true);
});
test("Responses stream closes output items in their original output-index order", async () => {
    const state = createResponseStreamState("chat_completions", "responses", { requestId: "ordered-items" }, { emitSequenceNumber: true });
    await convertStreamChunk(state, { id: "chat", choices: [{ delta: { content: "answer" }, finish_reason: null }] });
    await convertStreamChunk(state, { id: "chat", choices: [{ delta: { reasoning_content: "plan" }, finish_reason: null }] });
    const terminal = await convertStreamChunk(state, { id: "chat", choices: [{ delta: {}, finish_reason: "stop" }] });
    const done = terminal.value.filter((event) => event.type === "response.output_item.done");
    assert.deepEqual(done.map((event) => event.output_index), [0, 1]);
    const sequence = terminal.value.map((event) => Number(event.sequence_number)).filter(Number.isFinite);
    assert.deepEqual(sequence, [...sequence].sort((a, b) => a - b));
    const completed = terminal.value.find((event) => event.type === "response.completed");
    assert.ok(completed);
    assert.deepEqual(completed.response.output.map((item) => item.type), ["message", "reasoning"]);
});
test("Responses stream keeps multiple message and reasoning item boundaries", async () => {
    const state = createResponseStreamState("responses", "responses", { requestId: "multi-items" });
    await convertStreamChunk(state, { type: "response.output_text.delta", item_id: "msg-a", output_index: 0, delta: "first" });
    await convertStreamChunk(state, { type: "response.reasoning_summary_text.delta", item_id: "rs-a", output_index: 1, delta: "plan" });
    await convertStreamChunk(state, { type: "response.output_text.delta", item_id: "msg-b", output_index: 2, delta: "second" });
    const terminal = await convertStreamChunk(state, { type: "response.completed", response: { id: "multi-items", status: "completed" } });
    const completed = terminal.value.find((event) => event.type === "response.completed");
    assert.ok(completed);
    const output = completed.response.output;
    assert.deepEqual(output.map((item) => `${item.type}:${item.id}`), ["message:msg-a", "reasoning:rs-a", "message:msg-b"]);
    const done = terminal.value.filter((event) => event.type === "response.output_item.done");
    assert.deepEqual(done.map((event) => event.output_index), [0, 1, 2]);
});
test("Responses stream preserves multiple reasoning summary parts", async () => {
    const state = createResponseStreamState("responses", "responses", { requestId: "multi-summary" });
    await convertStreamChunk(state, { type: "response.reasoning_summary_text.delta", item_id: "rs-1", output_index: 0, summary_index: 0, delta: "first" });
    // A Responses stream may expose a second summary segment with an explicit
    // summary index; it must not be concatenated into part zero.
    await convertStreamChunk(state, { type: "response.reasoning_summary_text.delta", item_id: "rs-1", output_index: 0, summary_index: 1, delta: "second" });
    const terminal = await finalizeResponseStream(state, "stop");
    const completed = terminal.value.find((event) => event.type === "response.completed");
    const reasoning = (completed?.response?.output).find((item) => item.type === "reasoning");
    assert.deepEqual((reasoning?.summary).map((part) => part.text), ["first", "second"]);
});
test("Responses stream does not duplicate a native output_item.done payload", async () => {
    const state = createResponseStreamState("responses", "chat_completions", { requestId: "native-done" });
    await convertStreamChunk(state, { type: "response.output_item.added", output_index: 0, item: { id: "msg-1", type: "message", status: "in_progress", role: "assistant", content: [] } });
    await convertStreamChunk(state, { type: "response.output_text.delta", item_id: "msg-1", output_index: 0, content_index: 0, delta: "hello" });
    const done = await convertStreamChunk(state, { type: "response.output_item.done", output_index: 0, item: { id: "msg-1", type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: "hello", annotations: [] }] } });
    assert.equal(JSON.stringify(done.value).includes("hellohello"), false);
});
test("Responses stream does not duplicate media from output_item.done", async () => {
    const state = createResponseStreamState("responses", "responses", { requestId: "native-media-done" });
    await convertStreamChunk(state, { type: "response.output_item.added", output_index: 0, item: { id: "media-1", type: "message", status: "in_progress", role: "assistant", content: [] } });
    const added = await convertStreamChunk(state, { type: "response.output_item.done", output_index: 0, item: { id: "media-1", type: "message", status: "completed", role: "assistant", content: [{ type: "output_image", image_url: "https://example.test/a.png" }] } });
    assert.equal(added.value.filter((event) => event.type === "response.output_item.added").length, 1);
    assert.equal(added.value.filter((event) => event.type === "response.output_item.done").length, 1);
    const completed = await convertStreamChunk(state, { type: "response.completed", response: { status: "completed" } });
    assert.equal(completed.value.filter((event) => event.type === "response.output_item.done").length, 0);
});
test("Responses stream does not duplicate output_text.done after deltas", async () => {
    const state = createResponseStreamState("responses", "chat_completions", { requestId: "native-text-done" });
    const delta = await convertStreamChunk(state, { type: "response.output_text.delta", item_id: "msg-1", output_index: 0, delta: "hello" });
    const done = await convertStreamChunk(state, { type: "response.output_text.done", item_id: "msg-1", output_index: 0, text: "hello" });
    const textChunks = [...delta.value, ...done.value].filter((event) => Array.isArray(event.choices) && JSON.stringify(event).includes('"content":"hello"'));
    assert.equal(textChunks.length, 1);
});
test("Responses stream does not duplicate terminal text when relay identifies only done events", async () => {
    const state = createResponseStreamState("responses", "chat_completions", { requestId: "unqualified-text-done" });
    const chunks = [
        { type: "response.output_text.delta", delta: "D" },
        { type: "response.output_text.delta", delta: "UP" },
        { type: "response.output_text.delta", delta: "TEST" },
        { type: "response.output_text.done", item_id: "msg-upstream", output_index: 0, text: "DUPTEST" },
        { type: "response.output_item.done", output_index: 0, item: {
                id: "msg-upstream", type: "message", status: "completed", role: "assistant",
                content: [{ type: "output_text", text: "DUPTEST", annotations: [] }],
            } },
    ];
    const results = [];
    for (const chunk of chunks)
        results.push(await convertStreamChunk(state, chunk));
    const text = results.flatMap((result) => result.value)
        .filter((event) => Array.isArray(event.choices))
        .flatMap((event) => event.choices.map((choice) => {
        const delta = choice.delta;
        return typeof delta?.content === "string" ? delta.content : "";
    }))
        .join("");
    assert.equal(text, "DUPTEST");
});
test("Responses to Chat Completions does not replay output_item.done or response.completed text", async () => {
    const state = createResponseStreamState("responses", "chat_completions", { requestId: "chat-terminal-replay" });
    const chunks = [
        { type: "response.output_text.delta", item_id: "msg-upstream", output_index: 0, delta: "hello" },
        { type: "response.output_item.done", output_index: 0, item: {
                id: "msg-upstream", type: "message", status: "completed", role: "assistant",
                content: [{ type: "output_text", text: "hello", annotations: [] }],
            } },
        { type: "response.completed", response: {
                id: "chat-terminal-replay", status: "completed", output: [{
                        id: "msg-upstream", type: "message", role: "assistant",
                        content: [{ type: "output_text", text: "hello", annotations: [] }],
                    }],
            } },
    ];
    const results = [];
    for (const chunk of chunks)
        results.push(await convertStreamChunk(state, chunk));
    const text = results.flatMap((result) => result.value)
        .filter((event) => Array.isArray(event.choices))
        .flatMap((event) => event.choices.map((choice) => {
        const delta = choice.delta;
        return typeof delta?.content === "string" ? delta.content : "";
    }))
        .join("");
    assert.equal(text, "hello");
    assert.equal(results.at(-1)?.value.some((event) => Array.isArray(event.choices) && event.choices[0]?.finish_reason === "stop"), true);
});
test("Responses stream retains function arguments first revealed by output_item.done", async () => {
    const state = createResponseStreamState("responses", "responses", { requestId: "native-call-done" });
    await convertStreamChunk(state, {
        type: "response.output_item.added",
        output_index: 0,
        item: { id: "fc-1", type: "function_call", status: "in_progress", call_id: "call-1", name: "lookup", arguments: "" },
    });
    const done = await convertStreamChunk(state, {
        type: "response.output_item.done",
        output_index: 0,
        item: { id: "fc-1", type: "function_call", status: "completed", call_id: "call-1", name: "lookup", arguments: "{\"q\":\"x\"}" },
    });
    assert.equal(JSON.stringify(done.value).includes('"delta":"{\\"q\\":\\"x\\"}"'), true);
    const terminal = await finalizeResponseStream(state, "tool_calls");
    assert.equal(JSON.stringify(terminal.value).includes('"arguments":"{\\"q\\":\\"x\\"}"'), true);
});
test("Responses refusal.done is not replayed after refusal deltas", async () => {
    const state = createResponseStreamState("responses", "chat_completions", { requestId: "refusal-done" });
    const delta = await convertStreamChunk(state, { type: "response.refusal.delta", item_id: "msg-1", output_index: 0, delta: "cannot" });
    const done = await convertStreamChunk(state, { type: "response.refusal.done", item_id: "msg-1", output_index: 0, refusal: "cannot" });
    assert.equal(delta.value.filter((event) => JSON.stringify(event).includes("cannot")).length, 1);
    assert.equal(done.value.filter((event) => JSON.stringify(event).includes("cannot")).length, 0);
});
test("Anthropic redacted thinking stream is emitted as an opaque thinking block", async () => {
    const state = createResponseStreamState("responses", "anthropic", { requestId: "redacted-stream" });
    const result = await convertStreamChunk(state, {
        type: "response.reasoning_summary_part.done",
        item_id: "reasoning-1",
        output_index: 0,
        part: { type: "redacted_thinking", data: "opaque" },
    });
    // Responses' redacted payload is carried by the canonical encryptedContent
    // field; Anthropic receives the documented redacted_thinking block.
    assert.equal(JSON.stringify(result.value).includes("redacted_thinking"), true);
});
test("native Responses lifecycle keeps upstream item ids and output indexes", async () => {
    const state = createResponseStreamState("responses", "responses", { requestId: "native-ids" });
    await convertStreamChunk(state, { type: "response.output_item.added", output_index: 3, item: { id: "msg-upstream", type: "message", status: "in_progress", role: "assistant", content: [] } });
    const delta = await convertStreamChunk(state, { type: "response.output_text.delta", item_id: "msg-upstream", output_index: 3, delta: "hello" });
    assert.equal(delta.value.some((event) => event.type === "response.output_item.added" && typeof event.item === "object" && event.item !== null && !Array.isArray(event.item) && event.item.id === "msg-upstream" && event.output_index === 3), true);
    const done = await convertStreamChunk(state, { type: "response.completed", response: { status: "completed" } });
    assert.equal(done.value.some((event) => event.type === "response.output_item.done" && typeof event.item === "object" && event.item !== null && !Array.isArray(event.item) && event.item.id === "msg-upstream"), true);
});
test("Responses terminal envelope does not replay already streamed output", async () => {
    const state = createResponseStreamState("responses", "responses", { requestId: "native-terminal-replay" });
    await convertStreamChunk(state, { type: "response.output_text.delta", item_id: "msg-1", output_index: 0, delta: "hello" });
    await convertStreamChunk(state, { type: "response.function_call_arguments.delta", item_id: "fc-1", output_index: 1, call_id: "call-1", name: "lookup", delta: "{}" });
    await convertStreamChunk(state, { type: "response.function_call_arguments.done", item_id: "fc-1", output_index: 1, call_id: "call-1", name: "lookup", arguments: "{}" });
    const terminal = await convertStreamChunk(state, {
        type: "response.completed",
        response: {
            id: "native-terminal-replay", status: "completed", output: [
                { type: "message", id: "msg-1", role: "assistant", content: [{ type: "output_text", text: "hello", annotations: [] }] },
                { type: "function_call", id: "fc-1", call_id: "call-1", name: "lookup", arguments: "{}" },
            ],
        },
    });
    assert.equal(terminal.value.filter((event) => event.type === "response.output_text.delta").length, 0);
    assert.equal(terminal.value.filter((event) => event.type === "response.function_call_arguments.delta").length, 0);
    const completed = terminal.value.find((event) => event.type === "response.completed");
    assert.ok(completed);
    assert.equal(JSON.stringify(completed).match(/hello/g)?.length, 1);
});
test("Responses stream emits refusal lifecycle events", async () => {
    const state = createResponseStreamState("chat_completions", "responses", { requestId: "refusal-stream" });
    const refusal = await convertStreamChunk(state, { id: "chat", choices: [{ delta: { refusal: "cannot" }, finish_reason: null }] });
    assert.equal(refusal.value.some((event) => event.type === "response.refusal.delta"), true);
    const end = await finalizeResponseStream(state, "stop");
    assert.equal(end.value.some((event) => event.type === "response.refusal.done"), true);
    assert.equal(end.value.some((event) => event.type === "response.completed"), true);
});
test("Anthropic stream joins tool input deltas to the content-block id", async () => {
    const state = createResponseStreamState("anthropic", "responses", { requestId: "anthropic-tool-id" });
    await convertStreamChunk(state, {
        type: "content_block_start", index: 0,
        content_block: { type: "tool_use", id: "tool-real", name: "lookup", input: {} },
    });
    await convertStreamChunk(state, {
        type: "content_block_delta", index: 0,
        delta: { type: "input_json_delta", partial_json: "{\"q\":\"x\"}" },
    });
    const terminal = await convertStreamChunk(state, {
        type: "message_delta", delta: { stop_reason: "tool_use" },
    });
    const completed = terminal.value.find((event) => event.type === "response.completed");
    assert.ok(completed);
    const call = completed.response.output.find((item) => item.type === "function_call");
    assert.equal(call?.call_id, "tool-real");
});
test("Anthropic stream keeps message_start usage before message_delta usage", async () => {
    const state = createResponseStreamState("anthropic", "responses", { requestId: "anthropic-usage" });
    await convertStreamChunk(state, {
        type: "message_start",
        message: { id: "msg-1", type: "message", role: "assistant", usage: { input_tokens: 11, cache_read_input_tokens: 3 } },
    });
    const end = await convertStreamChunk(state, {
        type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 },
    });
    const completed = end.value.find((event) => event.type === "response.completed");
    assert.ok(completed);
    const usage = completed.response.usage;
    assert.equal(usage.input_tokens, 11);
    assert.equal(usage.output_tokens, 5);
    assert.equal(usage.input_tokens_details && usage.input_tokens_details.cached_tokens, 3);
});
test("Responses annotation indexes advance from the previous annotation count", async () => {
    const state = createResponseStreamState("chat_completions", "responses", { requestId: "annotation-index" });
    const first = await convertStreamChunk(state, {
        id: "chat", choices: [{ delta: { content: "a", annotations: [{ type: "url_citation", url: "https://a.test" }] }, finish_reason: null }],
    });
    const second = await convertStreamChunk(state, {
        id: "chat", choices: [{ delta: { content: "b", annotations: [{ type: "url_citation", url: "https://b.test" }] }, finish_reason: null }],
    });
    const added = [...first.value, ...second.value].filter((event) => event.type === "response.output_text.annotation.added");
    assert.deepEqual(added.map((event) => event.annotation_index), [0, 1]);
});
test("Gemini stream forwards function-call thought signatures", async () => {
    const state = createResponseStreamState("gemini", "gemini", { requestId: "gemini-signature-stream" });
    await convertStreamChunk(state, {
        responseId: "g", candidates: [{ content: { parts: [{ functionCall: { name: "lookup", args: { q: "x" } }, thoughtSignature: "sig-g" }] } }],
    });
    const events = await finalizeResponseStream(state, "STOP");
    assert.equal(JSON.stringify(events.value).includes("sig-g"), true);
});
test("Anthropic signature-only thinking deltas survive streaming", async () => {
    const state = createResponseStreamState("anthropic", "responses", { requestId: "anthropic-signature-only" });
    await convertStreamChunk(state, {
        type: "content_block_start", index: 0,
        content_block: { type: "thinking", thinking: "plan" },
    });
    const signature = await convertStreamChunk(state, {
        type: "content_block_delta", index: 0,
        delta: { type: "signature_delta", signature: "sig-anthropic" },
    });
    assert.equal(signature.value.some((event) => event.type === "response.reasoning_summary_text.delta"), false);
    const end = await convertStreamChunk(state, { type: "message_delta", delta: { stop_reason: "end_turn" } });
    const completed = end.value.find((event) => event.type === "response.completed");
    assert.ok(completed);
    assert.equal(JSON.stringify(completed).includes("sig-anthropic"), true);
});
test("Gemini streamed function-call signatures use the Part-level field", async () => {
    const state = createResponseStreamState("gemini", "gemini", { requestId: "gemini-part-signature" });
    await convertStreamChunk(state, {
        responseId: "g", candidates: [{ content: { parts: [{ functionCall: { name: "lookup", args: { q: "x" } }, thoughtSignature: "sig-part" }] } }],
    });
    const end = await finalizeResponseStream(state, "STOP");
    const serialized = JSON.stringify(end.value);
    assert.equal(serialized.includes('"functionCall":{"name":"lookup","args":{"q":"x"}}'), true);
    assert.equal(serialized.includes('"thoughtSignature":"sig-part"'), true);
    assert.equal(serialized.includes('"functionCall":{"name":"lookup","args":{"q":"x"},"thoughtSignature"'), false);
});
//# sourceMappingURL=stream-state.test.js.map