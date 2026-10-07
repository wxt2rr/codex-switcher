import assert from "node:assert/strict";
import test from "node:test";
import { importGatewayConfiguration, previewGatewayImport } from "./import.js";
import { isGatewayEnvironmentState } from "./model.js";
test("imports external provider gateway data without secrets or classifier routes", () => {
    const result = importGatewayConfiguration({
        providers: [{ id: "relay", name: "Relay", responses: "https://relay.example/v1", key: "sk-secret", models: ["gpt-5", "gpt-5-mini"], modelIds: ["gpt-5"], requestHeaders: { "x-provider-scope": "shared" }, proxyUrl: "http://127.0.0.1:7890", routing: "rotate" }],
        groups: [{ id: "coding", name: "Coding", members: ["relay/gpt-5", "relay/gpt-5-mini"], routing: "usage", affinity: "session", classifier: "relay/gpt-5", rules: [{ intent: "coding", use: "relay/gpt-5" }] }],
        agents: [{ id: "codex", name: "Codex", model: "group/coding", reasoningEffort: "high", fallbackModel: "gpt-5-mini", subAgentModel: "gpt-5-nano" }],
    }, "work env");
    const serialized = JSON.stringify(result);
    assert.equal(result.sourceFormat, "provider_gateway");
    assert.equal(result.gateway.providers.relay.endpoints.responses, "https://relay.example/v1");
    assert.deepEqual(result.gateway.providers.relay.requestHeaders, { "x-provider-scope": "shared" });
    assert.equal(result.gateway.providers.relay.proxyUrl, "http://127.0.0.1:7890");
    assert.equal(Object.keys(result.gateway.models).length, 2);
    assert.deepEqual(Object.values(result.gateway.credentials)[0]?.modelIds, ["gpt-5"]);
    assert.deepEqual(Object.values(result.gateway.credentials)[0]?.requestHeaders, { "x-provider-scope": "shared" });
    assert.equal(result.gateway.routeGroups.coding?.strategy, "usage");
    assert.equal(result.gateway.routeGroups.coding?.sessionPolicy, "session");
    assert.equal(result.agentBindings.codex?.defaultModelId, "group/coding");
    assert.equal(result.agentBindings.codex?.reasoningProfile, "high");
    assert.equal(result.agentBindings.codex?.fallbackModelId, "gpt-5-mini");
    assert.equal(result.agentBindings.codex?.subAgentModelId, "gpt-5-nano");
    assert.equal(serialized.includes("sk-secret"), false);
    assert.equal(serialized.includes("should-drop"), false);
    assert.equal(serialized.includes("coding"), true);
    assert.ok(result.warnings.some((warning) => warning.includes("key material")));
    assert.ok(result.excludedFields.some((field) => field.endsWith("classifier")));
});
test("previews gateway imports and keeps imported credentials disabled until locally mapped", () => {
    const preview = previewGatewayImport({
        providers: [{ id: "local", name: "Local", chat: "http://127.0.0.1:9000/v1", models: ["local-model"] }],
    }, "default");
    assert.deepEqual({ providers: preview.providers, credentials: preview.credentials, models: preview.models, routeGroups: preview.routeGroups, agents: preview.agents }, { providers: 1, credentials: 1, models: 1, routeGroups: 1, agents: 0 });
    assert.ok(preview.warnings.some((warning) => warning.includes("no imported credential")));
});
test("imports a gateway-shaped document while forcing manual mode and removing unsupported fields", () => {
    const result = importGatewayConfiguration({
        schemaVersion: 1,
        mode: "gateway",
        gatewayId: "remote",
        providers: { openai: { id: "openai", displayName: "OpenAI", endpoints: { responses: "https://api.example/v1" } } },
        credentials: { c1: { id: "c1", providerId: "openai", secret: "never-store", secretRef: "account:default:primary", supportedProtocols: ["responses"], status: "active" } },
        models: { m1: { id: "m1", providerId: "openai", upstreamModelId: "gpt-5", displayName: "GPT-5", protocols: ["responses"], enabled: true } },
        routeGroups: { g1: { id: "g1", displayName: "G1", exposedModelId: "gpt-5", members: [{ providerId: "openai", modelId: "m1", credentialSelector: { credentialIds: ["c1"] }, priority: 0, weight: 1 }], strategy: "smart", sessionPolicy: "auto", fallbackEnabled: true } },
        agentBindings: { codex: { agentId: "codex", displayName: "Codex", gatewayId: "remote", originalConfigRef: "snapshot/codex", enabled: true } },
        rules: [{ classifier: "should-drop" }],
    }, "default");
    assert.equal(result.gateway.mode, "direct");
    assert.equal(result.gateway.gatewayId, "remote");
    assert.equal(result.agentBindings.codex?.gatewayId, "remote");
    assert.equal(result.gateway.routeGroups.g1?.members[0]?.modelId, "m1");
    assert.equal(result.gateway.credentials.c1.secret, undefined);
    assert.equal(JSON.stringify(result).includes("should-drop"), false);
});
test("recursively removes excluded routing fields before gateway-shaped data can be persisted", () => {
    const result = importGatewayConfiguration({
        providers: { relay: { id: "relay", endpoints: { responses: "https://relay.example/v1" }, metadata: { intent: "drop-me" } } },
        credentials: { c1: { id: "c1", providerId: "relay", secretRef: "account:default:relay", status: "active" } },
        models: { m1: { id: "m1", providerId: "relay", upstreamModelId: "gpt-5" } },
        routeGroups: { g1: { id: "g1", members: [{ providerId: "relay", modelId: "m1" }], intent_rules_json: "drop-me" } },
        intentRouting: { prompt: "drop-me" },
    }, "default");
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("drop-me"), false);
    assert.ok(result.excludedFields.some((field) => field.endsWith("intent")));
    assert.ok(result.excludedFields.some((field) => field.endsWith("intent_rules_json")));
});
test("imports only explicit metadata route rules and never preserves intent rules", () => {
    const result = importGatewayConfiguration({
        providers: { relay: { id: "relay", endpoints: { responses: "https://relay.example/v1" } } },
        credentials: { c1: { id: "c1", providerId: "relay", secretRef: "account:default:relay", status: "active" } },
        models: { m1: { id: "m1", providerId: "relay", upstreamModelId: "gpt-5" } },
        routeGroups: {
            default: { id: "default", exposedModelId: "default-model", members: [{ providerId: "relay", modelId: "m1" }], strategy: "order", sessionPolicy: "off", fallbackEnabled: true },
            vision: { id: "vision", exposedModelId: "vision-model", members: [{ providerId: "relay", modelId: "m1" }], strategy: "order", sessionPolicy: "off", fallbackEnabled: true },
        },
        routeRules: [{ id: "images", targetModelId: "vision-model", priority: 0, enabled: true, match: { hasImages: true, tokenCount: { min: 10 }, prompt: "drop-me" } }],
        rules: [{ intent: "never-persist", use: "default-model" }],
    }, "default");
    assert.deepEqual(result.gateway.routeRules?.[0]?.match, { hasImages: true, tokenCount: { min: 10 } });
    assert.equal(JSON.stringify(result).includes("never-persist"), false);
});
test("preserves explicit group/<id> nesting during provider gateway import", () => {
    const result = importGatewayConfiguration({
        providers: [{ id: "relay", name: "Relay", responses: "https://relay.example/v1", models: ["gpt-5"] }],
        groups: [
            { id: "base", members: ["relay/gpt-5"], routing: "order" },
            { id: "coding", members: ["group/base"], routing: "weight" },
        ],
    }, "default");
    assert.deepEqual(result.gateway.routeGroups.base?.nestedGroupIds, undefined);
    assert.deepEqual(result.gateway.routeGroups.coding?.nestedGroupIds, ["base"]);
    assert.equal(result.gateway.routeGroups.coding?.members.length, 0);
    assert.equal(result.warnings.some((warning) => warning.includes("nested groups are unsupported")), false);
});
test("gateway schema rejects excluded prompt and intent routing fields even when passed directly", () => {
    const result = importGatewayConfiguration({
        providers: { relay: { id: "relay", responses: "https://relay.example/v1" } },
        models: { m1: { id: "m1", providerId: "relay", upstreamModelId: "gpt-5" } },
    }, "default");
    assert.equal(isGatewayEnvironmentState({ ...result.gateway, intentRouting: { prompt: "never execute" } }), false);
    assert.equal(isGatewayEnvironmentState({
        ...result.gateway,
        routeRules: [{ id: "bad", targetModelId: "m1", priority: 0, enabled: true, match: { prompt: "never execute" } }],
    }), false);
});
test("gateway request headers remain non-secret and reject auth header injection", () => {
    const imported = importGatewayConfiguration({
        providers: [{ id: "relay", responses: "https://relay.example/v1", key: "sk-secret", requestHeaders: { "x-scope": "shared", authorization: "drop-me" }, models: ["model"] }],
    }, "default");
    assert.deepEqual(imported.gateway.providers.relay.requestHeaders, { "x-scope": "shared" });
    assert.deepEqual(Object.values(imported.gateway.credentials)[0]?.requestHeaders, { "x-scope": "shared" });
    assert.equal(isGatewayEnvironmentState({ ...imported.gateway, providers: { relay: { ...imported.gateway.providers.relay, requestHeaders: { authorization: "must-reject" } } } }), false);
    assert.equal(isGatewayEnvironmentState({ ...imported.gateway, providers: { relay: { ...imported.gateway.providers.relay, proxyUrl: "http://user:pass@127.0.0.1:7890" } } }), false);
    assert.equal(isGatewayEnvironmentState({ ...imported.gateway, credentials: { ...imported.gateway.credentials, c: { ...Object.values(imported.gateway.credentials)[0], proxyUrl: "ftp://127.0.0.1:21" } } }), false);
});
//# sourceMappingURL=import.test.js.map