export const GATEWAY_SCHEMA_VERSION = 1 as const;

export type GatewayMode = "direct" | "gateway";
export type GatewayProtocol =
  | "responses"
  | "chat_completions"
  | "anthropic"
  | "gemini";
export type GatewayProviderKind =
  | "openai"
  | "chatgpt"
  | "anthropic"
  | "gemini"
  | "custom"
  | "local";
export type GatewayCredentialKind =
  | "auth"
  | "api_key"
  | "oauth"
  | "plugin"
  | "local";
export type GatewayCredentialStatus =
  | "active"
  | "cooldown"
  | "invalid"
  | "expired"
  | "disabled";
export type GatewayRoutingStrategy =
  | "smart"
  | "order"
  | "rotate"
  | "usage"
  | "pace"
  | "weight"
  | "weighted_round_robin";
export type GatewaySessionPolicy = "auto" | "session" | "turn" | "off";

export interface GatewayProviderEndpoints {
  responses?: string;
  chatCompletions?: string;
  anthropicMessages?: string;
  gemini?: string;
}

/** Returns the upstream wire protocols declared by a Provider. */
export function gatewayProviderProtocols(
  provider: Pick<GatewayProviderDefinition, "endpoints">,
): GatewayProtocol[] {
  return [
    provider.endpoints.responses ? "responses" : undefined,
    provider.endpoints.chatCompletions ? "chat_completions" : undefined,
    provider.endpoints.anthropicMessages ? "anthropic" : undefined,
    provider.endpoints.gemini ? "gemini" : undefined,
  ].filter((protocol): protocol is GatewayProtocol => protocol !== undefined);
}

export function gatewayProviderSupportsProtocol(
  provider: Pick<GatewayProviderDefinition, "endpoints">,
  protocol: GatewayProtocol,
): boolean {
  return gatewayProviderProtocols(provider).includes(protocol);
}

export function gatewayCredentialSupportsProtocol(
  credential: Pick<GatewayCredentialDefinition, "supportedProtocols">,
  protocol: GatewayProtocol,
): boolean {
  return credential.supportedProtocols.includes(protocol);
}

export function gatewayModelSupportsProtocol(
  model: Pick<GatewayModelDefinition, "protocols">,
  protocol: GatewayProtocol,
): boolean {
  return model.protocols.includes(protocol);
}

export interface GatewayRouteCompatibilityIssue {
  code:
    | "PROVIDER_NOT_FOUND"
    | "CREDENTIAL_NOT_FOUND"
    | "MODEL_NOT_FOUND"
    | "PROVIDER_MODEL_MISMATCH"
    | "NO_PROTOCOL_INTERSECTION"
    | "NESTED_GROUP_NOT_FOUND";
  routeGroupId?: string;
  modelId?: string;
  providerId?: string;
  credentialId?: string;
  message: string;
}

export interface GatewayProviderDefinition {
  id: string;
  displayName: string;
  kind: GatewayProviderKind;
  endpoints: GatewayProviderEndpoints;
  /** Non-secret headers applied to discovery and upstream requests for this provider. */
  requestHeaders?: Record<string, string>;
  /** Explicit HTTP(S) proxy endpoint for this provider; credentials are never accepted in the URL. */
  proxyUrl?: string;
  modelDiscovery: "manual" | "models_endpoint" | "preset" | "plugin";
  enabled: boolean;
}

export interface GatewayCredentialDefinition {
  id: string;
  providerId: string;
  displayName: string;
  kind: GatewayCredentialKind;
  secretRef: string;
  accountId?: string;
  supportedProtocols: GatewayProtocol[];
  status: GatewayCredentialStatus;
  /** When present, only these upstream model ids may be selected for this credential. */
  modelIds?: string[];
  /** Non-secret headers applied after provider defaults and before credential auth headers. */
  requestHeaders?: Record<string, string>;
  /** Explicit HTTP(S) proxy endpoint for this credential; overrides the provider proxy. */
  proxyUrl?: string;
  weight?: number;
  priority?: number;
}

export interface GatewayModelDefinition {
  id: string;
  providerId: string;
  upstreamModelId: string;
  displayName: string;
  protocols: GatewayProtocol[];
  capabilities: {
    reasoning?: boolean;
    tools?: boolean;
    vision?: boolean;
    streaming?: boolean;
  };
  enabled: boolean;
}

export interface GatewayRouteGroupMember {
  providerId: string;
  modelId: string;
  credentialSelector: {
    credentialIds?: string[];
    providerId?: string;
  };
  priority: number;
  weight: number;
}

