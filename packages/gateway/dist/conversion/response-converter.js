import { planConversion } from "./formats.js";
import { decodeUsage, encodeUsage } from "./usage.js";
export function decodeResponseEvents(protocol, body) {
    const events = [{ type: "message_start", responseId: responseId(protocol, body), role: "assistant" }];
    const rawError = isObject(body.error) ? body.error : undefined;
    if (rawError) {
        events.push({ type: "error", code: asString(rawError.code) ?? asString(rawError.type) ?? "upstream_error", message: asString(rawError.message) ?? "The upstream request failed", retryable: false });
    }
    else if (protocol === "responses")
        decodeResponses(body, events);
    else if (protocol === "chat_completions")
        decodeChat(body, events);
    else if (protocol === "anthropic")
        decodeAnthropic(body, events);
    else
        decodeGemini(body, events);
    const usage = decodeUsage(protocol, body) ?? (isObject(body.response) ? decodeUsage(protocol, body.response) : undefined);
    if (usage)
        events.push({ type: "usage", usage });
    if (!events.some((event) => event.type === "message_end" || event.type === "error"))
        events.push({ type: "message_end" });
    return events;
}
export function encodeResponseEvents(protocol, events, metadata = {}) {
    const error = events.find((event) => event.type === "error");
    if (error)
        return encodeError(protocol, error);
    const response = collectResponse(events, metadata);
    const model = metadata.upstreamModelName ?? metadata.originModelName;
    if (protocol === "responses") {
        const output = [];
        if (response.text)
            output.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: response.text }] });
        if (response.reasoning)
            output.push({ type: "reasoning", content: [{ type: "reasoning_text", text: response.reasoning }] });
        for (const call of response.toolCalls)
            output.push({ type: "function_call", call_id: call.callId, name: call.name ?? "tool", arguments: call.arguments });
        return { id: response.responseId, object: "response", ...(model ? { model } : {}), status: "completed", output, ...(response.endReason ? { incomplete_details: { reason: response.endReason } } : {}), usage: encodeUsage(protocol, response.usage) };
    }
    if (protocol === "chat_completions") {
        const message = { role: "assistant", content: response.text || null };
        if (response.reasoning)
            message.reasoning_content = response.reasoning;
        if (response.toolCalls.length)
            message.tool_calls = response.toolCalls.map((call) => ({ id: call.callId, type: "function", function: { name: call.name ?? "tool", arguments: call.arguments } }));
        return { id: response.responseId, object: "chat.completion", ...(model ? { model } : {}), choices: [{ index: 0, message, finish_reason: response.toolCalls.length ? "tool_calls" : response.endReason ?? "stop" }], usage: encodeUsage(protocol, response.usage) };
    }
    if (protocol === "anthropic") {
        const content = [];
        if (response.reasoning)
            content.push({ type: "thinking", thinking: response.reasoning });
        if (response.text)
            content.push({ type: "text", text: response.text });
        for (const call of response.toolCalls)
            content.push({ type: "tool_use", id: call.callId, name: call.name ?? "tool", input: parseJsonObject(call.arguments) });
        return { id: response.responseId, type: "message", role: "assistant", ...(model ? { model } : {}), content, stop_reason: response.toolCalls.length ? "tool_use" : response.endReason ?? "end_turn", usage: encodeUsage(protocol, response.usage) };
    }
    const parts = [];
    if (response.reasoning)
        parts.push({ text: response.reasoning, thought: true });
    if (response.text)
        parts.push({ text: response.text });
    for (const call of response.toolCalls)
        parts.push({ functionCall: { name: call.name ?? "tool", args: parseJsonObject(call.arguments) } });
    return { responseId: response.responseId, ...(model ? { model } : {}), candidates: [{ content: { role: "model", parts }, finishReason: response.toolCalls.length ? "STOP" : response.endReason ?? "STOP" }], usageMetadata: encodeUsage(protocol, response.usage) };
}
export async function convertGatewayResponse(source, target, body, metadata = {}, _options = {}) {
    const path = planConversion(source, target);
    const events = decodeResponseEvents(source, body);
    const value = encodeResponseEvents(target, events, metadata);
    const usage = decodeUsage(source, body) ?? (isObject(body.response) ? decodeUsage(source, body.response) : undefined);
    return { value, from: source, to: target, converterId: path.steps.map((step) => step.id).join("/"), quality: path.quality, steps: path.steps, diagnostics: [], ...(usage ? { usage: encodeUsage(target, usage) } : {}) };
}
function decodeResponses(body, events) {
    const eventType = asString(body.type);
    if (eventType === "response.output_text.delta") {
        events.push({ type: "text_delta", text: asString(body.delta) ?? "" });
        return;
    }
    if (eventType === "response.reasoning_summary_text.delta" || eventType === "response.reasoning_text.delta") {
        events.push({ type: "reasoning_delta", text: asString(body.delta) ?? "" });
        return;
    }
    if (eventType === "response.function_call_arguments.delta") {
        events.push({ type: "tool_call_delta", callId: asString(body.call_id) ?? asString(body.item_id) ?? "call", name: asString(body.name), argumentsDelta: asString(body.delta) ?? "" });
        return;
    }
    if (eventType === "response.completed" || eventType === "response.incomplete") {
        events.push({ type: "message_end", reason: eventType === "response.incomplete" ? "incomplete" : "stop" });
        return;
    }
    if (eventType === "response.failed") {
        const error = isObject(body.error) ? body.error : isObject(body.response) && isObject(body.response.error) ? body.response.error : {};
        events.push({ type: "error", code: asString(error.code) ?? "upstream_error", message: asString(error.message) ?? "The Responses upstream failed", retryable: false });
        return;
    }
    const output = Array.isArray(body.output) ? body.output : [];
    for (const item of output) {
        if (!isObject(item))
            continue;
        const type = asString(item.type);
        if (type === "message") {
            for (const part of array(item.content))
                decodeContentPart(part, events);
        }
        else if (type === "reasoning") {
            for (const part of [...array(item.content), ...array(item.summary)]) {
                if (isObject(part) && asString(part.text ?? part.reasoning_text))
                    events.push({ type: "reasoning_delta", text: asString(part.text ?? part.reasoning_text) ?? "" });
            }
        }
        else if (type === "function_call") {
            events.push({ type: "tool_call_delta", callId: asString(item.call_id) ?? "call", name: asString(item.name), argumentsDelta: asString(item.arguments) ?? "" });
        }
    }
    events.push({ type: "message_end", reason: asString(body.status) === "incomplete" ? "incomplete" : undefined });
}
function decodeChat(body, events) {
    const choice = Array.isArray(body.choices) && isObject(body.choices[0]) ? body.choices[0] : undefined;
    const message = choice && isObject(choice.message) ? choice.message : choice && isObject(choice.delta) ? choice.delta : undefined;
    if (message) {
        decodeContentPart(message.content, events);
        if (asString(message.reasoning_content))
            events.push({ type: "reasoning_delta", text: asString(message.reasoning_content) ?? "" });
        if (asString(message.reasoning))
            events.push({ type: "reasoning_delta", text: asString(message.reasoning) ?? "" });
        for (const call of array(message.tool_calls))
            if (isObject(call) && isObject(call.function))
                events.push({ type: "tool_call_delta", callId: asString(call.id) ?? "call", name: asString(call.function.name), argumentsDelta: asString(call.function.arguments) ?? "" });
    }
    const finish = choice ? asString(choice.finish_reason) : undefined;
    events.push({ type: "message_end", ...(finish ? { reason: finish } : {}) });
}
function decodeAnthropic(body, events) {
    const eventType = asString(body.type);
    if (eventType === "content_block_delta" && isObject(body.delta)) {
        const deltaType = asString(body.delta.type);
        if (deltaType === "text_delta")
            events.push({ type: "text_delta", text: asString(body.delta.text) ?? "" });
        else if (deltaType === "thinking_delta")
            events.push({ type: "reasoning_delta", text: asString(body.delta.thinking) ?? "" });
        else if (deltaType === "input_json_delta")
            events.push({ type: "tool_call_delta", callId: typeof body.index === "number" ? String(body.index) : asString(body.index) ?? "call", argumentsDelta: asString(body.delta.partial_json) ?? "" });
        return;
    }
    if (eventType === "content_block_start" && isObject(body.content_block)) {
        const block = body.content_block;
        if (asString(block.type) === "tool_use")
            events.push({ type: "tool_call_delta", callId: asString(block.id) ?? "call", name: asString(block.name), argumentsDelta: "" });
        return;
    }
    if (eventType === "message_delta") {
        const delta = isObject(body.delta) ? body.delta : {};
        const stopReason = asString(delta.stop_reason) ?? asString(body.stop_reason);
        if (stopReason)
            events.push({ type: "message_end", reason: stopReason });
        return;
    }
    if (eventType === "message_stop") {
        events.push({ type: "message_end", reason: "stop" });
        return;
    }
    for (const part of array(body.content)) {
        if (!isObject(part))
            continue;
        const type = asString(part.type);
        if (type === "thinking")
            events.push({ type: "reasoning_delta", text: asString(part.thinking) ?? "" });
        else if (type === "tool_use")
            events.push({ type: "tool_call_delta", callId: asString(part.id) ?? "call", name: asString(part.name), argumentsDelta: JSON.stringify(part.input ?? {}) });
        else
            decodeContentPart(part, events);
    }
    events.push({ type: "message_end", ...(asString(body.stop_reason) ? { reason: asString(body.stop_reason) } : {}) });
}
function decodeGemini(body, events) {
    const candidate = Array.isArray(body.candidates) && isObject(body.candidates[0]) ? body.candidates[0] : undefined;
    const content = candidate && isObject(candidate.content) ? candidate.content : undefined;
    for (const part of content ? array(content.parts) : []) {
        if (!isObject(part))
            continue;
        if (part.thought === true)
            events.push({ type: "reasoning_delta", text: asString(part.text) ?? "" });
        else if (isObject(part.functionCall))
            events.push({ type: "tool_call_delta", callId: asString(part.functionCall.id) ?? "call", name: asString(part.functionCall.name), argumentsDelta: JSON.stringify(part.functionCall.args ?? {}) });
        else
            decodeContentPart(part, events);
    }
    events.push({ type: "message_end", ...(candidate && asString(candidate.finishReason) ? { reason: asString(candidate.finishReason) } : {}) });
}
function decodeContentPart(value, events) {
    if (typeof value === "string") {
        events.push({ type: "text_delta", text: value });
        return;
    }
    if (Array.isArray(value)) {
        for (const part of value)
            decodeContentPart(part, events);
        return;
    }
    if (!isObject(value))
        return;
    const text = asString(value.text ?? value.output_text ?? value.input_text);
    if (text !== undefined)
        events.push({ type: "text_delta", text });
}
function collectResponse(events, metadata) {
    const first = events.find((event) => event.type === "message_start");
    const result = { responseId: first?.responseId ?? metadata.requestId ?? "response", text: "", reasoning: "", toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
    const calls = new Map();
    for (const event of events) {
        if (event.type === "text_delta")
            result.text += event.text;
        else if (event.type === "reasoning_delta")
            result.reasoning += event.text;
        else if (event.type === "tool_call_delta") {
            const call = calls.get(event.callId) ?? { callId: event.callId, name: event.name, arguments: "" };
            call.name ??= event.name;
            call.arguments += event.argumentsDelta ?? "";
            calls.set(event.callId, call);
        }
        else if (event.type === "usage")
            result.usage = event.usage;
        else if (event.type === "message_end")
            result.endReason = event.reason;
    }
    result.toolCalls = [...calls.values()];
    return result;
}
function encodeError(protocol, error) {
    if (protocol === "anthropic")
        return { type: "error", error: { type: error.code, message: error.message } };
    if (protocol === "gemini")
        return { error: { code: error.code, message: error.message, status: "FAILED" } };
    return { error: { code: error.code, message: error.message, type: "gateway_error" } };
}
function parseJsonObject(value) { try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : {};
}
catch {
    return {};
} }
function responseId(protocol, body) {
    if (isObject(body.response))
        return asString(body.response.id) ?? asString(body.id) ?? `${protocol}-response`;
    return asString(body.id) ?? asString(body.responseId) ?? `${protocol}-response`;
}
function array(value) { return Array.isArray(value) ? value : []; }
function isObject(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function asString(value) { return typeof value === "string" ? value : undefined; }
//# sourceMappingURL=response-converter.js.map