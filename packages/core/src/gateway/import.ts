import {
  GATEWAY_SCHEMA_VERSION,
  type GatewayCredentialDefinition,
  type GatewayEnvironmentState,
  type GatewayModelDefinition,
  type GatewayProtocol,
  type GatewayProviderDefinition,
  type GatewayRouteRule,
  type GatewayRouteGroupDefinition,
  isGatewayProxyUrl,
} from "./model.js";
import type { GatewayAgentBindingV2 } from "./v2.js";

const EXCLUDED_ROUTING_FIELDS = new Set(["classifier", "classifiers", "intent", "intents", "intentrules", "intentrulesjson", "intentrouting", "intentroutingenabled", "promptrouting", "prompt", "prompts", "rules"]);

export interface GatewayImportResult {
  sourceFormat: "provider_gateway" | "gateway" | "generic";
  gateway: GatewayEnvironmentState;
  agentBindings: Record<string, GatewayAgentBindingV2>;
  warnings: string[];
  excludedFields: string[];
}

export interface GatewayImportPreview {
  sourceFormat: GatewayImportResult["sourceFormat"];
  providers: number;
  credentials: number;
  models: number;
  routeGroups: number;
  agents: number;
  warnings: string[];
  excludedFields: string[];
}

export function importGatewayConfiguration(source: unknown, environmentId: string): GatewayImportResult {
  const parsedInput = parseSource(source);
  const excludedFields = findExcludedFields(parsedInput);
  const input = stripExcludedRoutingFields(parsedInput);
  const warnings: string[] = [];
  if (excludedFields.length) warnings.push(`Excluded unsupported routing fields: ${excludedFields.join(", ")}`);

  if (isGatewayShape(input)) {
    const gateway = importGatewayShape(input, environmentId, warnings);
    return { sourceFormat: "gateway", gateway, agentBindings: importAgentBindings(input.agentBindings ?? input.agents, gateway.gatewayId, environmentId, warnings), warnings, excludedFields };
  }

  const sourceFormat = Array.isArray(input.providers) || Array.isArray(input.groups) ? "provider_gateway" : "generic";
  const providers: Record<string, GatewayProviderDefinition> = {};
  const credentials: Record<string, GatewayCredentialDefinition> = {};
  const models: Record<string, GatewayModelDefinition> = {};
  for (const [index, raw] of readEntries(input.providers).entries()) {
    const providerId = safeId(readString(raw, "id", "name") || `provider-${index + 1}`);
    const provider = buildProvider(providerId, raw);
    providers[provider.id] = provider;
    for (const upstreamModelId of readModelIds(raw.models)) {
      const modelId = `${provider.id}/${safeModelId(upstreamModelId)}`;
      models[modelId] = buildModel(modelId, provider, upstreamModelId);
    }
    for (const credential of buildCredentials(raw, provider, environmentId, warnings)) credentials[credential.id] = credential;
  }
  for (const [index, raw] of readEntries(input.models).entries()) {
    const providerId = safeId(readString(raw, "providerId", "provider", "vendor") || "custom");
    const upstreamModelId = readString(raw, "upstreamModelId", "model", "id") || `model-${index + 1}`;
    const provider = providers[providerId] ?? (providers[providerId] = buildProvider(providerId, { id: providerId, name: providerId }));
    const modelId = `${provider.id}/${safeModelId(upstreamModelId)}`;
    models[modelId] ??= buildModel(modelId, provider, upstreamModelId, raw);
  }
  const routeGroups = buildRouteGroups(input.groups, providers, credentials, models, warnings);
  if (!Object.keys(routeGroups).length) {
    for (const model of Object.values(models)) {
      const groupId = `model-${safeId(model.id)}`;
      routeGroups[groupId] = { id: groupId, displayName: model.displayName, exposedModelId: model.id, members: [{ providerId: model.providerId, modelId: model.id, credentialSelector: credentialSelector(credentials, model.providerId), priority: 0, weight: 1 }], strategy: "smart", sessionPolicy: "auto", fallbackEnabled: true };
    }
  }
  const routeRules = importRouteRules(input.routeRules, warnings);
  const gateway: GatewayEnvironmentState = { schemaVersion: GATEWAY_SCHEMA_VERSION, mode: "direct", gatewayId: `gateway-${safeId(environmentId)}`, providers, credentials, models, routeGroups, ...(routeRules.length ? { routeRules } : {}), defaultRouteGroupId: Object.keys(routeGroups)[0], catalogVersion: 1 };
  const agentBindings = importAgentBindings(input.agentBindings ?? input.agents, gateway.gatewayId, environmentId, warnings);
  return { sourceFormat, gateway, agentBindings, warnings, excludedFields };
}

