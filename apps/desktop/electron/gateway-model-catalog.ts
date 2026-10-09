import type {
  GatewayEnvironmentState,
  GatewayModelDefinition,
  GatewayRouteGroupDefinition,
} from "../../../packages/core/dist/gateway/model.js";
import { normalizeCustomModelInput, type ModelCatalogEntry } from "./model-catalog-store.js";
import {
  gatewayCredentialSupportsProtocol,
  gatewayProviderSupportsProtocol,
} from "./gateway-protocol-support.js";

export function normalizeGatewayModelSlug(value: string): string {
  const normalized = value.trim().replaceAll("/", ":");
  return normalized.replace(/[^A-Za-z0-9._:-]+/g, "-") || "gateway:model";
}

export function buildGatewayModelCatalog(gateway: GatewayEnvironmentState): ModelCatalogEntry[] {
  const entries: ModelCatalogEntry[] = [];
  const seen = new Set<string>();
  const groupedModelIds = new Set(
    Object.values(gateway.routeGroups).flatMap((group) => group.members.map((member) => member.modelId)),
  );
  const add = (slug: string, displayName: string, description: string) => {
    if (seen.has(slug)) return;
    seen.add(slug);
    entries.push(createGatewayModelCatalogEntry(slug, displayName, description));
  };

  for (const model of Object.values(gateway.models)) {
    if (!model.enabled || groupedModelIds.has(model.id) || !hasCompatibleCredential(gateway, model)) continue;
    add(
      normalizeGatewayModelSlug(model.id),
      model.displayName,
      `${model.providerId} · ${model.upstreamModelId}`,
    );
  }
  for (const group of Object.values(gateway.routeGroups)) {
    // Official Codex models are already supplied by the bundled catalog. The
    // gateway still needs their route groups, but must not emit duplicate
    // catalog entries that collide with the bundled model definitions.
    if (group.id.startsWith("builtin-route-group:")) continue;
    if (!group.members.length || !hasRoutableGroupMember(gateway, group)) continue;
    add(
      normalizeGatewayModelSlug(group.exposedModelId),
      group.displayName,
      `Gateway route group · ${group.strategy}`,
    );
  }
  return entries;
}

function hasCompatibleCredential(
  gateway: GatewayEnvironmentState,
  model: GatewayModelDefinition,
): boolean {
  const provider = gateway.providers[model.providerId];
  if (!provider || !provider.enabled) return false;
  return Object.values(gateway.credentials).some((credential) => (
    credential.providerId === model.providerId
      && credential.status !== "disabled"
      && (!credential.modelIds?.length || credential.modelIds.includes(model.upstreamModelId))
      && model.protocols.some((protocol) => (
        gatewayProviderSupportsProtocol(provider, protocol)
          && gatewayCredentialSupportsProtocol(credential, protocol)
      ))
  ));
}

function hasRoutableGroupMember(
  gateway: GatewayEnvironmentState,
  group: GatewayRouteGroupDefinition,
  visited = new Set<string>(),
): boolean {
  if (visited.has(group.id)) return false;
  visited.add(group.id);
  if (group.members.some((member) => {
    const model = gateway.models[member.modelId];
    if (!model || !model.enabled || model.providerId !== member.providerId) return false;
    const provider = gateway.providers[member.providerId];
    if (!provider || !provider.enabled) return false;
    const selectedIds = member.credentialSelector.credentialIds?.length
      ? member.credentialSelector.credentialIds
      : Object.values(gateway.credentials)
        .filter((credential) => credential.providerId === member.providerId)
        .map((credential) => credential.id);
    return selectedIds.some((credentialId) => {
      const credential = gateway.credentials[credentialId];
      return Boolean(credential
        && credential.providerId === member.providerId
        && credential.status !== "disabled"
        && (!credential.modelIds?.length || credential.modelIds.includes(model.upstreamModelId))
        && model.protocols.some((protocol) => (
          gatewayProviderSupportsProtocol(provider, protocol)
            && gatewayCredentialSupportsProtocol(credential, protocol)
        )));
    });
  })) return true;
  return (group.nestedGroupIds ?? []).some((nestedId) => {
    const nested = gateway.routeGroups[nestedId];
    return nested ? hasRoutableGroupMember(gateway, nested, visited) : false;
  });
}

export function buildGatewayModelEntry(
  model: GatewayModelDefinition | GatewayRouteGroupDefinition,
): ModelCatalogEntry {
  if ("upstreamModelId" in model) {
    return createGatewayModelCatalogEntry(
      normalizeGatewayModelSlug(model.id),
      model.displayName,
      `${model.providerId} · ${model.upstreamModelId}`,
    );
  }
  return createGatewayModelCatalogEntry(
    normalizeGatewayModelSlug(model.exposedModelId),
    model.displayName,
    `Gateway route group · ${model.strategy}`,
  );
}

function createGatewayModelCatalogEntry(
  slug: string,
  displayName: string,
  description: string,
): ModelCatalogEntry {
  return normalizeCustomModelInput({
    slug,
    display_name: displayName,
    description,
  });
}
