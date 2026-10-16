import type { CapabilityId, CapabilityObservation, CapabilityProfile, CapabilityStatus } from "./contracts.js";
import type { JsonObject } from "../protocol.js";
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
/** Removes only hosted tools that the selected route cannot safely encode. */
export declare function filterUnsupportedHostedTools(body: JsonObject, profile: CapabilityProfile | undefined, policy?: "safe" | "allow"): HostedToolFilterResult;
export declare function planCapability(input: {
    capability: CapabilityId;
    observation?: CapabilityObservation;
    fallback?: CapabilityFallback;
    fallbackAvailable?: boolean;
}): CapabilityPlan;
/** Maps a provider-native hosted tool type to the stable capability namespace. */
export declare function hostedCapabilityForType(type: string): CapabilityId | undefined;
