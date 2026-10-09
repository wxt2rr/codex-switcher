import assert from "node:assert/strict";
import test from "node:test";
import { gatewayProviderProtocols, validateGatewayRouteCompatibility, } from "./model.js";
test("provider protocol declarations are derived from all configured endpoints", () => {
    assert.deepEqual(gatewayProviderProtocols({
        endpoints: {
            responses: "https://responses.example",
            chatCompletions: "https://chat.example",
            anthropicMessages: "https://anthropic.example",
            gemini: "https://gemini.example",
        },
    }), ["responses", "chat_completions", "anthropic", "gemini"]);
});
test("route compatibility validation catches provider, model, credential and protocol mismatches", () => {
    const gateway = {
        schemaVersion: 1,
        mode: "gateway",
        gatewayId: "gateway-test",
        providers: {
            openai: {
                id: "openai",
                displayName: "OpenAI",
                kind: "openai",
                endpoints: { responses: "https://api.example/v1" },
                modelDiscovery: "preset",
                enabled: true,
            },
        },
        credentials: {
            chatOnly: {
                id: "chatOnly",
                providerId: "openai",
                displayName: "Chat only",
                kind: "api_key",
                secretRef: "account:test:chat",
                supportedProtocols: ["chat_completions"],
                status: "active",
            },
        },
        models: {
            model: {
                id: "model",
                providerId: "openai",
                upstreamModelId: "gpt-test",
                displayName: "GPT test",
                protocols: ["responses"],
                capabilities: {},
                enabled: true,
            },
        },
        routeGroups: {
            group: {
                id: "group",
                displayName: "Group",
                exposedModelId: "gpt-test",
                members: [{
                        providerId: "openai",
                        modelId: "model",
                        credentialSelector: { credentialIds: ["chatOnly"] },
                        priority: 0,
                        weight: 1,
                    }],
                strategy: "smart",
                sessionPolicy: "auto",
                fallbackEnabled: true,
            },
        },
        catalogVersion: 1,
    };
    const issues = validateGatewayRouteCompatibility(gateway);
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.code, "NO_PROTOCOL_INTERSECTION");
});
//# sourceMappingURL=model.test.js.map