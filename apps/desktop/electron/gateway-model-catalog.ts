import type { GatewayEnvironmentState, GatewayModelDefinition, GatewayRouteGroupDefinition } from "../../../packages/core/dist/gateway/model.js";
import type { ModelCatalogEntry } from "./model-catalog-store.js";

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
    entries.push({
      slug,
      display_name: displayName,
      description,
      visibility: "list",
      supported_in_api: true,
      supports_reasoning_summaries: false,
      supports_parallel_tool_calls: true,
      context_window: 128000,
      max_context_window: 128000,
      input_modalities: ["text", "image"],
    });
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
    return {
      slug: normalizeGatewayModelSlug(model.id),
      display_name: model.displayName,
      description: `${model.providerId} · ${model.upstreamModelId}`,
      visibility: "list",
      supported_in_api: true,
      context_window: 128000,
      max_context_window: 128000,
      input_modalities: ["text", "image"],
    };
  }
  return {
    slug: normalizeGatewayModelSlug(model.exposedModelId),
    display_name: model.displayName,
    description: `Gateway route group · ${model.strategy}`,
    visibility: "list",
    supported_in_api: true,
    context_window: 128000,
    max_context_window: 128000,
    input_modalities: ["text", "image"],
  };
}
