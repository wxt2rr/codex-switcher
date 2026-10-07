import type {
  GatewayEnvironmentState,
  GatewayModelDefinition,
  GatewayRouteGroupDefinition,
} from "../../../packages/core/dist/gateway/model.js";
import type { EnvState } from "../../../packages/core/dist/state/store.js";
import {
  resolveModelBinding,
  type CustomModelRecord,
  type ModelCatalogSnapshot,
} from "./model-catalog-store.js";

/**
 * Compiles the model page's environment/account bindings into the gateway
 * document. Credentials remain references to the existing account storage.
 */
export function applyModelCatalogBindings(
  environment: EnvState,
  gateway: GatewayEnvironmentState,
  snapshot: ModelCatalogSnapshot,
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
      const binding = resolveModelBinding(snapshot, model, accountKey);
      if (!binding.enabled) continue;
      addModelBinding(next, environment, accountName, credentialId, model, binding);
    }
  }

  return next;
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
  const protocol = account.runtime.apiProtocol ?? "responses";
  const existing = gateway.models[internalModelId];
  const modelDefinition: GatewayModelDefinition = existing ?? {
    id: internalModelId,
    providerId,
    upstreamModelId: binding.upstreamModelId,
    displayName: model.entry.display_name,
    protocols: [protocol],
    capabilities: {
      reasoning: Array.isArray(model.entry.supported_reasoning_levels)
        || model.entry.supports_reasoning_summaries === true,
      tools: model.entry.supports_parallel_tool_calls === true,
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

function removeCompiledModelBindings(gateway: GatewayEnvironmentState): void {
  for (const modelId of Object.keys(gateway.models)) {
    if (modelId.startsWith("catalog-model:")) delete gateway.models[modelId];
  }
  for (const [groupId, group] of Object.entries(gateway.routeGroups)) {
    const members = group.members.filter((member) => !member.modelId.startsWith("catalog-model:"));
    if (groupId.startsWith("catalog-route-group:") && members.length === 0) {
      delete gateway.routeGroups[groupId];
      continue;
    }
    gateway.routeGroups[groupId] = { ...group, members };
  }
}
