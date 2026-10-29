import { capabilityKey, isCapabilityFresh, mergeCapabilityProfiles, normalizeCapabilityObservation, } from "./contracts.js";
/** In-memory capability cache. The snapshot/load methods let desktop persist it without coupling this package to a filesystem. */
export class CapabilityRegistry {
    entries = new Map();
    constructor(initial) {
        for (const [key, value] of Object.entries(initial ?? {}))
            this.entries.set(key, { ...value });
    }
    get(context, capability, now = Date.now()) {
        const exact = this.entries.get(capabilityKey(context, capability));
        if (isCapabilityFresh(exact, now))
            return { ...exact };
        const shared = this.entries.get(capabilityKey({ ...context, credentialId: undefined }, capability));
        if (isCapabilityFresh(shared, now))
            return { ...shared };
        return { status: "unknown", source: "discovery" };
    }
    profile(context, now = Date.now()) {
        return Object.fromEntries(CAPABILITY_IDS.flatMap((capability) => {
            const observation = this.get(context, capability, now);
            return observation.status === "unknown" ? [] : [[capability, observation]];
        }));
    }
    set(context, capability, observation) {
        this.entries.set(capabilityKey(context, capability), { ...observation });
    }
    observe(context, capability, status, source, evidence, ttlMs = 24 * 60 * 60 * 1000, now = Date.now()) {
        const observation = {
            status,
            source,
            checkedAt: now,
            expiresAt: now + Math.max(60_000, ttlMs),
            ...(evidence ? { evidence: evidence.slice(0, 500) } : {}),
        };
        this.set(context, capability, observation);
        return observation;
    }
    merge(context, profile, now = Date.now()) {
        const normalized = mergeCapabilityProfiles(profile);
        for (const [id, observation] of Object.entries(normalized)) {
            if (isCapabilityId(id))
                this.set(context, id, observation);
        }
        void now;
    }
    snapshot() {
        return Object.fromEntries([...this.entries.entries()].map(([key, value]) => [key, { ...value }]));
    }
    load(value) {
        if (!value || typeof value !== "object" || Array.isArray(value))
            return;
        for (const [key, item] of Object.entries(value)) {
            const observation = normalizeCapabilityObservation(item, "observed");
            if (observation)
                this.entries.set(key, observation);
        }
    }
}
export const CAPABILITY_IDS = [
    "input.text", "input.image", "input.file", "output.streaming", "output.reasoning", "prompt_cache",
    "tools.function", "tools.parallel", "tools.strict_pairing", "tools.requires_name", "tools.result_media", "tools.custom", "tools.namespace",
    "schema.ref_siblings", "params.max_completion_tokens",
    "tools.hosted.web_search", "tools.hosted.code_interpreter", "tools.hosted.computer_use",
];
export function isCapabilityId(value) {
    return CAPABILITY_IDS.includes(value);
}
//# sourceMappingURL=registry.js.map