export function previewGatewayImport(source: unknown, environmentId: string): GatewayImportPreview {
  const result = importGatewayConfiguration(source, environmentId);
  return { sourceFormat: result.sourceFormat, providers: Object.keys(result.gateway.providers).length, credentials: Object.keys(result.gateway.credentials).length, models: Object.keys(result.gateway.models).length, routeGroups: Object.keys(result.gateway.routeGroups).length, agents: Object.keys(result.agentBindings).length, warnings: result.warnings, excludedFields: result.excludedFields };
}

function importGatewayShape(input: Record<string, unknown>, environmentId: string, warnings: string[]): GatewayEnvironmentState {
  const gateway = JSON.parse(JSON.stringify(input)) as GatewayEnvironmentState;
  gateway.schemaVersion = GATEWAY_SCHEMA_VERSION;
  gateway.gatewayId = typeof input.gatewayId === "string" && input.gatewayId.trim() ? input.gatewayId : `gateway-${safeId(environmentId)}`;
  gateway.mode = "direct";
  gateway.catalogVersion = typeof input.catalogVersion === "number" ? input.catalogVersion : 1;
  gateway.providers = importProviderMap(input.providers, warnings);
  gateway.credentials = importCredentialMap(input.credentials, environmentId, warnings);
  gateway.models = importModelMap(input.models, gateway.providers);
  gateway.routeGroups = importRouteGroupMap(input.routeGroups, gateway.models, gateway.credentials, warnings);
  const routeRules = importRouteRules(input.routeRules, warnings);
  if (routeRules.length) gateway.routeRules = routeRules;
  delete (gateway as unknown as Record<string, unknown>).agentBindings;
  delete (gateway as unknown as Record<string, unknown>).agents;
  delete (gateway as unknown as Record<string, unknown>).rules;
  delete (gateway as unknown as Record<string, unknown>).classifier;
  delete (gateway as unknown as Record<string, unknown>).intentRules;
  return gateway;
}

function buildProvider(id: string, raw: Record<string, unknown>): GatewayProviderDefinition {
  const endpoints: GatewayProviderDefinition["endpoints"] = {};
  const rawEndpoints = asRecord(raw.endpoints);
  const responses = readString(raw, "responses", "responsesBaseUrl") || readString(rawEndpoints, "responses");
  const chat = readString(raw, "chat", "chatCompletions", "chatCompletionsBaseUrl") || readString(rawEndpoints, "chatCompletions");
  const anthropic = readString(raw, "anthropic", "anthropicMessages", "anthropicBaseUrl") || readString(rawEndpoints, "anthropicMessages");
  const gemini = readString(raw, "gemini", "geminiBaseUrl") || readString(rawEndpoints, "gemini");
  if (responses) endpoints.responses = normalizeUrl(responses);
  if (chat) endpoints.chatCompletions = normalizeUrl(chat);
  if (anthropic) endpoints.anthropicMessages = normalizeUrl(anthropic);
  if (gemini) endpoints.gemini = normalizeUrl(gemini);
  const kind: GatewayProviderDefinition["kind"] = id === "chatgpt" || id === "codex" ? "chatgpt" : anthropic ? "anthropic" : gemini ? "gemini" : responses || chat ? "openai" : "custom";
  const requestHeaders = readStringMap(raw.requestHeaders);
  const proxyUrl = readProxyUrl(raw.proxyUrl);
  return { id, displayName: readString(raw, "name", "displayName") || id, kind, endpoints, ...(Object.keys(requestHeaders).length ? { requestHeaders } : {}), ...(proxyUrl ? { proxyUrl } : {}), modelDiscovery: "manual", enabled: raw.off !== true && raw.disabled !== true };
}

