import type { EnvState } from "../state/store.js";
import { type GatewayEnvironmentState } from "./model.js";
/**
 * Projects the legacy environment/account shape into the gateway domain.
 *
 * This is intentionally metadata-only: secretRef points back to the existing
 * account credential storage and no access token/API key is copied into the
 * gateway state. The generated state stays in direct mode until the user
 * explicitly enables the gateway.
 */
export declare function buildLegacyGatewayEnvironmentState(environment: EnvState): GatewayEnvironmentState;
export declare function createLegacyRouteGroupId(environmentName: string, upstreamModelId: string): string;
