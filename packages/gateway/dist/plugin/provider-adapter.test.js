import assert from "node:assert/strict";
import test from "node:test";
import { ProviderRegistry } from "../provider/registry.js";
import { PluginHost } from "./host.js";
import { createPluginProviderAdapter } from "./provider-adapter.js";
function fixture() {
    const requests = [];
    const transport = {
        async send(request) {
            requests.push(request);
            const result = request.method === "provider.models"
                ? { models: [{ id: "plugin-model", protocols: ["responses"], capabilities: { reasoning: true } }] }
                : request.method === "provider.quota"
                    ? { tokensRemaining: 42, resetAt: 123 }
                    : request.method === "provider.refresh"
                        ? { account: { status: "active" }, accessToken: "next-token" }
                        : undefined;
            return { jsonrpc: "2.0", id: request.id, result };
        },
        async close() { },
    };
    const host = new PluginHost(transport, {
        manifest: { id: "provider-plugin", name: "Provider Plugin", version: "1.0.0", apiVersion: 1, entry: "index.js", permissions: ["provider", "secrets"] },
    });
    const adapter = createPluginProviderAdapter({
        id: "provider-plugin",
        displayName: "Provider Plugin",
        authMethods: ["api_key", "oauth"],
        endpoints: [{ protocol: "responses", baseUrl: "https://provider.example/v1", modelsPath: "/models" }],
        host,
        random: () => "login-state",
    });
    return { adapter, requests };
}
test("plugin provider adapter registers in the shared registry and supports models/quota", async () => {
    const { adapter, requests } = fixture();
    const registry = new ProviderRegistry(false);
    registry.register(adapter);
    assert.equal(registry.get("provider-plugin"), adapter);
    const account = { accountId: "account-1", displayName: "Account", authMethod: "api_key", secretRef: "secure:account-1", status: "active" };
    const models = await adapter.discoverModels({}, account, "secret-value");
    assert.equal(models[0]?.providerId, "provider-plugin");
    assert.equal(models[0]?.id, "plugin-model");
    const quota = await adapter.readQuota({}, account, "secret-value");
    assert.equal(quota?.tokensRemaining, 42);
    assert.equal(requests[0]?.params?.secret, "secret-value");
    assert.equal(requests[0]?.params?.secretRef, "secure:account-1");
});
test("plugin provider secrets require the explicit secrets permission", async () => {
    const transport = { async send(request) { return { jsonrpc: "2.0", id: request.id, result: [] }; }, async close() { } };
    const host = new PluginHost(transport, { manifest: { id: "provider-plugin", name: "Provider Plugin", version: "1.0.0", apiVersion: 1, entry: "index.js", permissions: ["provider"] } });
    const adapter = createPluginProviderAdapter({ id: "provider-plugin", displayName: "Provider Plugin", authMethods: ["api_key"], endpoints: [{ protocol: "responses", baseUrl: "https://provider.example/v1", modelsPath: "/models" }], host });
    await assert.rejects(adapter.discoverModels({}, { accountId: "a", displayName: "A", authMethod: "api_key", secretRef: "secure:a", status: "active" }, "secret"), /secrets/);
});
test("plugin provider adapter keeps login and signing compatible with built-in providers", () => {
    const { adapter } = fixture();
    const login = adapter.beginLogin("http://127.0.0.1/callback", 100);
    assert.equal(login.state, "login-state");
    const result = adapter.completeLogin({ state: "login-state", expectedState: "login-state", code: "oauth-code", accountId: "a" });
    assert.equal(result.account.secretRef, "provider/provider-plugin/a");
    const signed = adapter.signRequest({ account: result.account, secret: "secret", protocol: "responses", url: "https://provider.example/v1/responses", method: "POST", body: "{}" });
    assert.equal(signed.init.headers.get("authorization"), "Bearer secret");
});
//# sourceMappingURL=provider-adapter.test.js.map