import type { GatewayEnvironmentState, GatewayModelDefinition, GatewayRouteGroupDefinition } from "../../../packages/core/dist/gateway/model.js";
import { normalizeCustomModelInput, type ModelCatalogEntry } from "./model-catalog-store.js";

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
    if (!model.enabled || groupedModelIds.has(model.id)) continue;
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
    if (!group.members.length || !group.members.some((member) => gateway.models[member.modelId]?.enabled !== false)) continue;
    add(
      normalizeGatewayModelSlug(group.exposedModelId),
      group.displayName,
      `Gateway route group · ${group.strategy}`,
    );
  }
  return entries;
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
