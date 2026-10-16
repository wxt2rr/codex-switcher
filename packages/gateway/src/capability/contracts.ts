import type { GatewayProtocol } from "../protocol.js";

/** Namespaced capabilities keep model support separate from protocol syntax. */
export type CapabilityId =
  | "input.text"
  | "input.image"
  | "input.file"
  | "output.streaming"
  | "output.reasoning"
  | "prompt_cache"
  | "tools.function"
  | "tools.parallel"
  | "tools.custom"
  | "tools.namespace"
  | "tools.hosted.web_search"
  | "tools.hosted.code_interpreter"
  | "tools.hosted.computer_use";

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

const SOURCE_PRIORITY: Record<CapabilitySource, number> = {
  legacy: 10,
  discovery: 20,
  preset: 30,
  provider: 40,
  probe: 50,
  observed: 60,
};

export function capabilityKey(context: CapabilityContext, capability: CapabilityId): string {
  return [
    context.providerId?.trim().toLowerCase() || "unknown-provider",
    normalizeEndpoint(context.endpoint),
    context.protocol.trim().toLowerCase() || "unknown-protocol",
    context.modelId.trim(),
    context.credentialId?.trim() || "*",
    capability,
  ].join("|");
}

export function normalizeEndpoint(value: string | undefined): string {
  if (!value?.trim()) return "*";
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return value.trim().replace(/\/$/, "").toLowerCase();
  }
}

export function normalizeCapabilityObservation(
  value: unknown,
  fallbackSource: CapabilitySource = "discovery",
  now = Date.now(),
): CapabilityObservation | undefined {
  if (value === true) return { status: "supported", source: fallbackSource, checkedAt: now };
  if (value === false) return { status: "unsupported", source: fallbackSource, checkedAt: now };
  if (typeof value === "string" && isCapabilityStatus(value)) {
    return { status: value, source: fallbackSource, checkedAt: now };
  }
  if (!isRecord(value) || !isCapabilityStatus(value.status)) return undefined;
  const source = isCapabilitySource(value.source) ? value.source : fallbackSource;
  return {
    status: value.status,
    source,
    ...(typeof value.checkedAt === "number" ? { checkedAt: value.checkedAt } : { checkedAt: now }),
    ...(typeof value.expiresAt === "number" ? { expiresAt: value.expiresAt } : {}),
    ...(typeof value.evidence === "string" ? { evidence: value.evidence.slice(0, 500) } : {}),
  };
}

export function normalizeCapabilityProfile(
  value: unknown,
  fallbackSource: CapabilitySource = "discovery",
  now = Date.now(),
): Record<string, CapabilityObservation> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const observation = normalizeCapabilityObservation(item, fallbackSource, now);
    return observation ? [[key, observation]] : [];
  }));
}

export function profileFromLegacyCapabilities(
  capabilities: {
    reasoning?: boolean;
    tools?: boolean;
    vision?: boolean;
    streaming?: boolean;
  } | undefined,
  source: CapabilitySource = "legacy",
): Record<string, CapabilityObservation> {
  if (!capabilities) return {};
  const result: Record<string, CapabilityObservation> = {};
  const add = (id: CapabilityId, value: boolean | undefined): void => {
    if (value !== undefined) result[id] = { status: value ? "supported" : "unsupported", source };
  };
  add("output.reasoning", capabilities.reasoning);
  add("tools.function", capabilities.tools);
  add("input.image", capabilities.vision);
  add("output.streaming", capabilities.streaming);
  return result;
}

export function capabilityProfileFromModel(value: Record<string, unknown>, source: CapabilitySource = "discovery"): Record<string, CapabilityObservation> {
  const result = profileFromLegacyCapabilities({
    reasoning: value.reasoning === true ? true : value.reasoning === false ? false : undefined,
    tools: value.tools === true ? true : value.tools === false ? false : undefined,
    vision: value.vision === true ? true : value.vision === false ? false : undefined,
    streaming: value.streaming === true ? true : value.streaming === false ? false : undefined,
  }, source);
  const explicit = value.capabilityProfile ?? value.capabilities;
  Object.assign(result, normalizeCapabilityProfile(explicit, source));
  const search = value.supports_search_tool ?? value.supportsSearchTool;
  if (typeof search === "boolean") result["tools.hosted.web_search"] = { status: search ? "supported" : "unsupported", source };
  return result;
}