function buildModel(id: string, provider: GatewayProviderDefinition, upstreamModelId: string, raw?: Record<string, unknown>): GatewayModelDefinition {
  const protocols: GatewayProtocol[] = [];
  if (provider.endpoints.responses) protocols.push("responses");
  if (provider.endpoints.chatCompletions) protocols.push("chat_completions");
  if (provider.endpoints.anthropicMessages) protocols.push("anthropic");
  if (provider.endpoints.gemini) protocols.push("gemini");
  return { id, providerId: provider.id, upstreamModelId, displayName: readString(raw, "displayName", "name") || upstreamModelId, protocols: protocols.length ? protocols : ["responses"], capabilities: { reasoning: raw?.reasoning === true || raw?.supportsReasoning === true, tools: raw?.tools !== false, vision: raw?.vision === true || raw?.supportsVision === true, streaming: raw?.streaming !== false }, enabled: raw?.enabled !== false };
}

function buildCredentials(raw: Record<string, unknown>, provider: GatewayProviderDefinition, environmentId: string, warnings: string[]): GatewayCredentialDefinition[] {
  const keys = [...(typeof raw.key === "string" && raw.key.trim() ? [raw.key] : []), ...(Array.isArray(raw.keys) ? raw.keys : [])];
  const count = Math.max(keys.length, raw.accountId || raw.authMode || provider.kind === "chatgpt" ? 1 : 0);
  if (!count) {
    warnings.push(`Provider '${provider.id}' has no imported credential; add a local secret reference before enabling it.`);
    return [{ id: `credential:${safeId(environmentId)}:${provider.id}:imported`, providerId: provider.id, displayName: provider.displayName, kind: "api_key", secretRef: `imported:${safeId(environmentId)}:${provider.id}`, supportedProtocols: ["responses"], status: "disabled", weight: 1, priority: 0 }];
  }
  if (keys.length) warnings.push(`Provider '${provider.id}' contained key material; keys were discarded and must be re-entered through secure storage.`);
  const modelIds = readModelIds(raw.modelIds);
  const requestHeaders = readStringMap(raw.requestHeaders);
  const proxyUrl = readProxyUrl(raw.proxyUrl);
  return Array.from({ length: count }, (_, index) => ({ id: `credential:${safeId(environmentId)}:${provider.id}:${index + 1}`, providerId: provider.id, displayName: `${provider.displayName} ${index + 1}`, kind: provider.kind === "chatgpt" ? "auth" as const : "api_key" as const, secretRef: `imported:${safeId(environmentId)}:${provider.id}:${index + 1}`, supportedProtocols: ["responses", "chat_completions", "anthropic", "gemini"].filter((protocol) => protocolSupported(provider, protocol as GatewayProtocol)) as GatewayProtocol[], status: "disabled" as const, ...(modelIds.length ? { modelIds } : {}), ...(Object.keys(requestHeaders).length ? { requestHeaders } : {}), ...(proxyUrl ? { proxyUrl } : {}), weight: 1, priority: index }));
}

function buildRouteGroups(rawGroups: unknown, providers: Record<string, GatewayProviderDefinition>, credentials: Record<string, GatewayCredentialDefinition>, models: Record<string, GatewayModelDefinition>, warnings: string[]): Record<string, GatewayRouteGroupDefinition> {
  const groups: Record<string, GatewayRouteGroupDefinition> = {};
  for (const [index, raw] of readEntries(rawGroups).entries()) {
    const id = safeId(readString(raw, "id", "name") || `group-${index + 1}`);
    const members: GatewayRouteGroupDefinition["members"] = [];
    const nestedGroupIds = new Set<string>();
    const memberValues = Array.isArray(raw.members) ? raw.members : Array.isArray(raw.models) ? raw.models : [];
    for (const [priority, member] of memberValues.entries()) {
      const memberRecord = asRecord(member);
      const explicitModelId = readString(memberRecord, "modelId");
      const ref = typeof member === "string" ? member : readString(memberRecord, "id", "model", "ref") || (explicitModelId ? `${readString(memberRecord, "providerId", "provider")}/${explicitModelId}` : "");
      if (!ref) {
        continue;
      }
      if (ref.startsWith("group/")) {
        const nestedId = safeId(ref.slice("group/".length));
        if (nestedId !== "custom" && nestedId !== id) nestedGroupIds.add(nestedId);
        continue;
      }
      const [providerPart, ...modelParts] = ref.split("/");
      const upstream = modelParts.join("/") || ref;
      const providerId = safeId(readString(memberRecord, "providerId", "provider") || providerPart || "custom");
      const model = (explicitModelId ? models[explicitModelId] : undefined) ?? Object.values(models).find((item) => item.providerId === providerId && item.upstreamModelId === upstream) ?? Object.values(models).find((item) => item.id === ref);
      if (!model || !providers[providerId]) {
        warnings.push(`Group '${id}' member '${ref}' was skipped because its provider/model is unavailable.`);
        continue;
      }
      members.push({ providerId, modelId: model.id, credentialSelector: credentialSelector(credentials, providerId), priority, weight: 1 });
    }
    if (!members.length && !nestedGroupIds.size) continue;
    groups[id] = {
      id,
      displayName: readString(raw, "name", "displayName") || id,
      exposedModelId: `group/${id}`,
      members,
      ...(nestedGroupIds.size ? { nestedGroupIds: [...nestedGroupIds] } : {}),
      strategy: mapStrategy(readString(raw, "routing", "strategy")),
      sessionPolicy: mapSession(readString(raw, "affinity", "sessionPolicy")),
      fallbackEnabled: raw.fallbackEnabled !== false && raw.disabled !== true,
    };
  }
  return groups;
}

