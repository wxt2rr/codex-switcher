import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type {
  CapabilityContext,
  CapabilityId,
  CapabilityObservation,
  CapabilityProfile,
  CapabilityMismatch,
} from "../../../packages/gateway/dist/capability/index.js";
import { getConfiguredResourcesPath, resolveRuntimeResource } from "./runtime-paths.js";

type GatewayCapabilityModule = typeof import("../../../packages/gateway/dist/capability/index.js");
type CapabilityRegistry = InstanceType<GatewayCapabilityModule["CapabilityRegistry"]>;

let capabilityModule: GatewayCapabilityModule | undefined;

/** Load the shared capability engine without making the CommonJS Electron bundle require ESM. */
export async function initializeGatewayCapabilityRuntime(): Promise<boolean> {
  if (capabilityModule) return true;
  const runtimePath = resolveRuntimeResource(join("packages", "gateway", "dist", "capability", "index.js"), {
    currentFile: typeof __filename === "string" ? __filename : join(process.cwd(), "apps", "desktop", "electron", "gateway-capability-runtime.ts"),
    resourcesPath: getConfiguredResourcesPath(),
  });
  if (!existsSync(runtimePath)) return false;
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<GatewayCapabilityModule>;
    capabilityModule = await dynamicImport(pathToFileURL(runtimePath).href);
    return true;
  } catch {
    capabilityModule = undefined;
    return false;
  }
}

export function createCapabilityRegistry(initial?: Readonly<Record<string, CapabilityObservation>>): CapabilityRegistry {
  if (!capabilityModule) throw new Error("Gateway capability runtime is not initialized");
  return new capabilityModule.CapabilityRegistry(initial);
}

export function observeCapability(
  registry: CapabilityRegistry,
  context: CapabilityContext,
  capability: CapabilityId,
  status: "supported" | "unsupported" | "degraded",
  source: "probe" | "observed",
  evidence?: string,
  ttlMs?: number,
): CapabilityObservation {
  return registry.observe(context, capability, status, source, evidence, ttlMs);
}

export function snapshotCapabilities(registry: CapabilityRegistry): Record<string, CapabilityObservation> {
  return registry.snapshot();
}

export function loadCapabilities(registry: CapabilityRegistry, value: unknown): void {
  registry.load(value);
}

export function mergeCapabilityProfiles(...profiles: Array<CapabilityProfile | undefined>): Record<string, CapabilityObservation> {
  return capabilityModule?.mergeCapabilityProfiles(...profiles) ?? Object.assign({}, ...profiles.map((profile) => profile ?? {}));
}

export function knownCapabilityProfile(context: CapabilityContext): Record<string, CapabilityObservation> {
  return capabilityModule?.knownCapabilityProfile(context) ?? {};
}

export function profileFromLegacyCapabilities(capabilities: { reasoning?: boolean; tools?: boolean; vision?: boolean; streaming?: boolean } | undefined): Record<string, CapabilityObservation> {
  if (capabilityModule) return capabilityModule.profileFromLegacyCapabilities(capabilities);
  if (!capabilities) return {};
  const result: Record<string, CapabilityObservation> = {};
  for (const [id, value] of [["output.reasoning", capabilities.reasoning], ["tools.function", capabilities.tools], ["input.image", capabilities.vision], ["output.streaming", capabilities.streaming]] as const) {
    if (value !== undefined) result[id] = { status: value ? "supported" : "unsupported", source: "legacy" };
  }
  return result;
}

export function filterUnsupportedHostedTools(body: import("../../../packages/gateway/dist/protocol.js").JsonObject, profile: CapabilityProfile | undefined, policy: "safe" | "allow"): ReturnType<GatewayCapabilityModule["filterUnsupportedHostedTools"]> {
  return capabilityModule?.filterUnsupportedHostedTools(body, profile, policy) ?? { body, omitted: [] };
}

export function classifyCapabilityMismatch(input: Parameters<GatewayCapabilityModule["classifyCapabilityMismatch"]>[0]): CapabilityMismatch | undefined {
  return capabilityModule?.classifyCapabilityMismatch(input);
}

export type { CapabilityId, CapabilityObservation, CapabilityProfile, CapabilityMismatch, CapabilityRegistry };
