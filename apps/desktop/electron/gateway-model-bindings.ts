import type {
  GatewayEnvironmentState,
  GatewayCapabilityProfile,
  GatewayModelDefinition,
  GatewayRouteGroupDefinition,
} from "../../../packages/core/dist/gateway/model.js";
import type { GatewayProtocol, GatewayRouteCompatibilityIssue } from "../../../packages/core/dist/gateway/model.js";
import type { EnvState } from "../../../packages/core/dist/state/store.js";
import {
  resolveModelBinding,
  formatCodexModelDisplayName,
  isModelAvailableForAccount,
  type ModelCatalogEntry,
  type CustomModelRecord,
  type ModelCatalogSnapshot,
} from "./model-catalog-store.js";
import { loadGatewayModelRuntime } from "./core-runtime.js";
import {
  gatewayCredentialSupportsProtocol,
  gatewayProviderProtocols,
  gatewayProviderSupportsProtocol,
} from "./gateway-protocol-support.js";

/**
 * Compiles the model page's environment/account bindings into the gateway
 * document. Credentials remain references to the existing account storage.
 */
export function applyModelCatalogBindings(
  environment: EnvState,
  gateway: GatewayEnvironmentState,
  snapshot: ModelCatalogSnapshot,
  bundledModels: readonly ModelCatalogEntry[] = [],
): GatewayEnvironmentState {
  const next = structuredClone(gateway);
  removeCompiledModelBindings(next);
  const modelsById = new Map(snapshot.models.map((model) => [model.id, model]));
  const credentialsByAccount = new Map<string, string>();

  for (const [credentialId, credential] of Object.entries(next.credentials)) {
    const accountName = accountNameFromSecretRef(credential.secretRef, environment.name);
    if (accountName && environment.accounts[accountName]) {
      credentialsByAccount.set(accountName, credentialId);
    }
  }

  for (const [accountKey, modelIds] of Object.entries(snapshot.accountBindings)) {
    const prefix = `${environment.name}/`;
    if (!accountKey.startsWith(prefix)) continue;
    const accountName = accountKey.slice(prefix.length);
    const account = environment.accounts[accountName];
    const credentialId = credentialsByAccount.get(accountName);
    if (!account || !credentialId) continue;

    for (const modelId of modelIds) {
      const model = modelsById.get(modelId);
      if (!model) continue;
      if (!isModelAvailableForAccount(snapshot, model, accountKey)) continue;
      // Subscription accounts already receive the Codex App's bundled models
      // through addBundledModelBindings below. Do not compile a second
      // catalog route from the same bundled entry.
      if (account.authMode === "auth" && model.entry.model_source === "bundled") continue;
      const binding = resolveModelBinding(snapshot, model, accountKey);
      if (!binding.enabled) continue;
      addModelBinding(next, environment, accountName, credentialId, model, binding);
    }
  }

  addBundledModelBindings(next, environment, credentialsByAccount, bundledModels);

  return next;
}

/** Returns route compiler diagnostics without throwing away a readable legacy document. */
export async function inspectGatewayModelBindings(
  gateway: GatewayEnvironmentState,
): Promise<GatewayRouteCompatibilityIssue[]> {
  const runtime = await loadGatewayModelRuntime();
  return runtime.validateGatewayRouteCompatibility(gateway);
}

