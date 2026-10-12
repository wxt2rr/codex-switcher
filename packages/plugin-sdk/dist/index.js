import { createInterface } from "node:readline";
/**
 * Starts the stable newline-delimited RPC server used by Codex Switcher.
 * Plugins are ordinary Node/Bun processes and can be authored without a
 * dependency on the desktop or gateway implementation.
 */
export function startCswPluginServer(plugin, options = {}) {
    const input = options.input ?? process.stdin;
    const output = options.output ?? process.stdout;
    const readline = createInterface({ input });
    let closed = false;
    const send = (response) => {
        if (closed)
            return;
        output.write(`${JSON.stringify(response)}\n`);
    };
    const fail = (request, error) => {
        const message = error instanceof Error ? error.message : String(error);
        send({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message } });
        options.onError?.(error);
    };
    const handle = async (request) => {
        try {
            const params = request.params ?? {};
            switch (request.method) {
                case "plugin.describe":
                    send({ jsonrpc: "2.0", id: request.id, result: {
                            kinds: [
                                ...(plugin.provider ? ["provider"] : []),
                                ...(plugin.middleware ? ["middleware"] : []),
                            ],
                        } });
                    return;
                case "provider.describe":
                    if (!plugin.provider)
                        throw new Error("Provider capability is not installed");
                    send({ jsonrpc: "2.0", id: request.id, result: { provider: await plugin.provider.describe() } });
                    return;
                case "provider.models":
                    if (!plugin.provider?.models)
                        throw new Error("Provider model discovery is not implemented");
                    send({ jsonrpc: "2.0", id: request.id, result: { models: await plugin.provider.models({
                                account: requireAccount(params.account),
                                ...(typeof params.secret === "string" ? { secret: params.secret } : {}),
                                secretRef: requireString(params.secretRef, "secretRef"),
                                ...(isRecord(params.settings) ? { settings: params.settings } : {}),
                            }) } });
                    return;
                case "provider.quota":
                    if (!plugin.provider?.quota) {
                        send({ jsonrpc: "2.0", id: request.id, result: null });
                        return;
                    }
                    send({ jsonrpc: "2.0", id: request.id, result: await plugin.provider.quota({
                            account: requireAccount(params.account),
                            ...(typeof params.secret === "string" ? { secret: params.secret } : {}),
                            secretRef: requireString(params.secretRef, "secretRef"),
                            ...(isRecord(params.settings) ? { settings: params.settings } : {}),
                        }) });
                    return;
                case "provider.refresh":
                    if (!plugin.provider?.refresh)
                        throw new Error("Provider token refresh is not implemented");
                    send({ jsonrpc: "2.0", id: request.id, result: await plugin.provider.refresh({
                            account: requireAccount(params.account),
                            refreshToken: requireString(params.refreshToken, "refreshToken"),
                            ...(isRecord(params.settings) ? { settings: params.settings } : {}),
                        }) });
                    return;
                case "provider.revoke":
                    if (plugin.provider?.revoke)
                        await plugin.provider.revoke({
                            account: requireAccount(params.account),
                            ...(typeof params.secret === "string" ? { secret: params.secret } : {}),
                            ...(isRecord(params.settings) ? { settings: params.settings } : {}),
                        });
                    send({ jsonrpc: "2.0", id: request.id, result: null });
                    return;
                case "provider.request":
                    if (!plugin.provider?.request)
                        throw new Error("Provider custom request handling is not implemented");
                    send({ jsonrpc: "2.0", id: request.id, result: await plugin.provider.request({
                            account: requireAccount(params.account),
                            secret: requireString(params.secret, "secret"),
                            protocol: requireProtocol(params.protocol),
                            url: requireString(params.url, "url"),
                            method: requireString(params.method, "method"),
                            headers: requireHeaders(params.headers),
                            ...(typeof params.body === "string" ? { body: params.body } : {}),
                            ...(isRecord(params.settings) ? { settings: params.settings } : {}),
                        }) });
                    return;
                case "middleware.describe":
                    if (!plugin.middleware)
                        throw new Error("Middleware capability is not installed");
                    send({ jsonrpc: "2.0", id: request.id, result: { middleware: await plugin.middleware.describe() } });
                    return;
                case "middleware.onRequest":
                    send({ jsonrpc: "2.0", id: request.id, result: await plugin.middleware?.onRequest?.({ body: requireObject(params.body, "body"), context: requireContext(params.context) }) });
                    return;
                case "middleware.onEvent":
                    send({ jsonrpc: "2.0", id: request.id, result: await plugin.middleware?.onEvent?.({ event: requireObject(params.event, "event"), context: requireContext(params.context) }) });
                    return;
                case "middleware.onResponse":
                    send({ jsonrpc: "2.0", id: request.id, result: await plugin.middleware?.onResponse?.({ body: requireObject(params.body, "body"), context: requireContext(params.context) }) });
                    return;
                default:
                    throw new Error(`Unknown plugin method '${request.method}'`);
            }
        }
        catch (error) {
            fail(request, error);
        }
    };
    readline.on("line", (line) => {
        if (!line.trim())
            return;
        try {
            const request = JSON.parse(line);
            if (!request || request.jsonrpc !== "2.0" || typeof request.id !== "string" || typeof request.method !== "string")
                throw new Error("Invalid plugin request");
            void handle(request);
        }
        catch (error) {
            options.onError?.(error);
        }
    });
    return {
        close() {
            if (closed)
                return;
            closed = true;
            readline.close();
        },
    };
}
function requireString(value, name) {
    if (typeof value !== "string" || !value.trim())
        throw new Error(`${name} is required`);
    return value;
}
function requireObject(value, name) {
    if (!isRecord(value))
        throw new Error(`${name} must be an object`);
    return value;
}
function requireHeaders(value) {
    if (!isRecord(value))
        throw new Error("headers must be an object");
    return Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === "string"));
}
function requireAccount(value) {
    const account = requireObject(value, "account");
    return {
        accountId: requireString(account.accountId, "account.accountId"),
        secretRef: requireString(account.secretRef, "account.secretRef"),
        ...(typeof account.displayName === "string" ? { displayName: account.displayName } : {}),
        ...(account.authMethod === "api_key" || account.authMethod === "oauth" || account.authMethod === "subscription" || account.authMethod === "none" ? { authMethod: account.authMethod } : {}),
        ...(typeof account.status === "string" ? { status: account.status } : {}),
        ...(typeof account.expiresAt === "number" ? { expiresAt: account.expiresAt } : {}),
    };
}
function requireContext(value) {
    const context = requireObject(value, "context");
    return {
        requestId: requireString(context.requestId, "context.requestId"),
        traceId: requireString(context.traceId, "context.traceId"),
        protocol: requireProtocol(context.protocol),
        model: requireString(context.model, "context.model"),
        stream: context.stream === true,
        ...(typeof context.path === "string" ? { path: context.path } : {}),
        ...(typeof context.agentId === "string" ? { agentId: context.agentId } : {}),
        ...(typeof context.environmentId === "string" ? { environmentId: context.environmentId } : {}),
        state: isRecord(context.state) ? context.state : {},
        ...(isRecord(context.options) ? { options: context.options } : {}),
    };
}
function requireProtocol(value) {
    if (value === "responses" || value === "chat_completions" || value === "anthropic" || value === "gemini")
        return value;
    throw new Error("context.protocol is invalid");
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=index.js.map