function importAgentBindings(rawAgents: unknown, gatewayId: string, environmentId: string, warnings: string[]): Record<string, GatewayAgentBindingV2> {
  const bindings: Record<string, GatewayAgentBindingV2> = {};
  for (const [index, raw] of readEntries(rawAgents).entries()) {
    const agentId = safeId(readString(raw, "agentId", "id", "name") || `agent-${index + 1}`);
    const model = readString(raw, "defaultModelId", "model", "modelId", "exposedModelId");
    const routeGroupId = readString(raw, "defaultRouteGroupId", "routeGroupId", "group");
    const reasoningProfile = readString(raw, "reasoningProfile", "reasoning", "reasoningEffort");
    const fallbackModelId = readString(raw, "fallbackModelId", "fallbackModel", "backupModel");
    const subAgentModelId = readString(raw, "subAgentModelId", "subAgentModel", "subagentModel");
    if (!model) warnings.push(`Agent '${agentId}' was imported without a default model; it remains disconnected.`);
    bindings[agentId] = {
      agentId,
      displayName: readString(raw, "displayName", "name") || agentId,
      ...(model ? { defaultModelId: model } : {}),
      ...(routeGroupId ? { defaultRouteGroupId: routeGroupId } : {}),
      ...(reasoningProfile ? { reasoningProfile } : {}),
      ...(fallbackModelId ? { fallbackModelId } : {}),
      ...(subAgentModelId ? { subAgentModelId } : {}),
      gatewayId,
      originalConfigRef: `import/${safeId(environmentId)}/${agentId}`,
      enabled: raw.enabled !== false,
    };
  }
  return bindings;
}

function importProviderMap(raw: unknown, warnings: string[]): Record<string, GatewayProviderDefinition> {
  const result: Record<string, GatewayProviderDefinition> = {};
  for (const [id, value] of Object.entries(asRecord(raw))) result[id] = buildProvider(safeId(id), asRecord(value));
  if (!Object.keys(result).length) warnings.push("Imported gateway has no providers.");
  return result;
}

function importCredentialMap(raw: unknown, environmentId: string, warnings: string[]): Record<string, GatewayCredentialDefinition> {
  const result: Record<string, GatewayCredentialDefinition> = {};
  for (const [id, value] of Object.entries(asRecord(raw))) {
    const entry = asRecord(value);
    const providerId = safeId(readString(entry, "providerId", "provider") || "custom");
    const modelIds = readModelIds(entry.modelIds);
    const requestHeaders = readStringMap(entry.requestHeaders);
    const proxyUrl = readProxyUrl(entry.proxyUrl);
    result[id] = { id, providerId, displayName: readString(entry, "displayName", "name") || id, kind: entry.kind === "auth" || entry.kind === "oauth" || entry.kind === "plugin" || entry.kind === "local" ? entry.kind : "api_key", secretRef: readString(entry, "secretRef") || `imported:${safeId(environmentId)}:${providerId}:${safeId(id)}`, supportedProtocols: readProtocols(entry.supportedProtocols), status: entry.status === "active" || entry.status === "cooldown" || entry.status === "invalid" || entry.status === "expired" ? entry.status : "disabled", ...(modelIds.length ? { modelIds } : {}), ...(Object.keys(requestHeaders).length ? { requestHeaders } : {}), ...(proxyUrl ? { proxyUrl } : {}), ...(typeof entry.weight === "number" ? { weight: entry.weight } : {}), ...(typeof entry.priority === "number" ? { priority: entry.priority } : {}) };
    if ("key" in entry || "secret" in entry || "token" in entry) warnings.push(`Credential '${id}' contained secret material; it was discarded.`);
  }
  return result;
}

