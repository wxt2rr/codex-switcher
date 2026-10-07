import assert from "node:assert/strict";
import test from "node:test";
import { isGatewayEnvironmentStateV2, migrateGatewayEnvironmentStateToV2, nextGatewayEnvironmentStateV2, toLegacyGatewayEnvironmentState, } from "./v2.js";
const legacy = {
    schemaVersion: 1,
    mode: "direct",
    gatewayId: "gateway-default",
    providers: {},
    credentials: {},
    models: {},
    routeGroups: {},
    catalogVersion: 1,
};
test("gateway persistence migration is metadata-only and reversible", () => {
    const migrated = migrateGatewayEnvironmentStateToV2(legacy, "default");
    assert.equal(migrated.schemaVersion, 2);
    assert.equal(migrated.sourceSchemaVersion, 1);
    assert.equal(migrated.environmentId, "default");
    assert.equal(migrated.listener.basePath, "/gateways/gateway-default");
    assert.deepEqual(toLegacyGatewayEnvironmentState(migrated), legacy);
    assert.equal(isGatewayEnvironmentStateV2(migrated), true);
});
test("gateway persistence updates increment revision and remain idempotent", () => {
    const first = migrateGatewayEnvironmentStateToV2(legacy);
    const second = nextGatewayEnvironmentStateV2(first, { mode: "gateway" });
    const third = migrateGatewayEnvironmentStateToV2(second);
    assert.equal(first.revision, 1);
    assert.equal(second.revision, 2);
    assert.equal(second.mode, "gateway");
    assert.deepEqual(third, second);
});
test("gateway persistence preserves explicit Agent reasoning and model overrides", () => {
    const first = migrateGatewayEnvironmentStateToV2(legacy);
    const next = nextGatewayEnvironmentStateV2(first, {
        agentBindings: {
            codex: {
                agentId: "codex",
                displayName: "Codex",
                gatewayId: first.gatewayId,
                defaultModelId: "gpt-5",
                reasoningProfile: "high",
                fallbackModelId: "gpt-5-mini",
                subAgentModelId: "gpt-5-nano",
                originalConfigRef: "snapshot/codex",
                enabled: true,
            },
        },
    });
    assert.equal(next.agentBindings.codex?.reasoningProfile, "high");
    assert.equal(next.agentBindings.codex?.fallbackModelId, "gpt-5-mini");
    assert.equal(next.agentBindings.codex?.subAgentModelId, "gpt-5-nano");
    assert.equal(isGatewayEnvironmentStateV2(next), true);
});
test("gateway persistence rejects invalid agent bindings", () => {
    const first = migrateGatewayEnvironmentStateToV2(legacy);
    assert.equal(isGatewayEnvironmentStateV2({
        ...first,
        agentBindings: { broken: { agentId: "broken" } },
    }), false);
});
//# sourceMappingURL=v2.test.js.map