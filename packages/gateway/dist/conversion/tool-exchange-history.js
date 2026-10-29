function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeStoredArguments(value) {
    if (typeof value === "string") {
        if (!value.trim())
            return undefined;
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
                if (!isObject(raw) || raw.type !== "function_call" || typeof raw.call_id !== "string")
                    return [];
                const argumentsText = normalizeStoredArguments(raw.arguments);
                return argumentsText ? [{ id: raw.call_id, name: typeof raw.name === "string" ? raw.name : "tool", arguments: argumentsText }] : [];
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
            return argumentsText ? [{ id: raw.id, name: typeof raw.function.name === "string" ? raw.function.name : "tool", arguments: argumentsText }] : [];
        }) : isObject(message.function_call) ? (() => {
            const argumentsText = normalizeStoredArguments(message.function_call.arguments);
            return argumentsText ? [{ id: `call_${responseId ?? "unknown"}`, name: typeof message.function_call.name === "string" ? message.function_call.name : "tool", arguments: argumentsText }] : [];
        })() : [];
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
        };
    }
    load(snapshot) {
        if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
            return;
        const sessions = snapshot.sessions;
        if (!sessions || typeof sessions !== "object" || Array.isArray(sessions))
            return;
        for (const [sessionId, rawResponses] of Object.entries(sessions)) {
            if (!rawResponses || typeof rawResponses !== "object" || Array.isArray(rawResponses))
                continue;
            const session = { responses: new Map(), order: [] };
            for (const [responseId, rawCalls] of Object.entries(rawResponses)) {
                if (!Array.isArray(rawCalls))
                    continue;
                const calls = rawCalls.flatMap((raw) => {
                    if (!raw || typeof raw !== "object" || Array.isArray(raw))
                        return [];
                    const value = raw;
                    const argumentsText = normalizeStoredArguments(value.arguments);
                    return typeof value.id === "string" && typeof value.name === "string" && argumentsText
                        ? [{ id: value.id, name: value.name, arguments: argumentsText }]
                        : [];
                });
                if (calls.length) {
                    session.responses.set(responseId, calls);
                    session.order.push(responseId);
                }
            }
            while (session.order.length > this.maxResponses) {
                const oldest = session.order.shift();
                if (oldest)
                    session.responses.delete(oldest);
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
        const input = body.input;
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
            enriched.push(...calls.map((call) => ({ type: "function_call", call_id: call.id, name: call.name, arguments: call.arguments })));
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
        if (!responseId || !calls.length)
            return;
        this.recordCalls(sessionId, responseId, calls);
    }
    recordCalls(sessionId, responseId, calls) {
        if (!sessionId || !responseId || !calls.length)
            return;
        const safeCalls = calls.flatMap((call) => {
            const argumentsText = normalizeStoredArguments(call.arguments);
            return argumentsText ? [{ ...call, arguments: argumentsText }] : [];
        });
        if (!safeCalls.length)
            return;
        const session = this.sessions.get(sessionId) ?? { responses: new Map(), order: [] };
        session.responses.set(responseId, safeCalls);
        session.order = session.order.filter((id) => id !== responseId);
        session.order.push(responseId);
        while (session.order.length > this.maxResponses) {
            const oldest = session.order.shift();
            if (oldest)
                session.responses.delete(oldest);
        }
        this.sessions.set(sessionId, session);
    }
    clear(sessionId) {
        if (sessionId)
            this.sessions.delete(sessionId);
        else
            this.sessions.clear();
    }
}
//# sourceMappingURL=tool-exchange-history.js.map