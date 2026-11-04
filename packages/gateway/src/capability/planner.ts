import { isCapabilityFresh, type CapabilityId, type CapabilityObservation, type CapabilityProfile, type CapabilityStatus } from "./contracts.js";
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
  omitted: Array<{ type: string; capability: CapabilityId; reason: string }>;
}

export interface UnsupportedParameterFilterResult {
  body: JsonObject;
  omitted: Array<{ field: string; capability: CapabilityId; reason: string }>;
}

/** Removes only hosted tools that the selected route cannot safely encode. */
export function filterUnsupportedHostedTools(
  body: JsonObject,
  profile: CapabilityProfile | undefined,
  policy: "safe" | "allow" = "allow",
): HostedToolFilterResult {
  if (policy === "allow" || !Array.isArray(body.tools)) return { body, omitted: [] };
  const omitted: HostedToolFilterResult["omitted"] = [];
  const tools = body.tools.filter((raw) => {
    if (!isRecord(raw)) return true;
    const type = typeof raw.type === "string" ? raw.type : "";
    const capability = hostedCapabilityForType(type);
    if (!capability) return true;
    const observation = profile?.[capability];
    if (observation?.status === "supported" && isCapabilityFresh(observation)) return true;
    const unsupported = observation?.status === "unsupported" && isCapabilityFresh(observation);
    omitted.push({ type, capability, reason: unsupported ? "unsupported" : "unknown" });
    return false;
  });
  if (!omitted.length) return { body, omitted };
  const next: JsonObject = { ...body };
  if (tools.length) next.tools = tools as JsonObject["tools"];
  else delete next.tools;
  const choice = next.tool_choice;
  const choiceType = typeof choice === "string" ? choice
    : isRecord(choice) && typeof choice.type === "string" ? choice.type
      : undefined;
  const choiceName = isRecord(choice)
    ? typeof choice.name === "string" ? choice.name : isRecord(choice.function) && typeof choice.function.name === "string" ? choice.function.name : undefined
    : undefined;
  if ((choiceType && omitted.some((item) => item.type === choiceType)) || (choiceName && omitted.some((item) => item.type === choiceName))) delete next.tool_choice;
  // A required choice cannot be satisfied after all hosted tools have been
  // removed. Leaving it in the payload makes otherwise valid degraded
  // requests fail again with an invalid tool_choice error.
  if (!tools.length && next.tool_choice !== undefined) delete next.tool_choice;
  return { body: next, omitted };
}

/**
 * Removes only sampling parameters that the selected route explicitly marks
 * unsupported. Unknown capabilities are preserved so a legacy provider keeps
 * receiving the same request until it gives us concrete evidence.
 */
export function filterUnsupportedParameters(
  body: JsonObject,
  profile: CapabilityProfile | undefined,
  policy: "safe" | "allow" = "allow",
  protocol?: GatewayProtocol | string,
): UnsupportedParameterFilterResult {
  if (policy === "allow") return { body, omitted: [] };
  const fields = parameterFieldsForProtocol(protocol);
  const omitted: UnsupportedParameterFilterResult["omitted"] = [];
  const next: JsonObject = { ...body };
  let generationConfig: JsonObject | undefined;
  let generationConfigKey: "generationConfig" | "generation_config" | undefined;
  for (const field of fields) {
    const observation = profile?.[field.capability];
    if (observation?.status !== "unsupported" || !isCapabilityFresh(observation)) continue;
    if (field.path === "generationConfig") {
      const rawConfig = isRecord(next.generationConfig)
        ? next.generationConfig
        : isRecord(next.generation_config) ? next.generation_config : undefined;
      if (!rawConfig) continue;
      generationConfigKey ??= isRecord(next.generationConfig) ? "generationConfig" : "generation_config";
      generationConfig ??= { ...rawConfig };
      for (const key of field.keys) {
        if (Object.prototype.hasOwnProperty.call(generationConfig, key)) {
          delete generationConfig[key];
          omitted.push({ field: key, capability: field.capability, reason: "unsupported" });
        }
      }
    } else {
      for (const key of field.keys) {
        if (Object.prototype.hasOwnProperty.call(next, key)) {
          delete next[key];
          omitted.push({ field: key, capability: field.capability, reason: "unsupported" });
        }
      }
    }
  }
  if (generationConfig && generationConfigKey) next[generationConfigKey] = generationConfig;
  return omitted.length ? { body: next, omitted } : { body, omitted: [] };
}

function parameterFieldsForProtocol(protocol: GatewayProtocol | string | undefined): Array<{ capability: CapabilityId; keys: string[]; path?: "generationConfig" }> {
  if (protocol === "gemini") {
    return [
      { capability: "params.temperature", keys: ["temperature"], path: "generationConfig" },
      { capability: "params.top_p", keys: ["topP", "top_p"], path: "generationConfig" },
      { capability: "params.top_k", keys: ["topK", "top_k"], path: "generationConfig" },
    ];
  }
  const fields: Array<{ capability: CapabilityId; keys: string[] }> = [
    { capability: "params.temperature", keys: ["temperature"] },
    { capability: "params.top_p", keys: ["top_p"] },
  ];
  if (protocol === "chat_completions" || protocol === "anthropic") fields.push({ capability: "params.top_k", keys: ["top_k"] });
  return fields;
}

export function planCapability(input: {
  capability: CapabilityId;
  observation?: CapabilityObservation;
  fallback?: CapabilityFallback;
  fallbackAvailable?: boolean;
}): CapabilityPlan {
  const status = input.observation && isCapabilityFresh(input.observation) ? input.observation.status : "unknown";
  if (status === "supported") return { capability: input.capability, status, action: "native", reason: "Capability is supported by the selected route" };
  if (status === "unsupported") {
    if (input.fallback === "fallback" && input.fallbackAvailable) return { capability: input.capability, status, action: "fallback", reason: "Native capability is unavailable; fallback is configured" };
    if (input.fallback === "required") return { capability: input.capability, status, action: "error", reason: "The request requires an unsupported capability" };
    return { capability: input.capability, status, action: "omit", reason: "Native capability is unavailable; safe degradation removed it" };
  }
  if (input.fallback === "required") return { capability: input.capability, status, action: "probe", reason: "Capability is unknown and must be verified before sending" };
  if (input.fallback === "fallback" && input.fallbackAvailable) return { capability: input.capability, status, action: "fallback", reason: "Capability is unknown; configured fallback will handle it" };
  return { capability: input.capability, status, action: "omit", reason: "Capability is unknown; fail-safe mode avoids an incompatible tool shape" };
}

/** Maps a provider-native hosted tool type to the stable capability namespace. */
export function hostedCapabilityForType(type: string): CapabilityId | undefined {
  if (["web_search", "web_search_preview", "web_search_options"].includes(type)) return "tools.hosted.web_search";
  if (["code_interpreter", "code_interpreter_preview", "python"].includes(type)) return "tools.hosted.code_interpreter";
  if (["computer_use", "computer_use_preview"].includes(type)) return "tools.hosted.computer_use";
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