export interface GatewayRouteGroupDefinition {
  id: string;
  displayName: string;
  exposedModelId: string;
  members: GatewayRouteGroupMember[];
  /** Nested RouteGroup references imported as group ids without the `group/` prefix. */
  nestedGroupIds?: string[];
  strategy: GatewayRoutingStrategy;
  sessionPolicy: GatewaySessionPolicy;
  fallbackEnabled: boolean;
  capabilities?: {
    reasoning?: boolean;
    tools?: boolean;
    vision?: boolean;
    streaming?: boolean;
  };
}

/** Explicit request-metadata routing only. This schema deliberately has no
 * prompt, classifier, intent, or free-form expression field. */
export interface GatewayRouteRuleMatch {
  tokenCount?: { min?: number; max?: number };
  hasImages?: boolean;
  reasoning?: boolean;
  reasoningProfiles?: string[];
  agentIds?: string[];
  contextCompacted?: boolean;
  time?: { startHour: number; endHour: number; daysOfWeek?: number[]; timezone?: "local" | "utc" };
  modelIds?: string[];
  providerIds?: string[];
}

export interface GatewayRouteRule {
  id: string;
  targetModelId: string;
  priority: number;
  enabled: boolean;
  match: GatewayRouteRuleMatch;
}

/**
 * Environment-scoped gateway configuration.
 *
 * Secrets are intentionally represented by secretRef only. The actual token
 * or API key remains in the existing account/secure-storage path.
 */
export interface GatewayEnvironmentState {
  schemaVersion: typeof GATEWAY_SCHEMA_VERSION;
  mode: GatewayMode;
  gatewayId: string;
  defaultRouteGroupId?: string;
  providers: Record<string, GatewayProviderDefinition>;
  credentials: Record<string, GatewayCredentialDefinition>;
  models: Record<string, GatewayModelDefinition>;
  routeGroups: Record<string, GatewayRouteGroupDefinition>;
  routeRules?: GatewayRouteRule[];
  quota?: {
    windowMinutes: number;
    maxRequests?: number;
    maxTokens?: number;
  };
  catalogVersion: number;
}

const EXCLUDED_GATEWAY_ROUTING_KEYS = new Set([
  "classifier",
  "classifiers",
  "intent",
  "intents",
  "intentrules",
  "intentrulesjson",
  "intentrouting",
  "intentroutingenabled",
  "promptrouting",
  "prompt",
  "prompts",
  "rules",
]);

/** Returns true when a Gateway document contains the permanently unsupported prompt/intent surface. */
export function containsExcludedGatewayRoutingFields(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsExcludedGatewayRoutingFields);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => {
    const normalized = key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
    return EXCLUDED_GATEWAY_ROUTING_KEYS.has(normalized) || containsExcludedGatewayRoutingFields(child);
  });
}

export function isGatewayEnvironmentState(
  value: unknown,
): value is GatewayEnvironmentState {
  if (!isRecord(value)) return false;
  if (containsExcludedGatewayRoutingFields(value)) return false;
  if (value.schemaVersion !== GATEWAY_SCHEMA_VERSION) return false;
  if (value.mode !== "direct" && value.mode !== "gateway") return false;
  if (typeof value.gatewayId !== "string") return false;
  if (!isRecord(value.providers)) return false;
  if (!isRecord(value.credentials)) return false;
  if (!isRecord(value.models)) return false;
  if (!isRecord(value.routeGroups)) return false;
  if (Object.values(value.providers).some((provider) => !isRecord(provider)
    || provider.requestHeaders !== undefined && !isStringMap(provider.requestHeaders)
    || provider.proxyUrl !== undefined && !isGatewayProxyUrl(provider.proxyUrl))) return false;
  if (Object.values(value.credentials).some((credential) => !isRecord(credential)
    || credential.modelIds !== undefined && (!Array.isArray(credential.modelIds) || credential.modelIds.some((modelId) => typeof modelId !== "string"))
    || credential.requestHeaders !== undefined && !isStringMap(credential.requestHeaders)
    || credential.proxyUrl !== undefined && !isGatewayProxyUrl(credential.proxyUrl))) return false;
  if (value.routeRules !== undefined && (!Array.isArray(value.routeRules) || value.routeRules.some((rule) => !isGatewayRouteRule(rule)))) return false;
  return (
    typeof value.catalogVersion === "number" &&
    Number.isInteger(value.catalogVersion) &&
    value.catalogVersion >= 0
  );
}

/**
 * Validates compiled route members without rejecting otherwise readable legacy
 * documents. This is deliberately separate from the shape guard above so an
 * old document can still be migrated and then repaired with diagnostics.
 */
