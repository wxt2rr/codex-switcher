// A gateway process can stay alive for weeks.  Keep the replay cache bounded
// by both response count and serialized payload size so a provider returning a
// large code/file/tool result cannot turn history into an unbounded memory or
// persistence sink.  These are safety ceilings, not context-window limits.
const MAX_HISTORY_ITEM_BYTES = 512 * 1024;
const MAX_HISTORY_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_HISTORY_ITEMS_PER_RESPONSE = 512;
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeStoredArguments(value, kind = "function") {
    if (typeof value === "string") {
        if (!value.trim())
            return undefined;
        if (kind === "custom")
            return value;
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? value : undefined;
        }
        catch {
            return undefined;
        }
    }
    return value && typeof value === "object" && !Array.isArray(value) ? JSON.stringify(value) : undefined;
}
function callItems(protocol, body) {
    const responseId = typeof body.id === "string" ? body.id : typeof body.responseId === "string" ? body.responseId : undefined;
    if (protocol === "responses") {
        const output = Array.isArray(body.output) ? body.output : [];
        return {
            responseId,
            calls: output.flatMap((raw) => {
                if (!isObject(raw) || typeof raw.call_id !== "string")
                    return [];
                if (raw.type === "function_call") {
                    const argumentsText = normalizeStoredArguments(raw.arguments, "function");
                    return argumentsText ? [{ id: raw.call_id, name: typeof raw.name === "string" ? raw.name : "tool", arguments: argumentsText, kind: "function", raw, ...(typeof raw.id === "string" ? { itemId: raw.id } : {}), ...(typeof raw.output_index === "number" ? { outputIndex: raw.output_index } : {}) }] : [];
                }
                if (raw.type === "custom_tool_call") {
                    const argumentsText = normalizeStoredArguments(raw.input, "custom");
                    return argumentsText ? [{ id: raw.call_id, name: typeof raw.name === "string" ? raw.name : "custom", arguments: argumentsText, kind: "custom", raw, ...(typeof raw.id === "string" ? { itemId: raw.id } : {}), ...(typeof raw.output_index === "number" ? { outputIndex: raw.output_index } : {}) }] : [];
                }
                if (raw.type === "tool_search_call") {
                    return [{ id: raw.call_id, name: typeof raw.name === "string" ? raw.name : "tool_search", arguments: JSON.stringify(raw.input ?? raw), kind: "tool_search", raw, ...(typeof raw.id === "string" ? { itemId: raw.id } : {}), ...(typeof raw.output_index === "number" ? { outputIndex: raw.output_index } : {}) }];
                }
                if (typeof raw.type === "string" && raw.type.endsWith("_call")) {
                    return [{ id: raw.call_id, name: typeof raw.name === "string" ? raw.name : raw.type, arguments: JSON.stringify(raw), kind: "hosted", raw, ...(typeof raw.id === "string" ? { itemId: raw.id } : {}), ...(typeof raw.output_index === "number" ? { outputIndex: raw.output_index } : {}) }];
                }
                return [];
            }),
        };
    }
    if (protocol === "chat_completions") {
        const choices = Array.isArray(body.choices) ? body.choices : [];
        const message = choices[0] && isObject(choices[0]) && isObject(choices[0].message) ? choices[0].message : undefined;
        if (!message)
            return { responseId, calls: [] };
        const calls = Array.isArray(message.tool_calls) ? message.tool_calls.flatMap((raw) => {
            if (!isObject(raw) || typeof raw.id !== "string" || !isObject(raw.function))
                return [];
            const argumentsText = normalizeStoredArguments(raw.function.arguments);
            return argumentsText ? [{ id: raw.id, name: typeof raw.function.name === "string" ? raw.function.name : "tool", arguments: argumentsText, kind: "function", raw }] : [];
        }) : isObject(message.function_call) ? (() => {
            const argumentsText = normalizeStoredArguments(message.function_call.arguments);
            return argumentsText ? [{ id: `call_${responseId ?? "unknown"}`, name: typeof message.function_call.name === "string" ? message.function_call.name : "tool", arguments: argumentsText, kind: "function", raw: message.function_call }] : [];
        })() : [];
        return { responseId, calls };
    }
    if (protocol === "anthropic") {
        const calls = Array.isArray(body.content) ? body.content.flatMap((raw) => {
            if (!isObject(raw) || raw.type !== "tool_use" || typeof raw.id !== "string")
                return [];
            const argumentsText = normalizeStoredArguments(raw.input, "function");
            return argumentsText ? [{ id: raw.id, name: typeof raw.name === "string" ? raw.name : "tool", arguments: argumentsText, kind: "function", raw }] : [];
        }) : [];
        return { responseId, calls };
    }
    if (protocol === "gemini") {
        const candidates = Array.isArray(body.candidates) ? body.candidates : [];
        // Gemini function calls do not require an id.  A name-only function
        // response is paired FIFO with calls of the same name, so the history
        // representation must assign the exact same deterministic ids as
        // `geminiPartsToResponses`.  Reusing `name:<tool>` for every parallel
        // call would collapse distinct calls during a Responses replay.
        const nameCounts = new Map();
        const calls = candidates.flatMap((candidate) => {
            if (!isObject(candidate) || !isObject(candidate.content) || !Array.isArray(candidate.content.parts))
                return [];
            return candidate.content.parts.flatMap((raw) => {
                if (!isObject(raw) || !isObject(raw.functionCall) || typeof raw.functionCall.name !== "string")
                    return [];
                const argumentsText = normalizeStoredArguments(raw.functionCall.args, "function");
                if (!argumentsText)
                    return [];
                const name = raw.functionCall.name;
                const count = nameCounts.get(name) ?? 0;
                nameCounts.set(name, count + 1);
                const id = typeof raw.functionCall.id === "string"
                    ? raw.functionCall.id
                    : `name:${name}${count ? `:${count}` : ""}`;
                return [{ id, name, arguments: argumentsText, kind: "function", raw: raw.functionCall, ...(typeof raw.thoughtSignature === "string" ? { signature: raw.thoughtSignature } : {}) }];
            });
        });
        return { responseId, calls };
    }
    return { responseId, calls: [] };
}
/** Session-scoped history for generic Gateway Responses→Chat conversion. */
export class ToolExchangeHistory {
    maxResponses;
    sessions = new Map();
    constructor(maxResponses = 512) {
        this.maxResponses = maxResponses;
    }
    snapshot() {
        return {
            sessions: Object.fromEntries([...this.sessions.entries()].map(([sessionId, session]) => [sessionId, Object.fromEntries(session.order.flatMap((responseId) => {
                    const calls = session.responses.get(responseId);
                    return calls ? [[responseId, calls.map((call) => ({ ...call }))]] : [];
                }))])),
            responseItems: Object.fromEntries([...this.sessions.entries()].flatMap(([sessionId, session]) => {
                const items = Object.fromEntries(session.order.flatMap((responseId) => {
                    const value = session.items.get(responseId);
                    return value?.length ? [[responseId, value.map((item) => cloneJson(item))]] : [];
                }));
                return Object.keys(items).length ? [[sessionId, items]] : [];
            })),
        };
    }
    load(snapshot) {
        if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
            return;
        const snapshotValue = snapshot;
        const sessions = snapshotValue.sessions;
        if (!sessions || typeof sessions !== "object" || Array.isArray(sessions))
            return;
        for (const [sessionId, rawResponses] of Object.entries(sessions)) {
            if (!rawResponses || typeof rawResponses !== "object" || Array.isArray(rawResponses))
                continue;
            const session = { responses: new Map(), items: new Map(), order: [] };
            for (const [responseId, rawCalls] of Object.entries(rawResponses)) {
                if (!Array.isArray(rawCalls))
                    continue;
                const calls = rawCalls.flatMap((raw) => {
                    if (!raw || typeof raw !== "object" || Array.isArray(raw))
                        return [];
                    const value = raw;
                    const kind = value.kind === "custom" || value.kind === "tool_search" || value.kind === "hosted" ? value.kind : "function";
                    const argumentsText = normalizeStoredArguments(value.arguments, kind);
                    return typeof value.id === "string" && typeof value.name === "string" && argumentsText
                        ? [{ id: value.id, name: value.name, arguments: argumentsText, kind, ...(typeof value.itemId === "string" ? { itemId: value.itemId } : {}), ...(typeof value.outputIndex === "number" ? { outputIndex: value.outputIndex } : {}), ...(typeof value.signature === "string" ? { signature: value.signature } : {}), ...(isObject(value.raw) ? { raw: value.raw } : {}) }]
                        : [];
                });
                if (calls.length) {
                    session.responses.set(responseId, calls);
                    session.order.push(responseId);
                }
            }
            const responseItems = snapshotValue.responseItems?.[sessionId];
            for (const [responseId, items] of Object.entries(responseItems ?? {}))
                if (Array.isArray(items) && items.length) {
                    // Snapshots can come from disk or an older process. Re-apply the same
                    // compaction and byte ceilings during load; otherwise an opaque
                    // encrypted item could be reintroduced after it was safely filtered
                    // on the write path.
                    const safeItems = safeHistoryItems(items);
                    if (!safeItems.length)
                        continue;
                    session.items.set(responseId, safeItems);
                    if (!session.order.includes(responseId)) {
                        session.responses.set(responseId, []);
                        session.order.push(responseId);
                    }
                }
            while (session.order.length > this.maxResponses) {
                const oldest = session.order.shift();
                if (oldest) {
                    session.responses.delete(oldest);
                    session.items.delete(oldest);
                }
            }
            if (session.order.length)
                this.sessions.set(sessionId, session);
        }
    }
    enrich(sessionId, protocol, body) {
        if (!sessionId || protocol !== "responses" || !Array.isArray(body.input))
            return body;
        const previousId = typeof body.previous_response_id === "string" ? body.previous_response_id : undefined;
        const session = this.sessions.get(sessionId);
        const previous = previousId ? session?.responses.get(previousId) : undefined;
        const previousItems = previousId ? session?.items.get(previousId) : undefined;
        const input = body.input;
        if (previousItems?.length) {
            const restoredItems = safeHistoryItems(previousItems);
            const seenIds = new Set(restoredItems.flatMap((item) => isObject(item) && typeof item.id === "string" ? [item.id] : []));
            const seenValues = new Set(restoredItems.map((item) => stableJson(item)));
            const currentItems = input.filter((item) => {
                if (isObject(item) && typeof item.id === "string" && seenIds.has(item.id))
                    return false;
                const value = stableJson(item);
                if (seenValues.has(value))
                    return false;
                seenValues.add(value);
                return true;
            });
            const next = { ...body, input: [...restoredItems, ...currentItems] };
            delete next.previous_response_id;
            return next;
        }
        const enriched = [];
        for (let index = 0; index < input.length;) {
            const current = input[index];
            if (!isObject(current) || typeof current.call_id !== "string" || typeof current.type !== "string" || !current.type.endsWith("_call_output")) {
                enriched.push(current);
                index += 1;
                continue;
            }
            const run = [];
            while (index < input.length) {
                const item = input[index];
                if (!isObject(item) || typeof item.call_id !== "string" || typeof item.type !== "string" || !item.type.endsWith("_call_output"))
                    break;
                run.push(item);
                index += 1;
            }
            const calls = run.flatMap((item) => {
                const call = previous?.find((candidate) => candidate.id === item.call_id);
                return call ? [call] : [];
            }).sort((left, right) => (previous?.findIndex((candidate) => candidate.id === left.id) ?? Number.MAX_SAFE_INTEGER) - (previous?.findIndex((candidate) => candidate.id === right.id) ?? Number.MAX_SAFE_INTEGER));
            enriched.push(...calls.map(storedCallToResponses));
            enriched.push(...run);
        }
        const next = { ...body, input: enriched };
        delete next.previous_response_id;
        return next;
    }
    record(sessionId, protocol, body) {
        if (!sessionId)
            return;
        const { responseId, calls } = callItems(protocol, body);
        const items = responseItems(protocol, body, calls);
        if (!responseId || (!calls.length && !items.length))
            return;
        if (calls.length)
            this.recordCalls(sessionId, responseId, calls);
        const session = this.sessions.get(sessionId) ?? { responses: new Map(), items: new Map(), order: [] };
        if (!session.responses.has(responseId)) {
            session.responses.set(responseId, []);
            session.order = session.order.filter((id) => id !== responseId);
            session.order.push(responseId);
        }
        if (items.length)
            session.items.set(responseId, safeHistoryItems(items));
        pruneSession(session, this.maxResponses);
        this.sessions.set(sessionId, session);
    }
    recordCalls(sessionId, responseId, calls) {
        if (!sessionId || !responseId || !calls.length)
            return;
        const safeCalls = calls.flatMap((call) => {
            const kind = call.kind ?? "function";
            const argumentsText = normalizeStoredArguments(call.arguments, kind);
            return argumentsText ? [{ ...call, kind, arguments: argumentsText }] : [];
        });
        if (!safeCalls.length)
            return;
        const session = this.sessions.get(sessionId) ?? { responses: new Map(), items: new Map(), order: [] };
        session.responses.set(responseId, safeCalls);
        session.order = session.order.filter((id) => id !== responseId);
        session.order.push(responseId);
        while (session.order.length > this.maxResponses) {
            const oldest = session.order.shift();
            if (oldest) {
                session.responses.delete(oldest);
                session.items.delete(oldest);
            }
        }
        this.sessions.set(sessionId, session);
    }
    /** Persist canonical Responses items produced by a streamed turn. */
    recordItems(sessionId, responseId, items) {
        if (!sessionId || !responseId || !items.length)
            return;
        const session = this.sessions.get(sessionId) ?? { responses: new Map(), items: new Map(), order: [] };
        if (!session.responses.has(responseId))
            session.responses.set(responseId, []);
        session.items.set(responseId, safeHistoryItems(items));
        session.order = session.order.filter((id) => id !== responseId);
        session.order.push(responseId);
        pruneSession(session, this.maxResponses);
        this.sessions.set(sessionId, session);
    }
    clear(sessionId) {
        if (sessionId)
            this.sessions.delete(sessionId);
        else
            this.sessions.clear();
    }
}
function pruneSession(session, maxResponses = 512) {
    while (session.order.length > maxResponses) {
        const oldest = session.order.shift();
        if (oldest) {
            session.responses.delete(oldest);
            session.items.delete(oldest);
        }
    }
}
function responseItems(protocol, body, calls) {
    if (protocol === "responses")
        return Array.isArray(body.output) ? body.output.filter((item) => item !== undefined).map(cloneJson) : calls.map(storedCallToResponses);
    if (protocol === "chat_completions") {
        const choice = Array.isArray(body.choices) && isObject(body.choices[0]) ? body.choices[0] : undefined;
        const message = choice && isObject(choice.message) ? choice.message : undefined;
        if (!message)
            return calls.map(storedCallToResponses);
        const items = [];
        if (typeof message.reasoning_content === "string" && message.reasoning_content)
            items.push({ type: "reasoning", summary: [{ type: "summary_text", text: message.reasoning_content }] });
        if (message.content)
            items.push({ type: "message", role: "assistant", content: chatContentToResponses(message.content, message.annotations) });
        // A few OpenAI-compatible providers return tool results in the response
        // message (rather than requiring them only in the next request). Keep
        // those results as first-class Responses items so a protocol switch does
        // not silently erase the completed tool exchange.
        if (Array.isArray(message.tool_results)) {
            for (const raw of message.tool_results) {
                if (!isObject(raw))
                    continue;
                const callId = typeof raw.tool_call_id === "string" ? raw.tool_call_id : typeof raw.call_id === "string" ? raw.call_id : undefined;
                if (!callId)
                    continue;
                items.push({
                    type: "function_call_output",
                    call_id: callId,
                    output: raw.output ?? raw.content ?? "",
                    ...(typeof raw.is_error === "boolean" ? { is_error: raw.is_error } : {}),
                });
            }
        }
        items.push(...calls.map(storedCallToResponses));
        return items;
    }
    if (protocol === "anthropic") {
        const items = [];
        if (Array.isArray(body.content)) {
            const content = body.content.filter((item) => item !== undefined).map(cloneJson);
            if (content.length)
                items.push({ type: "message", role: "assistant", content });
        }
        return items.length ? items : calls.map(storedCallToResponses);
    }
    if (protocol === "gemini") {
        const candidate = Array.isArray(body.candidates) && isObject(body.candidates[0]) ? body.candidates[0] : undefined;
        const content = candidate && isObject(candidate.content) ? candidate.content : undefined;
        if (content)
            return geminiPartsToResponses(content.parts);
    }
    return calls.map(storedCallToResponses);
}
function chatContentToResponses(value, annotations) {
    const parts = Array.isArray(value) ? value : [value];
    return parts.flatMap((raw) => {
        if (typeof raw === "string")
            return [{ type: "output_text", text: raw, ...(Array.isArray(annotations) ? { annotations } : {}) }];
        if (!isObject(raw))
            return [{ type: "output_text", text: JSON.stringify(raw) }];
        const type = typeof raw.type === "string" ? raw.type : "text";
        if (type === "text" || type === "input_text" || type === "output_text")
            return [{ type: "output_text", text: typeof raw.text === "string" ? raw.text : "", ...(Array.isArray(raw.annotations) ? { annotations: raw.annotations } : Array.isArray(annotations) ? { annotations } : {}) }];
        if (type === "image_url" || raw.image_url !== undefined)
            return [{ ...raw, type: "output_image" }];
        if (type === "file" || raw.file !== undefined)
            return [{ ...raw, type: "output_file" }];
        return [raw];
    });
}
function geminiPartsToResponses(value) {
    if (!Array.isArray(value))
        return [];
    const callsByName = new Map();
    const nameCounts = new Map();
    const result = [];
    const messageParts = [];
    const flushMessage = () => {
        if (!messageParts.length)
            return;
        result.push({ type: "message", role: "assistant", content: messageParts.splice(0) });
    };
    for (const raw of value) {
        if (!isObject(raw))
            continue;
        if (raw.thought === true) {
            flushMessage();
            result.push({ type: "reasoning", summary: [{ type: "summary_text", text: typeof raw.text === "string" ? raw.text : "", ...(typeof raw.thoughtSignature === "string" ? { signature: raw.thoughtSignature } : {}) }] });
            continue;
        }
        if (typeof raw.text === "string") {
            messageParts.push({ type: "output_text", text: raw.text });
            continue;
        }
        if (isObject(raw.inlineData)) {
            messageParts.push({ ...raw, type: "output_image" });
            continue;
        }
        if (isObject(raw.fileData)) {
            messageParts.push({ ...raw, type: "output_file" });
            continue;
        }
        if (isObject(raw.functionCall)) {
            flushMessage();
            const name = String(raw.functionCall.name ?? "tool");
            const count = nameCounts.get(name) ?? 0;
            nameCounts.set(name, count + 1);
            const callId = typeof raw.functionCall.id === "string"
                ? raw.functionCall.id
                : `name:${name}${count ? `:${count}` : ""}`;
            const queue = callsByName.get(name) ?? [];
            queue.push(callId);
            callsByName.set(name, queue);
            result.push({
                type: "function_call",
                call_id: callId,
                name,
                arguments: JSON.stringify(raw.functionCall.args ?? {}),
                ...(typeof raw.thoughtSignature === "string" ? { thought_signature: raw.thoughtSignature } : {}),
            });
            continue;
        }
        if (isObject(raw.functionResponse)) {
            flushMessage();
            const name = typeof raw.functionResponse.name === "string" ? raw.functionResponse.name : "tool";
            const explicitId = typeof raw.functionResponse.id === "string"
                ? raw.functionResponse.id
                : typeof raw.functionResponse.call_id === "string" ? raw.functionResponse.call_id : undefined;
            const queue = callsByName.get(name) ?? [];
            const callId = explicitId ?? queue.shift() ?? `name:${name}`;
            callsByName.set(name, queue);
            result.push({
                type: "function_call_output",
                call_id: callId,
                output: raw.functionResponse.response ?? {},
                ...(typeof raw.functionResponse.isError === "boolean" ? { is_error: raw.functionResponse.isError } : {}),
            });
            continue;
        }
        messageParts.push(raw);
    }
    flushMessage();
    return result;
}
function cloneJson(value) {
    if (Array.isArray(value))
        return value.map(cloneJson);
    if (isObject(value))
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneJson(child)]));
    return value;
}
function stableJson(value) {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(",")}]`;
    if (isObject(value))
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
}
/** Keep history replayable while never persisting opaque encrypted compaction. */
function safeHistoryItems(items) {
    let totalBytes = 0;
    const result = [];
    for (const item of items) {
        if (result.length >= MAX_HISTORY_ITEMS_PER_RESPONSE)
            break;
        if (!isObject(item)) {
            const cloned = cloneJson(item);
            const bytes = Buffer.byteLength(JSON.stringify(cloned), "utf8");
            if (bytes <= MAX_HISTORY_ITEM_BYTES && totalBytes + bytes <= MAX_HISTORY_TOTAL_BYTES) {
                totalBytes += bytes;
                result.push(cloned);
            }
            continue;
        }
        const type = typeof item.type === "string" ? item.type : "";
        if (type === "compaction" || type === "compaction_summary") {
            const summary = typeof item.summary === "string" ? item.summary : typeof item.content === "string" ? item.content : typeof item.text === "string" ? item.text : "";
            if (!summary.trim())
                continue;
            const compacted = { type, summary: summary.trim() };
            const bytes = Buffer.byteLength(JSON.stringify(compacted), "utf8");
            if (bytes > MAX_HISTORY_ITEM_BYTES || totalBytes + bytes > MAX_HISTORY_TOTAL_BYTES)
                continue;
            totalBytes += bytes;
            result.push(compacted);
            continue;
        }
        const cloned = cloneJson(item);
        const bytes = Buffer.byteLength(JSON.stringify(cloned), "utf8");
        if (bytes > MAX_HISTORY_ITEM_BYTES || totalBytes + bytes > MAX_HISTORY_TOTAL_BYTES)
            continue;
        totalBytes += bytes;
        result.push(cloned);
    }
    return result;
}
export function storedCallToResponses(call) {
    const location = { ...(call.itemId ? { id: call.itemId } : {}), ...(call.outputIndex !== undefined ? { output_index: call.outputIndex } : {}) };
    if (call.kind === "custom")
        return { type: "custom_tool_call", ...location, call_id: call.id, name: call.name, input: call.arguments, ...(call.signature ? { thought_signature: call.signature } : {}) };
    if (call.kind === "tool_search")
        return call.raw ? { ...call.raw, ...location, call_id: call.id } : { type: "tool_search_call", ...location, call_id: call.id, name: call.name, input: call.arguments };
    if (call.kind === "hosted" && call.raw)
        return { ...call.raw, ...location, call_id: call.id };
    return { type: "function_call", ...location, call_id: call.id, name: call.name, arguments: call.arguments, ...(call.signature ? { thought_signature: call.signature } : {}) };
}
/**
 * Reconstruct history from canonical stream events without regrouping all
 * assistant text/media into one item. A provider may interleave message
 * content, reasoning, calls and results; keeping an item-level boundary at
 * each kind transition is what lets a later `previous_response_id` replay
 * preserve the same executable turn.
 */
export function buildStreamHistory(events) {
    const items = [];
    const order = [];
    const messages = [];
    const reasonings = [];
    const calls = new Map();
    const results = [];
    let activeMessage;
    let activeReasoning;
    const flushMessage = () => {
        if (!activeMessage)
            return;
        const index = messages.indexOf(activeMessage);
        if (index >= 0 && activeMessage.content.length)
            order.push({ kind: "message", index });
        activeMessage = undefined;
    };
    const flushReasoning = () => {
        if (!activeReasoning)
            return;
        const index = reasonings.indexOf(activeReasoning);
        if (index >= 0 && (activeReasoning.text || activeReasoning.signature))
            order.push({ kind: "reasoning", index });
        activeReasoning = undefined;
    };
    const ensureMessage = (itemId, outputIndex) => {
        if (activeMessage && ((itemId !== undefined && activeMessage.itemId !== undefined && itemId !== activeMessage.itemId)
            || (outputIndex !== undefined && activeMessage.outputIndex !== undefined && outputIndex !== activeMessage.outputIndex)))
            flushMessage();
        if (!activeMessage) {
            activeMessage = { content: [], ...(itemId ? { itemId } : {}), ...(outputIndex !== undefined ? { outputIndex } : {}) };
            messages.push(activeMessage);
        }
        activeMessage.itemId ??= itemId;
        activeMessage.outputIndex ??= outputIndex;
        return activeMessage;
    };
    const ensureReasoning = (itemId, outputIndex) => {
        if (activeReasoning && ((itemId !== undefined && activeReasoning.itemId !== undefined && itemId !== activeReasoning.itemId)
            || (outputIndex !== undefined && activeReasoning.outputIndex !== undefined && outputIndex !== activeReasoning.outputIndex)))
            flushReasoning();
        if (!activeReasoning) {
            activeReasoning = { text: "", ...(itemId ? { itemId } : {}), ...(outputIndex !== undefined ? { outputIndex } : {}) };
            reasonings.push(activeReasoning);
        }
        activeReasoning.itemId ??= itemId;
        activeReasoning.outputIndex ??= outputIndex;
        return activeReasoning;
    };
    for (const event of events) {
        if (event.type === "text_delta") {
            flushReasoning();
            const message = ensureMessage(event.itemId, event.outputIndex);
            if (event.refusal) {
                const previous = message.content.at(-1);
                if (isObject(previous) && previous.type === "refusal")
                    previous.refusal = `${typeof previous.refusal === "string" ? previous.refusal : ""}${event.refusal}`;
                else
                    message.content.push({ type: "refusal", refusal: event.refusal });
            }
            if (event.text) {
                const previous = message.content.at(-1);
                if (isObject(previous) && previous.type === "output_text") {
                    previous.text = `${typeof previous.text === "string" ? previous.text : ""}${event.text}`;
                    if (event.annotations?.length)
                        previous.annotations = [...(Array.isArray(previous.annotations) ? previous.annotations : []), ...event.annotations];
                }
                else
                    message.content.push({ type: "output_text", text: event.text, annotations: event.annotations ?? [] });
            }
            else if (event.annotations?.length) {
                const previous = message.content.at(-1);
                if (isObject(previous) && previous.type === "output_text")
                    previous.annotations = [...(Array.isArray(previous.annotations) ? previous.annotations : []), ...event.annotations];
            }
            continue;
        }
        if (event.type === "media") {
            flushReasoning();
            const message = ensureMessage(event.itemId, event.outputIndex);
            message.content.push({ ...event.media, type: event.mediaType === "image" ? "output_image" : "output_file" });
            continue;
        }
        if (event.type === "reasoning_delta") {
            flushMessage();
            const reasoning = ensureReasoning(event.itemId, event.outputIndex);
            reasoning.text += event.text;
            reasoning.signature ??= event.signature;
            reasoning.encryptedContent ??= event.encryptedContent;
            continue;
        }
        if (event.type === "tool_call_delta") {
            flushMessage();
            flushReasoning();
            const existing = calls.get(event.callId) ?? { id: event.callId, name: event.name ?? "tool", arguments: "", kind: event.kind, raw: event.raw, itemId: event.itemId, outputIndex: event.outputIndex, signature: event.signature };
            if (event.name)
                existing.name = event.name;
            existing.kind ??= event.kind;
            existing.raw ??= event.raw;
            existing.itemId ??= event.itemId;
            existing.outputIndex ??= event.outputIndex;
            existing.signature ??= event.signature;
            if (event.argumentsFinal) {
                // Providers differ on whether the final event repeats the complete
                // JSON document or only carries the last fragment. Prefer a complete
                // final payload, otherwise append the fragment to the buffered
                // prefix. This keeps interrupted/ resumed turns executable in both
                // dialects without duplicating a repeated final document.
                const finalValue = event.argumentsDelta ?? "";
                existing.arguments = normalizeStoredArguments(finalValue, existing.kind)
                    ? finalValue
                    : existing.arguments + finalValue;
            }
            else {
                existing.arguments += event.argumentsDelta ?? "";
            }
            calls.set(event.callId, existing);
            if (!order.some((entry) => entry.kind === "call" && entry.id === event.callId))
                order.push({ kind: "call", id: event.callId });
            continue;
        }
        if (event.type === "tool_result") {
            flushMessage();
            flushReasoning();
            const result = {
                ...(event.raw ?? {}),
                type: event.kind === "custom" ? "custom_tool_call_output" : event.kind === "tool_search" && event.raw?.type === "tool_search_output" ? "tool_search_output" : event.kind === "tool_search" ? "tool_search_call_output" : "function_call_output",
                ...(event.itemId ? { id: event.itemId } : {}),
                ...(event.outputIndex !== undefined ? { output_index: event.outputIndex } : {}),
                call_id: event.callId,
                ...(event.name ? { name: event.name } : {}),
                output: event.output,
                ...(event.isError !== undefined ? { is_error: event.isError } : {}),
            };
            const index = results.push(result) - 1;
            order.push({ kind: "result", index, id: event.callId });
        }
    }
    flushMessage();
    flushReasoning();
    const result = [];
    for (const entry of order) {
        if (entry.kind === "message" && entry.index !== undefined) {
            const message = messages[entry.index];
            if (message?.content.length)
                result.push({ type: "message", ...(message.itemId ? { id: message.itemId } : {}), ...(message.outputIndex !== undefined ? { output_index: message.outputIndex } : {}), role: "assistant", content: message.content });
        }
        else if (entry.kind === "reasoning" && entry.index !== undefined) {
            const reasoning = reasonings[entry.index];
            if (reasoning && (reasoning.text || reasoning.signature || reasoning.encryptedContent))
                result.push({ type: "reasoning", ...(reasoning.itemId ? { id: reasoning.itemId } : {}), ...(reasoning.outputIndex !== undefined ? { output_index: reasoning.outputIndex } : {}), summary: [{ type: "summary_text", text: reasoning.text, ...(reasoning.signature ? { signature: reasoning.signature } : {}) }], ...(reasoning.encryptedContent ? { encrypted_content: reasoning.encryptedContent } : {}) });
        }
        else if (entry.kind === "call" && entry.id) {
            const call = calls.get(entry.id);
            const argumentsText = call ? normalizeStoredArguments(call.arguments, call.kind) : undefined;
            if (call && argumentsText)
                result.push(storedCallToResponses({ ...call, arguments: argumentsText }));
        }
        else if (entry.kind === "result" && entry.index !== undefined && results[entry.index]) {
            result.push(results[entry.index]);
        }
    }
    const validCalls = [...calls.values()].flatMap((call) => {
        const argumentsText = normalizeStoredArguments(call.arguments, call.kind);
        return argumentsText ? [{ ...call, arguments: argumentsText }] : [];
    });
    return { items: result, calls: validCalls };
}
//# sourceMappingURL=tool-exchange-history.js.map