function addBundledModelBindings(
  gateway: GatewayEnvironmentState,
  environment: EnvState,
  credentialsByAccount: ReadonlyMap<string, string>,
  bundledModels: readonly ModelCatalogEntry[],
): void {
  const uniqueModels = new Map(bundledModels.map((model) => [model.slug, model]));
  for (const model of uniqueModels.values()) {
    if (!model.slug.trim() || model.supported_in_api === false) continue;
    const routeGroupId = createBuiltinRouteGroupId(environment.name, model.slug);
    const capabilities = {
      reasoning: Array.isArray(model.supported_reasoning_levels)
        || model.supports_reasoning_summaries === true,
      tools: modelSupportsTools(model),
      vision: Array.isArray(model.input_modalities) && model.input_modalities.includes("image"),
      streaming: true,
    };
    const capabilityProfile = modelCapabilityProfile(model);
    const group: GatewayRouteGroupDefinition = gateway.routeGroups[routeGroupId] ?? {
      id: routeGroupId,
      displayName: model.display_name,
      exposedModelId: model.slug,
      members: [],
      strategy: "smart",
      sessionPolicy: "auto",
      fallbackEnabled: true,
      capabilities,
      capabilityProfile,
    };

    for (const [accountName, account] of Object.entries(environment.accounts)) {
      if (account.authMode !== "auth") continue;
      // The reserved default/default account is synthesized when its files are
      // absent. Do not expose Codex built-in models through that placeholder;
      // only accounts with an actual subscription access token can serve them.
      if (!hasAuthCredential(account.authData)) continue;
      const credentialId = credentialsByAccount.get(accountName);
      const credential = credentialId ? gateway.credentials[credentialId] : undefined;
      if (!credentialId || !credential || credential.status === "disabled") continue;

      const providerId = credential.providerId;
      ensureProviderProtocol(gateway, providerId, "responses", account);
      if (!gatewayCredentialSupportsProtocol(credential, "responses")) {
        credential.supportedProtocols = Array.from(new Set([...credential.supportedProtocols, "responses"]));
      }
      const internalModelId = createBuiltinModelId(environment.name, model.slug, providerId);
      const existing = gateway.models[internalModelId];
      gateway.models[internalModelId] = existing
        ? { ...existing, protocols: Array.from(new Set([...existing.protocols, "responses"])), capabilityProfile: { ...(existing.capabilityProfile ?? {}), ...capabilityProfile } }
        : {
            id: internalModelId,
            providerId,
            upstreamModelId: model.slug,
            displayName: model.display_name,
            protocols: ["responses"],
            capabilities,
            capabilityProfile,
            enabled: true,
          };
      const memberExists = group.members.some((member) => (
        member.modelId === internalModelId
          && member.credentialSelector.credentialIds?.includes(credentialId)
      ));
      if (!memberExists) {
        group.members.push({
          providerId,
          modelId: internalModelId,
          credentialSelector: { credentialIds: [credentialId] },
          priority: group.members.length,
          weight: 1,
        });
      }
    }

    if (group.members.length) {
      group.members.sort((left, right) => left.priority - right.priority || left.modelId.localeCompare(right.modelId));
      gateway.routeGroups[routeGroupId] = group;
    }
  }
}

function hasAuthCredential(authData: Record<string, unknown> | undefined): boolean {
  const direct = authData?.access_token;
  if (typeof direct === "string" && direct.trim()) return true;
  const rawTokens = authData?.tokens;
  if (!rawTokens) return false;
  try {
    const tokens = typeof rawTokens === "string" ? JSON.parse(rawTokens) as Record<string, unknown> : rawTokens as Record<string, unknown>;
    return typeof tokens.access_token === "string" && tokens.access_token.trim().length > 0;
  } catch {
    return false;
  }
}

