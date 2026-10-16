import { type CapabilityContext, type CapabilityId, type CapabilityObservation, type CapabilityProfile, type CapabilitySource, type CapabilityStatus } from "./contracts.js";
/** In-memory capability cache. The snapshot/load methods let desktop persist it without coupling this package to a filesystem. */
export declare class CapabilityRegistry {
    private readonly entries;
    constructor(initial?: Readonly<Record<string, CapabilityObservation>>);
    get(context: CapabilityContext, capability: CapabilityId, now?: number): CapabilityObservation;
    profile(context: CapabilityContext, now?: number): Record<string, CapabilityObservation>;
    set(context: CapabilityContext, capability: CapabilityId, observation: CapabilityObservation): void;
    observe(context: CapabilityContext, capability: CapabilityId, status: Exclude<CapabilityStatus, "unknown">, source: Extract<CapabilitySource, "probe" | "observed">, evidence?: string, ttlMs?: number, now?: number): CapabilityObservation;
    merge(context: CapabilityContext, profile: CapabilityProfile | undefined, now?: number): void;
    snapshot(): Record<string, CapabilityObservation>;
    load(value: unknown): void;
}
export declare const CAPABILITY_IDS: readonly CapabilityId[];
export declare function isCapabilityId(value: string): value is CapabilityId;
