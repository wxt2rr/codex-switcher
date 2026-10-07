import assert from "node:assert/strict";
import test from "node:test";
import { downgradeGatewayEnvironmentV2, migrateGatewayEnvironment, migrateGatewayEnvironmentV2, previewGatewayMigration } from "./migration.js";
const environment = {
    name: "work",
    path: "/tmp/work",
    accounts: {
        auth: { name: "auth", authMode: "auth", authData: { access_token: "secret" }, runtime: { model: "gpt-5" } },
        api: { name: "api", authMode: "apikey", authData: { OPENAI_API_KEY: "sk-secret" }, runtime: { model: "gpt-5" } },
    },
};
test("gateway migration preview is metadata-only and counts a shared route group", () => {
    const preview = previewGatewayMigration(environment);
    assert.equal(preview.mode, "direct");
    assert.equal(preview.providerCount, 2);
    assert.equal(preview.credentialCount, 2);
    assert.equal(preview.modelCount, 2);
    assert.equal(preview.routeGroupCount, 1);
    assert.deepEqual(preview.secretRefs, ["account:work:auth", "account:work:api"]);
    assert.equal(preview.warnings.length, 0);
});
test("gateway migration is idempotent when a valid state already exists", () => {
    const first = migrateGatewayEnvironment(environment, undefined);
    const second = migrateGatewayEnvironment(environment, first);
    assert.deepEqual(second, first);
});
test("gateway v2 migration is retryable and downgrade-safe", () => {
    const first = migrateGatewayEnvironmentV2(environment, undefined);
    assert.equal(first.migrated, true);
    assert.equal(first.sourceSchemaVersion, 1);
    const second = migrateGatewayEnvironmentV2(environment, first.state);
    assert.equal(second.migrated, false);
    assert.deepEqual(downgradeGatewayEnvironmentV2(first.state), migrateGatewayEnvironment(environment, undefined));
});
//# sourceMappingURL=migration.test.js.map