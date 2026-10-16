import {
  capabilityKey,
  isCapabilityFresh,
  mergeCapabilityProfiles,
  normalizeCapabilityObservation,
  type CapabilityContext,
  type CapabilityId,
  type CapabilityObservation,
  type CapabilityProfile,
  type CapabilitySource,
  type CapabilityStatus,
} from "./contracts.js";

/** In-memory capability cache. The snapshot/load methods let desktop persist it without coupling this package to a filesystem. */
export class CapabilityRegistry {
  private readonly entries = new Map<string, CapabilityObservation>();

  constructor(initial?: Readonly<Record<string, CapabilityObservation>>) {
    for (const [key, value] of Object.entries(initial ?? {})) this.entries.set(key, { ...value });
  }

  get(context: CapabilityContext, capability: CapabilityId, now = Date.now()): CapabilityObservation {
    const exact = this.entries.get(capabilityKey(context, capability));
    if (isCapabilityFresh(exact, now)) return { ...exact! };
    const shared = this.entries.get(capabilityKey({ ...context, credentialId: undefined }, capability));
    if (isCapabilityFresh(shared, now)) return { ...shared! };
    return { status: "unknown", source: "discovery" };
  }

  profile(context: CapabilityContext, now = Date.now()): Record<string, CapabilityObservation> {
    return Object.fromEntries(CAPABILITY_IDS.flatMap((capability) => {
      const observation = this.get(context, capability, now);
      return observation.status === "unknown" ? [] : [[capability, observation]];
    }));
  }

  set(context: CapabilityContext, capability: CapabilityId, observation: CapabilityObservation): void {
    this.entries.set(capabilityKey(context, capability), { ...observation });
  }

  observe(
    context: CapabilityContext,
    capability: CapabilityId,
    status: Exclude<CapabilityStatus, "unknown">,
    source: Extract<CapabilitySource, "probe" | "observed">,
    evidence?: string,
    ttlMs = 24 * 60 * 60 * 1000,
    now = Date.now(),
  ): CapabilityObservation {
    const observation: CapabilityObservation = {
      status,
      source,
      checkedAt: now,
      expiresAt: now + Math.max(60_000, ttlMs),
      ...(evidence ? { evidence: evidence.slice(0, 500) } : {}),
    };
    this.set(context, capability, observation);
    return observation;
  }

  merge(context: CapabilityContext, profile: CapabilityProfile | undefined, now = Date.now()): void {
    const normalized = mergeCapabilityProfiles(profile);
    for (const [id, observation] of Object.entries(normalized)) {
      if (isCapabilityId(id)) this.set(context, id, observation);
    }
    void now;
  }

  snapshot(): Record<string, CapabilityObservation> {
    return Object.fromEntries([...this.entries.entries()].map(([key, value]) => [key, { ...value }]));
  }

  load(value: unknown): void {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, item] of Object.entries(value)) {
      const observation = normalizeCapabilityObservation(item, "observed");
      if (observation) this.entries.set(key, observation);
    }
  }
}

export const CAPABILITY_IDS: readonly CapabilityId[] = [
  "input.text", "input.image", "input.file", "output.streaming", "output.reasoning", "prompt_cache",
  "tools.function", "tools.parallel", "tools.custom", "tools.namespace",
  "tools.hosted.web_search", "tools.hosted.code_interpreter", "tools.hosted.computer_use",
];

export function isCapabilityId(value: string): value is CapabilityId {
  return CAPABILITY_IDS.includes(value as CapabilityId);
}