function importModelMap(raw: unknown, providers: Record<string, GatewayProviderDefinition>): Record<string, GatewayModelDefinition> {
  const result: Record<string, GatewayModelDefinition> = {};
  for (const [id, value] of Object.entries(asRecord(raw))) {
    const entry = asRecord(value);
    const providerId = safeId(readString(entry, "providerId", "provider") || "custom");
    const provider = providers[providerId] ?? buildProvider(providerId, { id: providerId, name: providerId });
    result[id] = buildModel(id, provider, readString(entry, "upstreamModelId", "model") || id, entry);
  }
  return result;
}

function importRouteGroupMap(raw: unknown, models: Record<string, GatewayModelDefinition>, credentials: Record<string, GatewayCredentialDefinition>, warnings: string[]): Record<string, GatewayRouteGroupDefinition> {
  const providers = Object.fromEntries(Object.values(models).map((model) => [model.providerId, buildProvider(model.providerId, { id: model.providerId })]));
  return buildRouteGroups(Object.values(asRecord(raw)), providers, credentials, models, warnings);
}

function importRouteRules(raw: unknown, warnings: string[]): GatewayRouteRule[] {
  const rules: GatewayRouteRule[] = [];
  for (const [index, entry] of readEntries(raw).entries()) {
    const match = asRecord(entry.match);
    const targetModelId = readString(entry, "targetModelId", "targetRouteGroupId", "modelId");
    if (!targetModelId) {
      warnings.push(`Route rule '${readString(entry, "id") || index + 1}' was skipped because it has no explicit targetModelId.`);
      continue;
    }
    const tokenCount = asRecord(match.tokenCount);
    const time = asRecord(match.time);
    const normalized: GatewayRouteRule = {
      id: safeId(readString(entry, "id") || `rule-${index + 1}`),
      targetModelId,
      priority: typeof entry.priority === "number" && Number.isFinite(entry.priority) ? entry.priority : index,
      enabled: entry.enabled !== false,
      match: {
        ...(typeof tokenCount.min === "number" ? { tokenCount: { min: tokenCount.min } } : {}),
        ...(typeof tokenCount.max === "number" ? { tokenCount: { ...(typeof tokenCount.min === "number" ? { min: tokenCount.min } : {}), max: tokenCount.max } } : {}),
        ...(typeof match.hasImages === "boolean" ? { hasImages: match.hasImages } : {}),
        ...(typeof match.reasoning === "boolean" ? { reasoning: match.reasoning } : {}),
        ...(Array.isArray(match.reasoningProfiles) ? { reasoningProfiles: match.reasoningProfiles.filter((item): item is string => typeof item === "string") } : {}),
        ...(Array.isArray(match.agentIds) ? { agentIds: match.agentIds.filter((item): item is string => typeof item === "string") } : {}),
        ...(typeof match.contextCompacted === "boolean" ? { contextCompacted: match.contextCompacted } : {}),
        ...(Array.isArray(match.modelIds) ? { modelIds: match.modelIds.filter((item): item is string => typeof item === "string") } : {}),
        ...(Array.isArray(match.providerIds) ? { providerIds: match.providerIds.filter((item): item is string => typeof item === "string") } : {}),
        ...(typeof time.startHour === "number" && Number.isFinite(time.startHour) && typeof time.endHour === "number" && Number.isFinite(time.endHour) ? {
          time: {
            startHour: time.startHour,
            endHour: time.endHour,
            ...(Array.isArray(time.daysOfWeek) ? { daysOfWeek: time.daysOfWeek.filter((item): item is number => typeof item === "number") } : {}),
            ...(time.timezone === "utc" ? { timezone: "utc" as const } : {}),
          },
        } : {}),
      },
    };
    rules.push(normalized);
  }
  return rules;
}

