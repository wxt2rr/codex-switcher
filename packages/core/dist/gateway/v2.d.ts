import { GATEWAY_SCHEMA_VERSION, type GatewayEnvironmentState, type GatewayProtocol } from "./model.js";
export declare const GATEWAY_PERSISTENCE_SCHEMA_VERSION: 2;
export interface GatewayAgentBindingV2 {
    agentId: string;
    displayName: string;
    gatewayId: string;
    defaultModelId?: string;
    defaultRouteGroupId?: string;
    reasoningProfile?: string;
    fallbackModelId?: string;
    subAgentModelId?: string;
    originalConfigRef: string;
    enabled: boolean;
}
export interface GatewayEnvironmentStateV2 extends Omit<GatewayEnvironmentState, "schemaVersion"> {
    schemaVersion: typeof GATEWAY_PERSISTENCE_SCHEMA_VERSION;
    environmentId: string;
    revision: number;
    sourceSchemaVersion: typeof GATEWAY_SCHEMA_VERSION | typeof GATEWAY_PERSISTENCE_SCHEMA_VERSION;
    listener: {
        basePath: string;
        protocols: GatewayProtocol[];
    };
    agentBindings: Record<string, GatewayAgentBindingV2>;
}
export declare function isGatewayEnvironmentStateV2(value: unknown): value is GatewayEnvironmentStateV2;
export declare function migrateGatewayEnvironmentStateToV2(value: GatewayEnvironmentState | GatewayEnvironmentStateV2, environmentId?: string): GatewayEnvironmentStateV2;
export declare function nextGatewayEnvironmentStateV2(previous: GatewayEnvironmentStateV2, patch: Partial<GatewayEnvironmentStateV2>): GatewayEnvironmentStateV2;
export declare function toLegacyGatewayEnvironmentState(value: GatewayEnvironmentStateV2): GatewayEnvironmentState;
