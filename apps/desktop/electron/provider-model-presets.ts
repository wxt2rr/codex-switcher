import type { ModelCatalogEntry } from "./model-catalog-store.js";

export type ProviderModelPresetProviderId = "deepseek";

export interface ProviderModelPresetMatch {
  providerId: string;
  catalogPath: "models.json";
  entries: ModelCatalogEntry[];
}

const DEEPSEEK_OFFICIAL_HOSTS = new Set(["api.deepseek.com"]);

function createDeepSeekPresetEntry(input: {
  slug: string;
  displayName: string;
  description: string;
  priority: number;
  defaultReasoningLevel: "high";
}): ModelCatalogEntry {
  return {
    slug: input.slug,
    prefer_websockets: false,
    support_verbosity: true,
    default_verbosity: "low",
    apply_patch_tool_type: "freeform",
    web_search_tool_type: "text",
    input_modalities: ["text"],
    supports_image_detail_original: false,
    truncation_policy: { mode: "tokens", limit: 10000 },
    supports_parallel_tool_calls: true,
    tool_mode: null,
    multi_agent_version: "v2",
    use_responses_lite: false,
    include_skills_usage_instructions: false,
    auto_review_model_override: null,
    context_window: 1048576,
    max_context_window: 1048576,
    effective_context_window_percent: 95,
    auto_compact_token_limit: null,
    comp_hash: "3000",
    reasoning_summary_format: "experimental",
    default_reasoning_summary: "none",
    display_name: input.displayName,
    description: input.description,
    default_reasoning_level: input.defaultReasoningLevel,
    supported_reasoning_levels: [
      { effort: "low", description: "Fast responses with lighter reasoning" },
      { effort: "high", description: "Extra high reasoning depth for complex problems" },
      { effort: "max", description: "Maximum reasoning depth for the hardest problems" },
    ],
    shell_type: "shell_command",
    visibility: "list",
    minimal_client_version: "0.144.0",
    supported_in_api: true,
    availability_nux: null,
    upgrade: null,
    quality: "stable",
    priority: input.priority,
    experimental_supported_tools: [],
    supports_search_tool: true,
    default_service_tier: null,
    supports_reasoning_summaries: true,
    base_instructions: "You are Codex, a helpful coding assistant.",
  };
}

const DEEPSEEK_V4_FLASH: ModelCatalogEntry = createDeepSeekPresetEntry({
  slug: "deepseek-v4-flash",
  displayName: "DeepSeek-V4-Flash",
  description: "Latest frontier agentic coding model.",
  priority: 1,
  defaultReasoningLevel: "high",
});

const DEEPSEEK_V4_PRO: ModelCatalogEntry = createDeepSeekPresetEntry({
  slug: "deepseek-v4-pro",
  displayName: "DeepSeek-V4-Pro",
  description: "Higher-capability DeepSeek Codex preset.",
  priority: 2,
  defaultReasoningLevel: "high",
});

const DEEPSEEK_DEFAULT_ENTRIES = [DEEPSEEK_V4_FLASH, DEEPSEEK_V4_PRO] as const;

export const DEEPSEEK_DEFAULT_MODEL_SLUG = DEEPSEEK_V4_FLASH.slug;
export const DEEPSEEK_DEFAULT_MODEL_SLUGS = DEEPSEEK_DEFAULT_ENTRIES.map((entry) => entry.slug);

export function getProviderDefaultModelEntries(providerId?: string): ModelCatalogEntry[] | undefined {
  if (normalizeProviderId(providerId) === "deepseek") {
    return [...DEEPSEEK_DEFAULT_ENTRIES];
  }
  return undefined;
}

export function getProviderDefaultModelSlug(providerId?: string): string | undefined {
  return getProviderDefaultModelEntries(providerId)?.[0]?.slug;
}

export function getProviderDefaultBaseUrl(providerId?: string): string | undefined {
  if (normalizeProviderId(providerId) === "deepseek") {
    return "https://api.deepseek.com";
  }
  return undefined;
}

function normalizeProviderId(value?: string): ProviderModelPresetProviderId | undefined {
  const trimmed = value?.trim().toLowerCase();
  if (trimmed === "deepseek") return "deepseek";
  return undefined;
}

export function resolveProviderModelPreset(input: {
  providerId?: string;
  baseUrl?: string;
  model?: string;
}): ProviderModelPresetMatch | undefined {
  if (normalizeProviderId(input.providerId) === "deepseek" || isDeepSeekOfficialBaseUrl(input.baseUrl)) {
    return { providerId: "deepseek", catalogPath: "models.json", entries: [...DEEPSEEK_DEFAULT_ENTRIES] };
  }
  return undefined;
}

export function resolveProviderDefaultPreset(baseUrl?: string): ProviderModelPresetMatch | undefined {
  if (!isDeepSeekOfficialBaseUrl(baseUrl)) return undefined;
  return { providerId: "deepseek", catalogPath: "models.json", entries: [...DEEPSEEK_DEFAULT_ENTRIES] };
}

export function isDeepSeekOfficialBaseUrl(value?: string): boolean {
  if (!value?.trim() || value.trim() === "default") return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" && DEEPSEEK_OFFICIAL_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}