function addModelBinding(
  gateway: GatewayEnvironmentState,
  environment: EnvState,
  accountName: string,
  credentialId: string,
  model: CustomModelRecord,
  binding: ReturnType<typeof resolveModelBinding>,
): void {
  const account = environment.accounts[accountName];
  if (!account) return;
  const credential = gateway.credentials[credentialId];
  if (!credential) return;

  const providerId = credential.providerId;
  const displayName = formatCodexModelDisplayName(
    model.entry,
    isCustomOpenAIProvider(providerId) ? accountName : undefined,
    accountName,
  );
  const internalModelId = createCatalogModelId(model.id, providerId, binding.upstreamModelId);
  const configuredProtocol: GatewayProtocol = account.authMode === "auth" ? "responses" : account.runtime.apiProtocol ?? "responses";
  const existingProvider = gateway.providers[providerId];
  const hasNativeOnlyProtocol = Boolean(existingProvider
    && gatewayProviderProtocols(existingProvider).some((protocol) => protocol === "anthropic" || protocol === "gemini"));
  if (existingProvider && !gatewayProviderSupportsProtocol(existingProvider, configuredProtocol) && !hasNativeOnlyProtocol) {
    ensureProviderProtocol(gateway, providerId, configuredProtocol, account);
  }
  const protocols = resolveBindingProtocols(model.entry, gateway.providers[providerId], configuredProtocol);
  if (!protocols.length) return;
  for (const protocol of protocols) ensureProviderProtocol(gateway, providerId, protocol, account);
  const provider = gateway.providers[providerId];
  if (!provider) return;
  const supportedProtocols = protocols.filter((protocol) => gatewayProviderSupportsProtocol(provider, protocol));
  if (!supportedProtocols.length) return;
  for (const protocol of supportedProtocols) {
    if (!gatewayCredentialSupportsProtocol(credential, protocol)) {
      credential.supportedProtocols = Array.from(new Set([...credential.supportedProtocols, protocol]));
    }
  }
  const existing = gateway.models[internalModelId];
  const modelProtocols = Array.from(new Set([...(existing?.protocols ?? []), ...supportedProtocols]));
  const modelDefinition: GatewayModelDefinition = existing ? {
    ...existing,
    protocols: modelProtocols,
    capabilityProfile: { ...(existing.capabilityProfile ?? {}), ...modelCapabilityProfile(model.entry) },
  } : {
    id: internalModelId,
    providerId,
    upstreamModelId: binding.upstreamModelId,
    displayName,
    protocols: modelProtocols,
    capabilities: {
      reasoning: Array.isArray(model.entry.supported_reasoning_levels)
        || model.entry.supports_reasoning_summaries === true,
      tools: modelSupportsTools(model.entry),
      vision: Array.isArray(model.entry.input_modalities)
        && model.entry.input_modalities.includes("image"),
      streaming: true,
    },
    capabilityProfile: modelCapabilityProfile(model.entry),
    enabled: true,
  };
  gateway.models[internalModelId] = modelDefinition;

  const routeGroupId = createCatalogRouteGroupId(environment.name, model.entry.slug);
  const group: GatewayRouteGroupDefinition = gateway.routeGroups[routeGroupId] ?? {
    id: routeGroupId,
    displayName,
    exposedModelId: model.entry.slug,
    members: [],
    strategy: "smart",
    sessionPolicy: "auto",
    fallbackEnabled: true,
    capabilities: modelDefinition.capabilities,
    capabilityProfile: modelDefinition.capabilityProfile,
  };
  const member = group.members.find((candidate) => (
    candidate.modelId === internalModelId
      && candidate.credentialSelector.credentialIds?.includes(credentialId)
  ));
  if (member) {
    member.priority = binding.priority;
    member.weight = binding.weight;
  } else {
    group.members.push({
      providerId,
      modelId: internalModelId,
      credentialSelector: { credentialIds: [credentialId] },
      priority: binding.priority,
      weight: binding.weight,
    });
  }
  group.members.sort((left, right) => left.priority - right.priority || left.modelId.localeCompare(right.modelId));
  gateway.routeGroups[group.id] = group;
}

function isCustomOpenAIProvider(providerId: string): boolean {
  const normalized = providerId.trim().toLowerCase();
  return normalized === "custom"
    || normalized === "custom-openai"
    || normalized.startsWith("custom:")
    || normalized.startsWith("custom-openai:");
}

/**
 * Resolves the upstream wire protocols for a model binding. The account's
 * Responses/Chat setting is an ingress preference, not a license to send an
 * Anthropic or Gemini provider a Responses payload. Explicit model metadata
 * wins; otherwise a single-provider protocol is selected, and ambiguous
 * OpenAI-compatible providers follow the account's configured wire API.
 */
function resolveBindingProtocols(
  entry: ModelCatalogEntry,
  provider: GatewayEnvironmentState["providers"][string] | undefined,
  configuredProtocol: GatewayProtocol,
): GatewayProtocol[] {
  if (!provider) return [];
  const providerProtocols = gatewayProviderProtocols(provider);
  const declared = [entry.protocol, entry.wire_api, entry.api_protocol, ...(Array.isArray(entry.supported_protocols) ? entry.supported_protocols : [])]
    .flatMap((value) => typeof value === "string" ? [normalizeGatewayProtocol(value)] : [])
    .filter((value): value is GatewayProtocol => Boolean(value));
  const declaredSet = new Set(declared);
  const explicit = providerProtocols.filter((protocol) => declaredSet.has(protocol));
  if (explicit.length) return explicit;
  if (providerProtocols.includes(configuredProtocol)) return [configuredProtocol];
  if (providerProtocols.length === 1) return [...providerProtocols];
  return providerProtocols.filter((protocol) => protocol === "responses" || protocol === "chat_completions");
}

function normalizeGatewayProtocol(value: string): GatewayProtocol | undefined {
  const normalized = value.trim().toLowerCase().replaceAll("-", "_");
  if (normalized === "responses" || normalized === "response") return "responses";
  if (normalized === "chat_completions" || normalized === "chat" || normalized === "chatcompletion") return "chat_completions";
  if (normalized === "anthropic" || normalized === "messages" || normalized === "anthropic_messages") return "anthropic";
  if (normalized === "gemini" || normalized === "generate_content") return "gemini";
  return undefined;
}

