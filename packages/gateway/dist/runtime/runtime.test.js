import test from "node:test";
import assert from "node:assert/strict";
import { GatewayFallbackError, GatewayRuntime } from "./runtime.js";
import { PluginHost } from "../plugin/host.js";
import { createPluginProviderAdapter } from "../plugin/provider-adapter.js";
import { ProviderRegistry } from "../provider/registry.js";
test("gateway runtime dispatches across protocols and records usage", async () => {
    const runtime = new GatewayRuntime({
        candidates: [
            { id: "openai-route", providerId: "openai", credentialId: "key-1", modelId: "gpt-5", protocol: "chat_completions", capabilities: ["tools", "streaming"], priority: 1, weight: 1, healthy: true },
            { id: "anthropic-route", providerId: "anthropic", credentialId: "key-2", modelId: "claude-sonnet-4-5", protocol: "anthropic", capabilities: ["tools", "reasoning", "streaming"], priority: 2, weight: 1, healthy: true },
        ],
        groups: {
            coding: { id: "coding", displayName: "Coding", exposedModelId: "coding", members: ["openai-route", "anthropic-route"], strategy: "order", affinity: "session", fallbackEnabled: true, priority: 0 },
        },
        pricingProfiles: [{ providerId: "openai", modelPattern: "gpt-5", inputPerMillion: 1, outputPerMillion: 2, currency: "USD" }],
        now: () => 1_000,
    });
    const dispatch = await runtime.dispatch({
        requestId: "req-1",
        traceId: "trace-1",
        environmentId: "env-1",
        agentId: "codex",
        protocol: "responses",
        model: "coding",
        sessionId: "session-secret",
        body: { model: "coding", input: "fix this TypeScript bug", stream: false },
    });
    assert.equal(dispatch.upstreamProtocol, "chat_completions");
    assert.equal(dispatch.upstreamModel, "gpt-5");
    assert.equal(dispatch.upstreamBody.model, "gpt-5");
    assert.deepEqual(dispatch.upstreamBody.messages, [{ role: "user", content: "fix this TypeScript bug" }]);
    assert.equal(dispatch.conversion.quality, "good");
    const stream = runtime.createResponseStream(dispatch, { emitSequenceNumber: true });
    const streamChunk = await runtime.convertStreamChunk(stream, { id: "chatcmpl-stream", choices: [{ delta: { content: "done" }, finish_reason: null }] });
    const streamEnd = await runtime.finalizeStream(stream);
    assert.equal(streamChunk.value[0]?.type, "response.created");
    assert.equal(streamEnd.value[0]?.type, "response.completed");
    const completion = await runtime.complete({
        dispatch,
        upstreamBody: { id: "chatcmpl-1", choices: [{ message: { role: "assistant", content: "done" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
        firstByteAt: 1_250,
    });
    assert.equal(completion.responseBody?.object, "response");
    assert.equal(completion.usage.inputTokens, 10);
    assert.equal(completion.usage.outputTokens, 5);
    assert.equal(completion.usage.sessionIdHash?.length, 32);
    assert.notEqual(completion.usage.sessionIdHash, "session-secret");
    assert.equal(completion.usage.timeToFirstTokenMs, 250);
    assert.equal(completion.usage.standardCost, 0.00002);
    assert.equal(runtime.ledger.size(), 1);
    assert.equal(runtime.ledger.traces("trace-1").length, 6);
});
test("gateway runtime isolates simultaneous requests from multiple agents", async () => {
    const runtime = new GatewayRuntime({
        candidates: [{ id: "shared-route", providerId: "openai", credentialId: "shared-key", modelId: "gpt-5", protocol: "chat_completions", capabilities: ["streaming"], priority: 0, weight: 1, healthy: true }],
        groups: { shared: { id: "shared", displayName: "Shared", exposedModelId: "shared", members: ["shared-route"], strategy: "order", affinity: "session", fallbackEnabled: true, priority: 0 } },
        now: () => 1_000,
    });
    const requests = [
        { agentId: "codex", sessionId: "codex-session" },
        { agentId: "claude", sessionId: "claude-session" },
    ];
    const results = await Promise.all(requests.map(async ({ agentId, sessionId }, index) => {
        const startedAt = 1_000 + index;
        const result = await runtime.dispatchWithFallback({ requestId: `request-${agentId}`, traceId: `trace-${agentId}`, environmentId: "env", agentId, protocol: "responses", model: "shared", sessionId, now: startedAt, body: { model: "shared", input: agentId } }, async (dispatch) => {
            await new Promise((resolve) => setTimeout(resolve, index === 0 ? 8 : 1));
            const completion = await runtime.complete({
                dispatch,
                upstreamBody: { id: `chat-${agentId}`, choices: [{ message: { role: "assistant", content: "done" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } },
                firstByteAt: startedAt + 1,
                completedAt: startedAt + 9,
            });
            assert.equal(completion.usage.agentId, agentId);
            return { status: 200, value: agentId, firstByteStarted: true };
        });
        return result.value;
    }));
    assert.deepEqual([...results].sort(), ["claude", "codex"]);
    assert.equal(runtime.ledger.size(), 2);
    assert.deepEqual(runtime.ledger.aggregate({}, "agentId").map((item) => item.key).sort(), ["claude", "codex"]);
});
test("gateway runtime rejects a provider/protocol mismatch before sending upstream", async () => {
    const runtime = new GatewayRuntime({
        candidates: [{ id: "bad", providerId: "openai", credentialId: "key", modelId: "gpt-5", protocol: "gemini", capabilities: [], priority: 0, weight: 1, healthy: true }],
        groups: {},
    });
    await assert.rejects(runtime.dispatch({ environmentId: "env", agentId: "codex", protocol: "gemini", model: "gpt-5", body: { contents: [] } }), /does not expose protocol/);
});
test("a provider plugin registered in the shared registry participates in model routing", async () => {
    const pluginHost = new PluginHost({
        send: async (request) => ({ jsonrpc: "2.0", id: request.id, result: {} }),
        close: async () => undefined,
    });
    const plugin = createPluginProviderAdapter({
        id: "plugin-provider",
        displayName: "Plugin Provider",
        authMethods: ["api_key"],
        endpoints: [{ protocol: "responses", baseUrl: "https://plugin.example/v1", modelsPath: "/models" }],
        host: pluginHost,
    });
    const registry = new ProviderRegistry();
    registry.register(plugin);
    const runtime = new GatewayRuntime({
        providerRegistry: registry,
        candidates: [{ id: "plugin-route", providerId: "plugin-provider", credentialId: "plugin-key", modelId: "plugin-model", protocol: "responses", capabilities: ["streaming"], priority: 0, weight: 1, healthy: true }],
        groups: {},
    });
    const dispatch = await runtime.dispatch({
        environmentId: "env",
        agentId: "codex",
        protocol: "responses",
        model: "plugin-model",
        body: { model: "plugin-model", input: "hello" },
    });
    assert.equal(dispatch.route.route.providerId, "plugin-provider");
    assert.equal(dispatch.upstreamModel, "plugin-model");
});
test("gateway runtime retries explicit fallback routes only before the first byte", async () => {
    const runtime = new GatewayRuntime({
        candidates: [
            { id: "primary", providerId: "openai", credentialId: "key-1", modelId: "gpt-5", protocol: "chat_completions", capabilities: ["streaming"], priority: 1, weight: 1, healthy: true },
            { id: "fallback", providerId: "openai", credentialId: "key-2", modelId: "gpt-5", protocol: "chat_completions", capabilities: ["streaming"], priority: 2, weight: 1, healthy: true },
        ],
        groups: {
            shared: { id: "shared", displayName: "Shared", exposedModelId: "shared", members: ["primary", "fallback"], strategy: "order", affinity: "off", fallbackEnabled: true, priority: 0 },
        },
        now: () => 1_000,
    });
    const result = await runtime.dispatchWithFallback({ requestId: "req-fallback", traceId: "trace-fallback", environmentId: "env", agentId: "codex", protocol: "responses", model: "shared", body: { model: "shared", input: "hello" } }, async (_dispatch, attempt) => attempt === 0
        ? { status: 503, firstByteStarted: false }
        : { status: 200, value: "ok", firstByteStarted: false });
    assert.equal(result.value, "ok");
    assert.equal(result.dispatch.route.route.credentialId, "key-2");
    assert.equal(result.retryCount, 1);
    assert.deepEqual(result.attempts.map((attempt) => attempt.failureClass), ["upstream_5xx", undefined]);
});
test("gateway runtime never falls back after the first response byte", async () => {
    const runtime = new GatewayRuntime({
        candidates: [
            { id: "primary", providerId: "openai", credentialId: "key-1", modelId: "gpt-5", protocol: "chat_completions", capabilities: ["streaming"], priority: 1, weight: 1, healthy: true },
            { id: "fallback", providerId: "openai", credentialId: "key-2", modelId: "gpt-5", protocol: "chat_completions", capabilities: ["streaming"], priority: 2, weight: 1, healthy: true },
        ],
        groups: {
            shared: { id: "shared", displayName: "Shared", exposedModelId: "shared", members: ["primary", "fallback"], strategy: "order", affinity: "off", fallbackEnabled: true, priority: 0 },
        },
    });
    await assert.rejects(runtime.dispatchWithFallback({ environmentId: "env", agentId: "codex", protocol: "responses", model: "shared", body: { model: "shared", input: "hello" } }, async () => { throw Object.assign(new Error("stream interrupted"), { firstByteStarted: true }); }), (error) => {
        assert.ok(error instanceof GatewayFallbackError);
        assert.equal(error.attempts.length, 1);
        assert.equal(error.attempts[0]?.failureClass, "stream_interrupted");
        return true;
    });
});
//# sourceMappingURL=runtime.test.js.map