import type { GatewayProtocol } from "../protocol.js";
/** Namespaced capabilities keep model support separate from protocol syntax. */
export type CapabilityId = "input.text" | "input.image" | "input.file" | "output.streaming" | "output.reasoning" | "prompt_cache" | "tools.function" | "tools.parallel" | "tools.custom" | "tools.namespace" | "tools.hosted.web_search" | "tools.hosted.code_interpreter" | "tools.hosted.computer_use";
export type CapabilityStatus = "supported" | "unsupported" | "unknown" | "degraded";
export type CapabilitySource = "provider" | "preset" | "discovery" | "probe" | "observed" | "legacy";
export interface CapabilityObservation {
    status: CapabilityStatus;
    source: CapabilitySource;
    checkedAt?: number;
    expiresAt?: number;
    evidence?: string;
}
export type CapabilityProfile = Readonly<Record<string, CapabilityObservation>>;
export interface CapabilityContext {
    providerId?: string;
    endpoint?: string;
    protocol: GatewayProtocol | string;
    modelId: string;
    credentialId?: string;
}
export interface CapabilityMismatch {
    capability: CapabilityId;
    status: "unsupported";
    evidence: string;
    source: "observed";
    statusCode?: number;
}
export declare function capabilityKey(context: CapabilityContext, capability: CapabilityId): string;
export declare function normalizeEndpoint(value: string | undefined): string;
export declare function normalizeCapabilityObservation(value: unknown, fallbackSource?: CapabilitySource, now?: number): CapabilityObservation | undefined;
export declare function normalizeCapabilityProfile(value: unknown, fallbackSource?: CapabilitySource, now?: number): Record<string, CapabilityObservation>;
export declare function profileFromLegacyCapabilities(capabilities: {
    reasoning?: boolean;
    tools?: boolean;
    vision?: boolean;
    streaming?: boolean;
} | undefined, source?: CapabilitySource): Record<string, CapabilityObservation>;
export declare function capabilityProfileFromModel(value: Record<string, unknown>, source?: CapabilitySource): Record<string, CapabilityObservation>;
/** Conservative built-in rules for providers whose hosted-tool dialect is known. */
export declare function knownCapabilityProfile(context: CapabilityContext): Record<string, CapabilityObservation>;
export declare function mergeCapabilityProfiles(...profiles: Array<CapabilityProfile | undefined>): Record<string, CapabilityObservation>;
export declare function isCapabilityFresh(observation: CapabilityObservation | undefined, now?: number): boolean;
export declare function classifyCapabilityMismatch(input: {
    status?: number;
    message?: string;
    body?: unknown;
    requestedCapabilities?: readonly CapabilityId[];
}): CapabilityMismatch | undefined;
