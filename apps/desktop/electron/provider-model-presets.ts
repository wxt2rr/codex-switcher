import type { ModelCatalogEntry } from "./model-catalog-store.js";

export type ProviderModelPresetProviderId = "deepseek" | "mimo";

export interface ProviderModelPresetMatch {
  providerId: string;
  catalogPath: "models.json";
  entries: ModelCatalogEntry[];
}

const DEEPSEEK_OFFICIAL_HOSTS = new Set(["api.deepseek.com"]);
const MIMO_OFFICIAL_HOSTS = new Set(["api.xiaomimimo.com", "token-plan-cn.xiaomimimo.com"]);

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
  description: "Most capable frontier agentic coding model.",
  priority: 2,
  defaultReasoningLevel: "high",
});

const DEEPSEEK_DEFAULT_ENTRIES = [DEEPSEEK_V4_FLASH, DEEPSEEK_V4_PRO] as const;

export const DEEPSEEK_DEFAULT_MODEL_SLUG = DEEPSEEK_V4_FLASH.slug;
export const DEEPSEEK_DEFAULT_MODEL_SLUGS = DEEPSEEK_DEFAULT_ENTRIES.map((entry) => entry.slug);

function createMimoPresetEntry(input: {
  slug: string;
  displayName: string;
  description: string;
  priority: number;
  supportsImageDetailOriginal: boolean;
  inputModalities: Array<"text" | "image">;
}): ModelCatalogEntry {
  return {
    slug: input.slug,
    prefer_websockets: false,
    support_verbosity: false,
    apply_patch_tool_type: "freeform",
    web_search_tool_type: "text",
    default_verbosity: "low",
    input_modalities: input.inputModalities,
    supports_image_detail_original: input.supportsImageDetailOriginal,
    truncation_policy: { mode: "bytes", limit: 10000 },
    supports_parallel_tool_calls: false,
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
    default_reasoning_level: "high",
    supported_reasoning_levels: [
      { effort: "none", description: "Disable Thinking" },
      { effort: "high", description: "Enabled Thinking" },
    ],
    shell_type: "shell_command",
    visibility: "list",
    supported_in_api: true,
    availability_nux: null,
    upgrade: null,
    priority: input.priority,
    experimental_supported_tools: [],
    supports_search_tool: false,
    default_service_tier: null,
    supports_reasoning_summaries: true,
    base_instructions:
      "You are MiMo, an AI assistant developed by Xiaomi. Today's date: {date} {week}. Your knowledge cutoff date is December 2024.",
  };
}

const MIMO_V2_5_PRO: ModelCatalogEntry = createMimoPresetEntry({
  slug: "mimo-v2.5-pro",
  displayName: "mimo-v2.5-pro",
  description: "MiMo-v2.5-Pro: Trillion-parameter Flagship Agent Foundation",
  priority: 0,
  supportsImageDetailOriginal: false,
  inputModalities: ["text"],
});

const MIMO_V2_5: ModelCatalogEntry = createMimoPresetEntry({
  slug: "mimo-v2.5",
  displayName: "mimo-v2.5",
  description: "MiMo-V2.5: Native Omni-modal Perception Model",
  priority: 1,
  supportsImageDetailOriginal: true,
  inputModalities: ["text", "image"],
});

const MIMO_DEFAULT_ENTRIES = [MIMO_V2_5_PRO, MIMO_V2_5] as const;

export const MIMO_DEFAULT_MODEL_SLUG = MIMO_V2_5_PRO.slug;
export const MIMO_DEFAULT_MODEL_SLUGS = MIMO_DEFAULT_ENTRIES.map((entry) => entry.slug);

export function getProviderDefaultModelEntries(providerId?: string): ModelCatalogEntry[] | undefined {
  const normalized = normalizeProviderId(providerId);
  if (normalized === "deepseek") {
    return [...DEEPSEEK_DEFAULT_ENTRIES];
  }
  if (normalized === "mimo") return [...MIMO_DEFAULT_ENTRIES];
  return undefined;
}

export function getProviderDefaultModelSlug(providerId?: string): string | undefined {
  return getProviderDefaultModelEntries(providerId)?.[0]?.slug;
}

export function getProviderDefaultBaseUrl(providerId?: string): string | undefined {
  if (normalizeProviderId(providerId) === "deepseek") return "https://api.deepseek.com";
  if (normalizeProviderId(providerId) === "mimo") return "https://api.xiaomimimo.com/v1";
  return undefined;
}

function normalizeProviderId(value?: string): ProviderModelPresetProviderId | undefined {
  const trimmed = value?.trim().toLowerCase();
  if (trimmed === "deepseek") return "deepseek";
  if (trimmed === "mimo") return "mimo";
  return undefined;
}

export function resolveProviderModelPreset(input: {
  providerId?: string;
  baseUrl?: string;
  model?: string;
}): ProviderModelPresetMatch | undefined {
  const providerId = normalizeProviderId(input.providerId);
  if (providerId === "deepseek" || isDeepSeekOfficialBaseUrl(input.baseUrl)) {
    return { providerId: "deepseek", catalogPath: "models.json", entries: [...DEEPSEEK_DEFAULT_ENTRIES] };
  }
  if (providerId === "mimo" || isMimoOfficialBaseUrl(input.baseUrl)) {
    return { providerId: "mimo", catalogPath: "models.json", entries: [...MIMO_DEFAULT_ENTRIES] };
  }
  return undefined;
}

export function resolveProviderDefaultPreset(baseUrl?: string): ProviderModelPresetMatch | undefined {
  if (isDeepSeekOfficialBaseUrl(baseUrl)) {
    return { providerId: "deepseek", catalogPath: "models.json", entries: [...DEEPSEEK_DEFAULT_ENTRIES] };
  }
  if (isMimoOfficialBaseUrl(baseUrl)) {
    return { providerId: "mimo", catalogPath: "models.json", entries: [...MIMO_DEFAULT_ENTRIES] };
  }
  return undefined;
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

export function isMimoOfficialBaseUrl(value?: string): boolean {
  if (!value?.trim() || value.trim() === "default") return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" && MIMO_OFFICIAL_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}
