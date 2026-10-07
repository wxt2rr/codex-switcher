import type { EnvState } from "../state/store.js";
import { type GatewayEnvironmentState } from "./model.js";
import { type GatewayEnvironmentStateV2 } from "./v2.js";
export interface GatewayMigrationPreview {
    environmentName: string;
    mode: "direct";
    providerCount: number;
    credentialCount: number;
    modelCount: number;
    routeGroupCount: number;
    secretRefs: string[];
    warnings: string[];
}
export declare function previewGatewayMigration(environment: EnvState): GatewayMigrationPreview;
export declare function migrateGatewayEnvironment(environment: EnvState, existing: unknown): GatewayEnvironmentState;
export interface GatewayMigrationV2Result {
    state: GatewayEnvironmentStateV2;
    migrated: boolean;
    sourceSchemaVersion: 1 | 2;
}
/**
 * Upgrades only gateway metadata. Credential secretRefs and existing account
 * files remain untouched, so this operation can be retried or downgraded.
 */
export declare function migrateGatewayEnvironmentV2(environment: EnvState, existing: unknown): GatewayMigrationV2Result;
export declare function downgradeGatewayEnvironmentV2(value: unknown): GatewayEnvironmentState;
