import { asMediaPart } from "./media-resolver.js";
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value) {
    return typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value);
}
function callId(part) {
    if (!isObject(part.value))
        return "";
    return typeof part.value.call_id === "string"
        ? part.value.call_id
        : typeof part.value.tool_call_id === "string"
            ? part.value.tool_call_id
            : typeof part.value.tool_use_id === "string"
                ? part.value.tool_use_id
                : typeof part.value.id === "string" ? part.value.id
                    // Gemini functionCall/functionResponse items do not carry an id.
                    // The function name is the only stable pairing key available in
                    // that protocol, so use a namespaced fallback instead of treating
                    // every result as an orphan.
                    : typeof part.value.name === "string" ? `name:${part.value.name}` : "";
}
function callName(part) {
    return isObject(part.value) && typeof part.value.name === "string" ? part.value.name : "tool";
}
function callArgumentsValid(part) {
    if (!isObject(part.value))
        return false;
    const value = part.value.arguments;
    if (value === undefined)
        return true;
    if (typeof value !== "string")
        return isObject(value);
    if (!value.trim())
        return false;
    try {
        const parsed = JSON.parse(value);
        return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
    }
    catch {
        return false;
    }
}
function cloneMessage(message) {
    return { ...message, parts: message.parts.map((part) => ({ ...part, ...(isObject(part.value) ? { value: { ...part.value } } : {}) })) };
}
function isToolUse(part) { return part.type === "tool_use"; }
function isToolResult(message) {
    return message.role === "tool" || message.parts.some((part) => part.type === "tool_result");
}
function orphanAsUser(message) {
    const parts = message.parts.flatMap((part) => {
        if (part.type !== "tool_result" || !isObject(part.value)) {
            return [{ type: "text", value: `Tool result: ${text(part.value)}` }];
        }
        const output = part.value.output ?? part.value.content ?? "";
        const values = Array.isArray(output) ? output : [output];
        return values.map((value) => {
            const media = asMediaPart(value);
            return media ? { type: media.type, value, media } : { type: "text", value: `Tool result: ${text(value)}` };
        });
    });
    return { role: "user", parts: parts.length ? parts : [{ type: "text", value: "Tool result received without a resolvable preceding call." }] };
}
function splitEmbeddedToolResults(message) {
    const resultParts = message.parts.filter((part) => part.type === "tool_result");
    if (!resultParts.length || message.role === "tool")
        return [message];
    const nonResultParts = message.parts.filter((part) => part.type !== "tool_result");
    const result = [];
    if (nonResultParts.length)
        result.push({ ...message, parts: nonResultParts });
    // Anthropic can return several parallel tool_result blocks inside one user
    // message. Keep one canonical tool message per block so pairing, ordering,
    // duplicate detection, and synthetic completion remain call-id precise.
    result.push(...resultParts.map((part) => ({
        role: "tool",
        ...(message.name ? { name: message.name } : {}),
        parts: [part],
    })));
    return result;
}
/**
 * Canonical equivalent of Magpie's pairToolMessages and CC Switch's known
 * call-id repair. It runs before protocol encoding so every target encoder
 * sees the same valid tool exchange.
 */
export function normalizeCanonicalToolExchange(input) {
    const diagnostics = [];
    // Anthropic and Gemini encode tool results as content blocks on a user
    // message. Split those blocks into canonical tool messages before pairing
    // so every downstream protocol sees the same assistant -> tool exchange.
    const messages = input.flatMap((message) => splitEmbeddedToolResults(cloneMessage(message)));
    const output = [];
    for (let index = 0; index < messages.length;) {
        const current = messages[index];
        if (current.role !== "assistant") {
            if (isToolResult(current)) {
                diagnostics.push({ code: "orphan_tool_result", callId: current.parts[0] ? callId(current.parts[0]) : undefined, message: "Tool result without an immediately preceding assistant call was downgraded to user context." });
                output.push(orphanAsUser(current));
            }
            else {
                output.push(current);
            }
            index += 1;
            continue;
        }
        let assistant = current;
        let calls = assistant.parts.filter(isToolUse).filter((part) => {
            if (callArgumentsValid(part))
                return true;
            diagnostics.push({ code: "invalid_tool_call", callId: callId(part), message: "Malformed historical tool arguments were omitted from the callable tool turn." });
            return false;
        });
        if (calls.length !== assistant.parts.filter(isToolUse).length) {
            assistant = { ...assistant, parts: assistant.parts.filter((part) => !isToolUse(part) || calls.includes(part)) };
        }
        while (index + 1 < messages.length && messages[index + 1]?.role === "assistant") {
            const next = messages[index + 1];
            const nextCalls = next.parts.filter(isToolUse).filter((part) => {
                if (callArgumentsValid(part))
                    return true;
                diagnostics.push({ code: "invalid_tool_call", callId: callId(part), message: "Malformed historical tool arguments were omitted from the callable tool turn." });
                return false;
            });
            if (!nextCalls.length)
                break;
            calls = [...calls, ...nextCalls];
            assistant = { ...assistant, parts: [...assistant.parts.filter((part) => !isToolUse(part)), ...calls] };
            diagnostics.push({ code: "merged_assistant", message: "Adjacent assistant tool-call messages were merged." });
            index += 1;
        }
        if (!calls.length) {
            output.push(assistant);
            index += 1;
            continue;
        }
        output.push(assistant);
        const order = new Map(calls.map((part, position) => [callId(part), { part, position }]));
        const answered = new Set();
        const validResults = [];
        const orphans = [];
        let cursor = index + 1;
        while (cursor < messages.length && isToolResult(messages[cursor])) {
            const result = messages[cursor];
            const resultPart = result.parts.find((part) => part.type === "tool_result") ?? result.parts[0];
            const id = resultPart ? callId(resultPart) : "";
            const entry = id ? order.get(id) : undefined;
            if (!entry) {
                diagnostics.push({ code: "orphan_tool_result", callId: id || undefined, message: "Tool result did not match a pending call and was downgraded to user context." });
                orphans.push(result);
            }
            else if (answered.has(id)) {
                diagnostics.push({ code: "duplicate_tool_result", callId: id, message: "Duplicate tool result was dropped." });
            }
            else {
                answered.add(id);
                validResults.push({ message: { ...result, name: result.name ?? callName(entry.part) }, position: entry.position });
            }
            cursor += 1;
        }
        const validById = new Map(validResults.map(({ message }) => {
            const resultPart = message.parts.find((part) => part.type === "tool_result") ?? message.parts[0];
            return [resultPart ? callId(resultPart) : "", message];
        }));
        for (const call of calls) {
            const id = callId(call);
            const valid = validById.get(id);
            if (valid) {
                output.push(valid);
            }
            else {
                diagnostics.push({ code: "synthetic_tool_result", callId: id, message: "Missing tool result was synthesized to close an interrupted turn." });
                output.push({ role: "tool", name: callName(call), parts: [{ type: "tool_result", value: { call_id: id, output: "[The result of this tool call is unavailable: the turn was interrupted.]" } }] });
            }
        }
        output.push(...orphans.map(orphanAsUser));
        index = cursor;
    }
    return { messages: output, diagnostics };
}
//# sourceMappingURL=tool-exchange-normalizer.js.map