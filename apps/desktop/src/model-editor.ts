import type { ModelCatalogEntry } from "./bridge";

export function createDefaultModelEntry(): ModelCatalogEntry {
  return {
    slug: "",
    display_name: "",
    default_reasoning_level: "medium",
    supported_reasoning_levels: [
      { effort: "low", description: "Fast responses" },
      { effort: "medium", description: "Balanced reasoning" },
      { effort: "high", description: "Deeper reasoning" },
    ],
    shell_type: "shell_command",
    visibility: "list",
    supported_in_api: true,
    priority: 100,
    base_instructions: "You are a helpful coding assistant.",
    supports_reasoning_summaries: false,
    default_reasoning_summary: "none",
    support_verbosity: false,
    truncation_policy: { mode: "bytes", limit: 10000 },
    supports_parallel_tool_calls: true,
    supports_image_detail_original: false,
    context_window: 128000,
    max_context_window: 128000,
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    input_modalities: ["text", "image"],
    supports_search_tool: false,
  };
}

export function serializeSingleModelCatalog(entry: Record<string, unknown>): string {
  return JSON.stringify({ models: [entry] }, null, 2);
}

export function parseSingleModelCatalog(content: string): ModelCatalogEntry {
  const parsed = JSON.parse(content) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.models)) {
    throw new Error("JSON must contain a models array");
  }
  if (parsed.models.length !== 1) {
    throw new Error("JSON must contain exactly one model");
  }
  const entry = parsed.models[0];
  if (!isRecord(entry)) throw new Error("The model entry must be an object");
  return entry as ModelCatalogEntry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