export function validateGatewayRouteCompatibility(
  gateway: Pick<GatewayEnvironmentState, "providers" | "credentials" | "models" | "routeGroups">,
): GatewayRouteCompatibilityIssue[] {
  const issues: GatewayRouteCompatibilityIssue[] = [];
  for (const [groupId, group] of Object.entries(gateway.routeGroups)) {
    for (const nestedGroupId of group.nestedGroupIds ?? []) {
      if (!gateway.routeGroups[nestedGroupId]) {
        issues.push({
          code: "NESTED_GROUP_NOT_FOUND",
          routeGroupId: groupId,
          message: `Route group '${groupId}' references missing group '${nestedGroupId}'`,
        });
      }
    }
    for (const member of group.members) {
      const model = gateway.models[member.modelId];
      const provider = gateway.providers[member.providerId];
      if (!provider) {
        issues.push({
          code: "PROVIDER_NOT_FOUND",
          routeGroupId: groupId,
          modelId: member.modelId,
          providerId: member.providerId,
          message: `Route group '${groupId}' references missing provider '${member.providerId}'`,
        });
        continue;
      }
      if (!model) {
        issues.push({
          code: "MODEL_NOT_FOUND",
          routeGroupId: groupId,
          modelId: member.modelId,
          providerId: member.providerId,
          message: `Route group '${groupId}' references missing model '${member.modelId}'`,
        });
        continue;
      }
      if (model.providerId !== member.providerId) {
        issues.push({
          code: "PROVIDER_MODEL_MISMATCH",
          routeGroupId: groupId,
          modelId: member.modelId,
          providerId: member.providerId,
          message: `Model '${member.modelId}' belongs to provider '${model.providerId}', not '${member.providerId}'`,
        });
        continue;
      }
      const credentialIds = member.credentialSelector.credentialIds ?? Object.values(gateway.credentials)
        .filter((credential) => credential.providerId === member.providerId)
        .map((credential) => credential.id);
      const compatibleCredentials = credentialIds.filter((credentialId) => {
        const credential = gateway.credentials[credentialId];
        if (!credential || credential.providerId !== member.providerId) return false;
        return model.protocols.some((protocol) => (
          gatewayProviderSupportsProtocol(provider, protocol)
          && gatewayCredentialSupportsProtocol(credential, protocol)
        ));
      });
      if (!compatibleCredentials.length) {
        issues.push({
          code: "NO_PROTOCOL_INTERSECTION",
          routeGroupId: groupId,
          modelId: member.modelId,
          providerId: member.providerId,
          credentialId: credentialIds[0],
          message: `Model '${model.displayName}' has no shared protocol with provider '${provider.displayName}' and its selected credentials`,
        });
      }
    }
  }
  return issues;
}

function isGatewayRouteRule(value: unknown): value is GatewayRouteRule {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.targetModelId !== "string"
    || typeof value.priority !== "number" || typeof value.enabled !== "boolean" || !isRecord(value.match)) return false;
  const match = value.match;
  if (match.tokenCount !== undefined && (!isRecord(match.tokenCount)
    || match.tokenCount.min !== undefined && typeof match.tokenCount.min !== "number"
    || match.tokenCount.max !== undefined && typeof match.tokenCount.max !== "number")) return false;
  for (const key of ["reasoningProfiles", "agentIds", "modelIds", "providerIds"] as const) {
    if (match[key] !== undefined && (!Array.isArray(match[key]) || match[key].some((item) => typeof item !== "string"))) return false;
  }
  if (match.hasImages !== undefined && typeof match.hasImages !== "boolean") return false;
  if (match.reasoning !== undefined && typeof match.reasoning !== "boolean") return false;
  if (match.contextCompacted !== undefined && typeof match.contextCompacted !== "boolean") return false;
  if (match.time !== undefined && (!isRecord(match.time)
    || typeof match.time.startHour !== "number" || typeof match.time.endHour !== "number"
    || match.time.daysOfWeek !== undefined && (!Array.isArray(match.time.daysOfWeek) || match.time.daysOfWeek.some((day) => typeof day !== "number"))
    || match.time.timezone !== undefined && match.time.timezone !== "local" && match.time.timezone !== "utc")) return false;
  return true;
}

function isStringMap(value: unknown): value is Record<string, string> {
  const blocked = new Set(["authorization", "cookie", "set-cookie", "proxy-authorization"]);
  return isRecord(value) && Object.entries(value).every(([key, child]) => Boolean(key.trim())
    && !blocked.has(key.trim().toLowerCase())
    && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)
    && typeof child === "string");
}

export function isGatewayProxyUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return (["http:", "https:", "socks5:"].includes(parsed.protocol))
      && !parsed.username && !parsed.password && Boolean(parsed.hostname)
      && (!parsed.port || Number(parsed.port) > 0 && Number(parsed.port) <= 65535);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
