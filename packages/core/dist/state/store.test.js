import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SCHEMA_VERSION, createStateStore, } from "./store.js";
import { GATEWAY_SCHEMA_VERSION } from "../gateway/model.js";
import { buildLegacyGatewayEnvironmentState } from "../gateway/legacy-adapter.js";
const sampleState = {
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    generatedAt: "2026-06-16T00:00:00.000Z",
    targets: {
        cli: { env: "default", account: "work" },
        app: { env: "default", account: "personal" },
    },
    envs: {
        default: {
            name: "default",
            path: "/tmp/default-home",
            accounts: {
                work: {
                    name: "work",
                    authMode: "auth",
                    runtime: {
                        preferredAuthMethod: "chatgpt",
                        openaiBaseUrlMode: "default",
                        apiProtocol: "responses",
                        compatibilityRouteEnabled: false,
                        compatibilityReasoningProfile: "auto",
                        compatibilityLongConversationStrategy: "safe",
                        compatibilityInstructionRole: "auto",
                    },
                },
            },
        },
    },
    tasks: {
        recent: [],
    },
};
test("state store saves and reloads canonical switcher state", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-core-"));
    try {
        const store = createStateStore({ rootDir: root });
        await store.save(sampleState);
        const reloaded = await store.load();
        assert.deepEqual(reloaded, sampleState);
        const raw = JSON.parse(await readFile(join(root, "core-state.json"), "utf8"));
        assert.equal(raw.schemaVersion, DEFAULT_SCHEMA_VERSION);
        assert.deepEqual((await readdir(root)).filter((name) => name.includes(".tmp")), []);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("state store defaults legacy account protocol settings to native responses", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-core-protocol-defaults-"));
    try {
        const store = createStateStore({ rootDir: root });
        await store.save(sampleState);
        const runtime = (await store.load()).envs.default.accounts.work.runtime;
        assert.equal(runtime.apiProtocol, "responses");
        assert.equal(runtime.compatibilityRouteEnabled, false);
        assert.equal(runtime.compatibilityReasoningProfile, "auto");
        assert.equal(runtime.compatibilityLongConversationStrategy, "safe");
        assert.equal(runtime.compatibilityInstructionRole, "auto");
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("state store preserves an environment gateway configuration without secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-core-gateway-"));
    const state = {
        ...sampleState,
        envs: {
            ...sampleState.envs,
            default: {
                ...sampleState.envs.default,
                gateway: {
                    schemaVersion: GATEWAY_SCHEMA_VERSION,
                    mode: "gateway",
                    gatewayId: "gateway-default",
                    providers: {},
                    credentials: {},
                    models: {},
                    routeGroups: {},
                    catalogVersion: 0,
                },
            },
        },
    };
    try {
        const store = createStateStore({ rootDir: root });
        await store.save(state);
        assert.deepEqual((await store.load()).envs.default.gateway, state.envs.default.gateway);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("state store rejects an invalid environment gateway configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-core-invalid-gateway-"));
    try {
        const store = createStateStore({ rootDir: root });
        await store.writeRaw(JSON.stringify({
            ...sampleState,
            envs: {
                ...sampleState.envs,
                default: {
                    ...sampleState.envs.default,
                    gateway: { schemaVersion: GATEWAY_SCHEMA_VERSION, mode: "gateway" },
                },
            },
        }));
        await assert.rejects(() => store.load(), (error) => {
            assert.equal(error.code, "INVALID_STATE");
            return true;
        });
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("legacy gateway adapter projects accounts without copying secrets", () => {
    const gateway = buildLegacyGatewayEnvironmentState({
        name: "work env",
        path: "/tmp/work-env",
        accounts: {
            subscription: {
                name: "subscription",
                authMode: "auth",
                authData: {
                    accessToken: "must-not-be-copied",
                    accountId: "acct-subscription",
                },
                runtime: {
                    preferredAuthMethod: "chatgpt",
                    openaiBaseUrlMode: "default",
                    model: "gpt-5",
                    apiProtocol: "responses",
                    compatibilityRouteEnabled: false,
                    compatibilityReasoningProfile: "auto",
                    compatibilityLongConversationStrategy: "safe",
                    compatibilityInstructionRole: "auto",
                },
            },
            api: {
                name: "api",
                authMode: "apikey",
                authData: { apiKey: "must-not-be-copied" },
                runtime: {
                    preferredAuthMethod: "apikey",
                    openaiBaseUrlMode: "custom",
                    openaiBaseUrl: "https://example.test/v1",
                    providerId: "deepseek",
                    model: "deepseek-chat",
                    apiProtocol: "chat_completions",
                    compatibilityRouteEnabled: false,
                    compatibilityReasoningProfile: "auto",
                    compatibilityLongConversationStrategy: "safe",
                    compatibilityInstructionRole: "auto",
                },
            },
        },
    });
    assert.equal(gateway.mode, "direct");
    assert.equal(gateway.providers.chatgpt?.endpoints.responses, "https://chatgpt.com/backend-api/codex");
    assert.equal(gateway.providers.deepseek?.endpoints.chatCompletions, "https://example.test/v1");
    assert.equal(gateway.credentials["credential:work%20env:subscription"]?.kind, "auth");
    assert.equal(gateway.credentials["credential:work%20env:api"]?.kind, "api_key");
    assert.equal(gateway.models["chatgpt/gpt-5"]?.upstreamModelId, "gpt-5");
    assert.equal(gateway.models["deepseek/deepseek-chat"]?.upstreamModelId, "deepseek-chat");
    assert.deepEqual(gateway.routeGroups["route-group:work%20env:gpt-5"]?.members.map((member) => member.credentialSelector.credentialIds?.[0]), [
        "credential:work%20env:subscription",
    ]);
    assert.equal(JSON.stringify(gateway).includes("must-not-be-copied"), false);
});
test("state store rejects malformed persisted state with typed error", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-switcher-core-bad-"));
    try {
        const store = createStateStore({ rootDir: root });
        await store.writeRaw('{"schemaVersion":1,"envs":null}');
        await assert.rejects(() => store.load(), (error) => {
            assert.equal(typeof error, "object");
            assert.ok(error !== null);
            assert.equal(error.code, "INVALID_STATE");
            return true;
        });
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
//# sourceMappingURL=store.test.js.map