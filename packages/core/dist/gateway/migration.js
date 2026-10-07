import { buildLegacyGatewayEnvironmentState } from "./legacy-adapter.js";
import { isGatewayEnvironmentState } from "./model.js";
import { isGatewayEnvironmentStateV2, migrateGatewayEnvironmentStateToV2, toLegacyGatewayEnvironmentState, } from "./v2.js";
export function previewGatewayMigration(environment) {
    const gateway = buildLegacyGatewayEnvironmentState(environment);
    return {
        environmentName: environment.name,
        mode: "direct",
        providerCount: Object.keys(gateway.providers).length,
        credentialCount: Object.keys(gateway.credentials).length,
        modelCount: Object.keys(gateway.models).length,
        routeGroupCount: Object.keys(gateway.routeGroups).length,
        secretRefs: Object.values(gateway.credentials).map((credential) => credential.secretRef),
        warnings: Object.values(gateway.models).length === 0
            ? ["No account model is configured; the environment will still migrate safely to direct mode."]
            : [],
    };
}
export function migrateGatewayEnvironment(environment, existing) {
    if (isGatewayEnvironmentState(existing))
        return existing;
    return buildLegacyGatewayEnvironmentState(environment);
}
/**
 * Upgrades only gateway metadata. Credential secretRefs and existing account
 * files remain untouched, so this operation can be retried or downgraded.
 */
export function migrateGatewayEnvironmentV2(environment, existing) {
    if (isGatewayEnvironmentStateV2(existing))
        return { state: existing, migrated: false, sourceSchemaVersion: 2 };
    const legacy = migrateGatewayEnvironment(environment, existing);
    return { state: migrateGatewayEnvironmentStateToV2(legacy, environment.name), migrated: true, sourceSchemaVersion: 1 };
}
export function downgradeGatewayEnvironmentV2(value) {
    if (!isGatewayEnvironmentStateV2(value))
        throw new Error("Cannot downgrade an invalid gateway v2 state");
    return toLegacyGatewayEnvironmentState(value);
}
//# sourceMappingURL=migration.js.map