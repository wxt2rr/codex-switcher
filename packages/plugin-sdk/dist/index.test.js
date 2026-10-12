import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { startCswPluginServer } from "./index.js";
test("SDK serves provider and middleware RPC methods over newline JSON", async () => {
    const lines = [
        JSON.stringify({ jsonrpc: "2.0", id: "1", method: "plugin.describe" }),
        JSON.stringify({ jsonrpc: "2.0", id: "2", method: "provider.models", params: {
                account: { accountId: "a", secretRef: "r", authMethod: "none" }, secretRef: "r",
            } }),
        JSON.stringify({ jsonrpc: "2.0", id: "3", method: "middleware.onRequest", params: {
                body: { hello: "world" }, context: { requestId: "r", traceId: "t", protocol: "responses", model: "demo-model", stream: false, state: {},
                },
            } }),
        JSON.stringify({ jsonrpc: "2.0", id: "4", method: "provider.request", params: {
                account: { accountId: "a", secretRef: "r", authMethod: "none" }, secret: "s", protocol: "responses",
                url: "https://demo.invalid/v1/responses", method: "POST", headers: { "content-type": "application/json" }, body: "{}",
            } }),
    ];
    const input = new PassThrough();
    const output = new PassThrough();
    const responses = [];
    let buffer = "";
    output.on("data", (chunk) => {
        buffer += chunk.toString();
        while (buffer.includes("\n")) {
            const newline = buffer.indexOf("\n");
            responses.push(JSON.parse(buffer.slice(0, newline)));
            buffer = buffer.slice(newline + 1);
        }
    });
    const server = startCswPluginServer({
        provider: {
            describe: () => ({ id: "demo", displayName: "Demo", authMethods: ["none"], endpoints: [{ protocol: "responses", baseUrl: "https://demo.invalid/v1", modelsPath: "/models" }] }),
            models: () => [{ id: "demo-model", protocols: ["responses"] }],
            request: ({ url, method }) => ({ status: 200, body: { url, method } }),
        },
        middleware: {
            describe: () => ({ hooks: ["onRequest"], priority: 10 }),
            onRequest: ({ body }) => ({ body: { ...body, touched: true } }),
        },
    }, { input, output });
    setImmediate(() => input.end(`${lines.join("\n")}\n`));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(responses.map((item) => item.id), ["1", "2", "3", "4"]);
    assert.deepEqual(responses[1]?.result, { models: [{ id: "demo-model", protocols: ["responses"] }] });
    assert.deepEqual(responses[2]?.result, { body: { hello: "world", touched: true } });
    assert.deepEqual(responses[3]?.result, { status: 200, body: { url: "https://demo.invalid/v1/responses", method: "POST" } });
    server.close();
});
//# sourceMappingURL=index.test.js.map