function credentialSelector(credentials: Record<string, GatewayCredentialDefinition>, providerId: string): { credentialIds?: string[]; providerId?: string } {
  const ids = Object.values(credentials).filter((credential) => credential.providerId === providerId).map((credential) => credential.id);
  return ids.length ? { credentialIds: ids } : { providerId };
}

function readEntries(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map(asRecord).filter((entry) => Object.keys(entry).length > 0);
  return Object.values(asRecord(value)).map(asRecord).filter((entry) => Object.keys(entry).length > 0);
}

function readModelIds(value: unknown): string[] { return (Array.isArray(value) ? value : []).map((item) => typeof item === "string" ? item : readString(asRecord(item), "id", "model", "name")).filter((item): item is string => Boolean(item)); }

function readStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  const blocked = new Set(["authorization", "cookie", "set-cookie", "proxy-authorization"]);
  for (const [key, child] of Object.entries(value)) {
    if (key.trim() && !blocked.has(key.trim().toLowerCase()) && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) && typeof child === "string") result[key] = child;
  }
  return result;
}

function readProxyUrl(value: unknown): string | undefined {
  return isGatewayProxyUrl(value) ? value.trim() : undefined;
}

function readProtocols(value: unknown): GatewayProtocol[] {
  const allowed: GatewayProtocol[] = ["responses", "chat_completions", "anthropic", "gemini"];
  return (Array.isArray(value) ? value : []).filter((item): item is GatewayProtocol => typeof item === "string" && allowed.includes(item as GatewayProtocol));
}

function protocolSupported(provider: GatewayProviderDefinition, protocol: GatewayProtocol): boolean { return protocol === "responses" ? Boolean(provider.endpoints.responses) : protocol === "chat_completions" ? Boolean(provider.endpoints.chatCompletions) : protocol === "anthropic" ? Boolean(provider.endpoints.anthropicMessages) : Boolean(provider.endpoints.gemini); }

function mapStrategy(value: string): GatewayRouteGroupDefinition["strategy"] { return value === "order" || value === "rotate" || value === "usage" || value === "pace" || value === "weight" || value === "weighted_round_robin" ? value : value === "weighted" ? "weighted_round_robin" : "smart"; }
function mapSession(value: string): GatewayRouteGroupDefinition["sessionPolicy"] { return value === "session" || value === "turn" || value === "off" ? value : "auto"; }
function isGatewayShape(value: Record<string, unknown>): boolean { return isRecord(value.providers) && isRecord(value.credentials) && isRecord(value.models) && isRecord(value.routeGroups); }
function parseSource(source: unknown): Record<string, unknown> { return typeof source === "string" ? asRecord(JSON.parse(source)) : asRecord(source); }

function findExcludedFields(value: unknown, path = "", output = new Set<string>()): string[] {
  if (Array.isArray(value)) value.forEach((item, index) => findExcludedFields(item, `${path}[${index}]`, output));
  else if (isRecord(value)) for (const [key, child] of Object.entries(value)) {
    const normalized = key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
    if (EXCLUDED_ROUTING_FIELDS.has(normalized)) output.add(path ? `${path}.${key}` : key);
    else findExcludedFields(child, path ? `${path}.${key}` : key, output);
  }
  return [...output].sort();
}

function stripExcludedRoutingFields(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const visit = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(visit);
    if (!isRecord(current)) return current;
    return Object.fromEntries(
      Object.entries(current)
        .filter(([key]) => !EXCLUDED_ROUTING_FIELDS.has(key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase()))
        .map(([key, child]) => [key, visit(child)]),
    );
  };
  return visit(value) as Record<string, unknown>;
}

function readString(value: Record<string, unknown> | undefined, ...keys: string[]): string { if (!value) return ""; for (const key of keys) if (typeof value[key] === "string" && value[key].trim()) return value[key].trim(); return ""; }
function safeId(value: string): string { return value.trim().toLowerCase().replaceAll(/[^a-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "") || "custom"; }
function safeModelId(value: string): string { return value.trim().replaceAll("/", ":").replaceAll(/[^A-Za-z0-9._:-]+/g, "-") || "model"; }
function normalizeUrl(value: string): string { return value.replace(/\/+$/, ""); }
function asRecord(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {}; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
