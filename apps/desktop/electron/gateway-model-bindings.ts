import type {
  GatewayEnvironmentState,
  GatewayModelDefinition,
  GatewayRouteGroupDefinition,
} from "../../../packages/core/dist/gateway/model.js";
import type { GatewayProtocol, GatewayRouteCompatibilityIssue } from "../../../packages/core/dist/gateway/model.js";
import type { EnvState } from "../../../packages/core/dist/state/store.js";
import {
  resolveModelBinding,
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
    const group: GatewayRouteGroupDefinition = gateway.routeGroups[routeGroupId] ?? {
      id: routeGroupId,
      displayName: model.display_name,
      exposedModelId: model.slug,
      members: [],
      strategy: "smart",
      sessionPolicy: "auto",
      fallbackEnabled: true,
      capabilities,
    };

    for (const [accountName, account] of Object.entries(environment.accounts)) {
      if (account.authMode !== "auth") continue;
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
        ? { ...existing, protocols: Array.from(new Set([...existing.protocols, "responses"])) }
        : {
            id: internalModelId,
            providerId,
            upstreamModelId: model.slug,
            displayName: model.display_name,
            protocols: ["responses"],
            capabilities,
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
  } : {
    id: internalModelId,
    providerId,
    upstreamModelId: binding.upstreamModelId,
    displayName: model.entry.display_name,
    protocols: modelProtocols,
    capabilities: {
      reasoning: Array.isArray(model.entry.supported_reasoning_levels)
        || model.entry.supports_reasoning_summaries === true,
      tools: modelSupportsTools(model.entry),
      vision: Array.isArray(model.entry.input_modalities)
        && model.entry.input_modalities.includes("image"),
      streaming: true,
    },
    enabled: true,
  };
  gateway.models[internalModelId] = modelDefinition;

  const routeGroupId = createCatalogRouteGroupId(environment.name, model.entry.slug);
  const group: GatewayRouteGroupDefinition = gateway.routeGroups[routeGroupId] ?? {
    id: routeGroupId,
    displayName: model.entry.display_name,
    exposedModelId: model.entry.slug,
    members: [],
    strategy: "smart",
    sessionPolicy: "auto",
    fallbackEnabled: true,
    capabilities: modelDefinition.capabilities,
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