/** Conservative built-in rules for providers whose hosted-tool dialect is known. */
export function knownCapabilityProfile(context: CapabilityContext): Record<string, CapabilityObservation> {
  const provider = context.providerId?.trim().toLowerCase() ?? "";
  const endpoint = normalizeEndpoint(context.endpoint);
  const model = context.modelId.trim().toLowerCase();
  const result: Record<string, CapabilityObservation> = {};
  if (endpoint.includes("dashscope.aliyuncs.com") && /kimi|moonshot|k[23]/i.test(model) && context.protocol === "chat_completions") {
    result["tools.hosted.web_search"] = { status: "unsupported", source: "preset", evidence: "DashScope compatible-mode Kimi Chat Completions does not accept OpenAI hosted web_search" };
  }
  if ((provider === "openai" || provider === "chatgpt" || provider === "codex") && endpoint.includes("api.openai.com") && context.protocol === "responses") {
    result["tools.hosted.web_search"] = { status: "supported", source: "preset" };
  }
  return result;
}

export function mergeCapabilityProfiles(
  ...profiles: Array<CapabilityProfile | undefined>
): Record<string, CapabilityObservation> {
  const result: Record<string, CapabilityObservation> = {};
  for (const profile of profiles) {
    for (const [id, observation] of Object.entries(profile ?? {})) {
      const previous = result[id];
      if (!previous || shouldReplace(previous, observation)) result[id] = { ...observation };
    }
  }
  return result;
}

export function isCapabilityFresh(observation: CapabilityObservation | undefined, now = Date.now()): boolean {
  return Boolean(observation && (observation.expiresAt === undefined || observation.expiresAt > now));
}

export function classifyCapabilityMismatch(input: {
  status?: number;
  message?: string;
  body?: unknown;
  requestedCapabilities?: readonly CapabilityId[];
}): CapabilityMismatch | undefined {
  const message = [input.message, errorText(input.body)].filter(Boolean).join(" ").toLowerCase();
  const status = input.status;
  if (!message || (status !== undefined && status < 400)) return undefined;
  const requested = input.requestedCapabilities ?? [];
  const evidence = (input.message || errorText(input.body) || "Upstream rejected capability").slice(0, 500);
  const hostedRequested = requested.filter((capability) => capability.startsWith("tools.hosted."));
  const explicit = [
    ["tools.hosted.web_search", [/web[_ -]?search|search_options|hosted.*search|\$web_search|search tool/]],
    ["tools.hosted.code_interpreter", [/code[_ -]?interpreter|python tool|container tool/]],
    ["tools.hosted.computer_use", [/computer[_ -]?use|computer tool|mouse|keyboard/]],
    ["tools.parallel", [/parallel.*tool|multiple tool|too many tool calls/]],
    ["tools.function", [/function.*tool|tool.*function|tool_calls|invalid tool/]],
  ] as const;
  for (const [capability, patterns] of explicit) {
    if (requested.includes(capability) && patterns.some((pattern) => pattern.test(message))) {
      return { capability, status: "unsupported", source: "observed", statusCode: status, evidence };
    }
  }
  // Generic schema errors are only useful when the request contains one
  // Hosted Tool. With several hosted tools present, guessing would poison the
  // cache and cause the wrong tool to be removed on future requests.
  if (hostedRequested.length === 1 && /function.*required|expected.*object|invalid.*tool|tool.*schema/.test(message)) {
    return { capability: hostedRequested[0], status: "unsupported", source: "observed", statusCode: status, evidence };
  }
  return undefined;
}

function shouldReplace(previous: CapabilityObservation, next: CapabilityObservation): boolean {
  const previousTime = previous.checkedAt ?? 0;
  const nextTime = next.checkedAt ?? 0;
  if (nextTime !== previousTime) return nextTime > previousTime;
  return SOURCE_PRIORITY[next.source] >= SOURCE_PRIORITY[previous.source];
}

function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "";
  const error = isRecord(value.error) ? value.error : value;
  return [error.message, error.code, error.type, error.detail].filter((item): item is string => typeof item === "string").join(" ");
}

function isCapabilityStatus(value: unknown): value is CapabilityStatus {
  return value === "supported" || value === "unsupported" || value === "unknown" || value === "degraded";
}

function isCapabilitySource(value: unknown): value is CapabilitySource {
  return value === "provider" || value === "preset" || value === "discovery" || value === "probe" || value === "observed" || value === "legacy";
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
