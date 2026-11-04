import { type CapabilityId, type CapabilityObservation, type CapabilityProfile, type CapabilityStatus } from "./contracts.js";
import type { GatewayProtocol, JsonObject } from "../protocol.js";
export type CapabilityAction = "native" | "fallback" | "omit" | "error" | "probe";
export type CapabilityFallback = "allow" | "fallback" | "required";
export interface CapabilityPlan {
    capability: CapabilityId;
    status: CapabilityStatus;
    action: CapabilityAction;
    reason: string;
}
export interface HostedToolFilterResult {
    body: JsonObject;
    omitted: Array<{
        type: string;
        capability: CapabilityId;
        reason: string;
    }>;
}
export interface UnsupportedParameterFilterResult {
    body: JsonObject;
    omitted: Array<{
        field: string;
        capability: CapabilityId;
        reason: string;
    }>;
}
/** Removes only hosted tools that the selected route cannot safely encode. */
export declare function filterUnsupportedHostedTools(body: JsonObject, profile: CapabilityProfile | undefined, policy?: "safe" | "allow"): HostedToolFilterResult;
/**
 * Removes only sampling parameters that the selected route explicitly marks
 * unsupported. Unknown capabilities are preserved so a legacy provider keeps
 * receiving the same request until it gives us concrete evidence.
 */
export declare function filterUnsupportedParameters(body: JsonObject, profile: CapabilityProfile | undefined, policy?: "safe" | "allow", protocol?: GatewayProtocol | string): UnsupportedParameterFilterResult;
export declare function planCapability(input: {
    capability: CapabilityId;
    observation?: CapabilityObservation;
    fallback?: CapabilityFallback;
    fallbackAvailable?: boolean;
}): CapabilityPlan;
/** Maps a provider-native hosted tool type to the stable capability namespace. */
export declare function hostedCapabilityForType(type: string): CapabilityId | undefined;