function ensureProviderProtocol(
  gateway: GatewayEnvironmentState,
  providerId: string,
  protocol: GatewayProtocol,
  account: { authMode: string; runtime: { openaiBaseUrlMode: string; openaiBaseUrl?: string } },
): void {
  const provider = gateway.providers[providerId];
  if (!provider || gatewayProviderSupportsProtocol(provider, protocol)) return;
  const baseUrl = account.runtime.openaiBaseUrlMode === "custom" && account.runtime.openaiBaseUrl?.trim()
    ? account.runtime.openaiBaseUrl.trim()
    : account.authMode === "auth"
      ? "https://chatgpt.com/backend-api/codex"
      : "https://api.openai.com/v1";
  const endpoints = { ...provider.endpoints };
  if (protocol === "responses") endpoints.responses ??= baseUrl;
  if (protocol === "chat_completions") endpoints.chatCompletions ??= baseUrl;
  if (protocol === "anthropic") endpoints.anthropicMessages ??= baseUrl;
  if (protocol === "gemini") endpoints.gemini ??= baseUrl;
  gateway.providers[providerId] = { ...provider, endpoints };
}

function modelSupportsTools(entry: ModelCatalogEntry): boolean {
  // `supports_parallel_tool_calls` only controls whether Codex may batch tool
  // calls. It must not disable ordinary tool calls at the gateway layer.
  if (entry.tools === false || entry.supports_tools === false) return false;
  return entry.tool_mode !== "disabled";
}

function modelCapabilityProfile(entry: ModelCatalogEntry): GatewayCapabilityProfile {
  const profile: GatewayCapabilityProfile = {};
  const now = Date.now();
  const add = (id: string, supported: boolean): void => {
    profile[id] = { status: supported ? "supported" : "unsupported", source: "preset", checkedAt: now };
  };
  if (typeof entry.supports_search_tool === "boolean") add("tools.hosted.web_search", entry.supports_search_tool);
  if (typeof entry.supports_parallel_tool_calls === "boolean") add("tools.parallel", entry.supports_parallel_tool_calls);
  if (Array.isArray(entry.input_modalities) && entry.input_modalities.includes("image")) add("input.image", true);
  if (modelSupportsTools(entry)) add("tools.function", true);
  if (Array.isArray(entry.supported_reasoning_levels) || entry.supports_reasoning_summaries === true) add("output.reasoning", true);
  return profile;
}

function accountNameFromSecretRef(secretRef: string, environmentName: string): string | undefined {
  const prefix = `account:${encodeURIComponent(environmentName)}:`;
  if (!secretRef.startsWith(prefix)) return undefined;
  return decodeURIComponent(secretRef.slice(prefix.length));
}

function createCatalogModelId(modelId: string, providerId: string, upstreamModelId: string): string {
  return ["catalog-model", modelId, providerId, upstreamModelId].map(encodeURIComponent).join(":");
}

function createCatalogRouteGroupId(environmentName: string, exposedModelId: string): string {
  return ["catalog-route-group", environmentName, exposedModelId].map(encodeURIComponent).join(":");
}

function createBuiltinModelId(environmentName: string, modelSlug: string, providerId: string): string {
  return ["builtin-model", environmentName, modelSlug, providerId].map(encodeURIComponent).join(":");
}

function createBuiltinRouteGroupId(environmentName: string, exposedModelId: string): string {
  return ["builtin-route-group", environmentName, exposedModelId].map(encodeURIComponent).join(":");
}

function removeCompiledModelBindings(gateway: GatewayEnvironmentState): void {
  for (const modelId of Object.keys(gateway.models)) {
    if (modelId.startsWith("catalog-model:") || modelId.startsWith("builtin-model:")) delete gateway.models[modelId];
  }
  for (const [groupId, group] of Object.entries(gateway.routeGroups)) {
    const members = group.members.filter((member) => (
      !member.modelId.startsWith("catalog-model:")
      && !member.modelId.startsWith("builtin-model:")
    ));
    if ((groupId.startsWith("catalog-route-group:") || groupId.startsWith("builtin-route-group:")) && members.length === 0) {
      delete gateway.routeGroups[groupId];
      continue;
    }
    gateway.routeGroups[groupId] = { ...group, members };
  }
}
