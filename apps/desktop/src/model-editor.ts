import type { ModelCatalogEntry } from "./bridge";

export type ModelCatalogFieldKind =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "multi_select"
  | "reasoning_levels"
  | "json";

export interface ModelCatalogFieldDefinition {
  key: string;
  kind: ModelCatalogFieldKind;
  label: string;
  labelEn: string;
  hint?: string;
  hintEn?: string;
  options?: readonly string[];
}

export const MODEL_CATALOG_ENUMS = {
  inputModalities: ["text", "image"] as const,
  protocols: ["responses", "chat_completions", "anthropic", "gemini"] as const,
  reasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const,
  speedTiers: ["fast"] as const,
  visibility: ["list", "hide"] as const,
  shellTypes: ["shell_command", "unified_exec", "default"] as const,
  toolModes: ["code_mode_only"] as const,
  patchToolTypes: ["freeform"] as const,
  webSearchToolTypes: ["text", "text_and_image"] as const,
  multiAgentVersions: ["v1", "v2"] as const,
  qualities: ["stable", "preview", "experimental"] as const,
  serviceTiers: ["default", "priority", "flex"] as const,
} as const;

const DEFAULT_REASONING_LEVELS = [
  { effort: "low", description: "Fast responses" },
  { effort: "medium", description: "Balanced reasoning" },
  { effort: "high", description: "Deeper reasoning" },
];

/**
 * The form intentionally covers the complete stable Codex model catalog
 * surface. Unknown future fields remain available in JSON mode and are not
 * discarded when the user edits a known form field.
 */
export const MODEL_CATALOG_FORM_FIELDS: readonly ModelCatalogFieldDefinition[] = [
  { key: "slug", kind: "text", label: "模型标识（slug）", labelEn: "Model slug" },
  { key: "display_name", kind: "text", label: "展示名称", labelEn: "Display name" },
  { key: "description", kind: "textarea", label: "描述", labelEn: "Description" },
  { key: "provider_id", kind: "text", label: "服务商标识", labelEn: "Provider id" },
  { key: "provider_display_name", kind: "text", label: "服务商名称", labelEn: "Provider display name" },
  { key: "provider_model_key", kind: "text", label: "服务商模型键", labelEn: "Provider model key" },
  { key: "upstream_model_id", kind: "text", label: "上游模型标识", labelEn: "Upstream model id" },
  { key: "model_source", kind: "select", options: ["preset", "discovery", "manual", "cached"], label: "模型来源", labelEn: "Model source" },
  { key: "protocol", kind: "select", options: MODEL_CATALOG_ENUMS.protocols, label: "协议", labelEn: "Protocol" },
  { key: "wire_api", kind: "select", options: MODEL_CATALOG_ENUMS.protocols, label: "线协议", labelEn: "Wire API" },
  { key: "api_protocol", kind: "select", options: MODEL_CATALOG_ENUMS.protocols, label: "API 协议", labelEn: "API protocol" },
  { key: "supported_protocols", kind: "multi_select", options: MODEL_CATALOG_ENUMS.protocols, label: "支持的协议", labelEn: "Supported protocols" },
  { key: "default_reasoning_level", kind: "select", options: MODEL_CATALOG_ENUMS.reasoningEfforts, label: "默认推理级别", labelEn: "Default reasoning level" },
  { key: "supported_reasoning_levels", kind: "reasoning_levels", options: MODEL_CATALOG_ENUMS.reasoningEfforts, label: "支持的推理级别", labelEn: "Supported reasoning levels" },
  { key: "shell_type", kind: "select", options: MODEL_CATALOG_ENUMS.shellTypes, label: "Shell 类型", labelEn: "Shell type" },
  { key: "visibility", kind: "select", options: MODEL_CATALOG_ENUMS.visibility, label: "可见性", labelEn: "Visibility" },
  { key: "supported_in_api", kind: "boolean", label: "在 API 中可用", labelEn: "Supported in API" },
  { key: "priority", kind: "number", label: "优先级", labelEn: "Priority" },
  { key: "base_instructions", kind: "textarea", label: "基础指令", labelEn: "Base instructions" },
  { key: "supports_reasoning_summaries", kind: "boolean", label: "支持推理摘要", labelEn: "Reasoning summaries" },
  { key: "default_reasoning_summary", kind: "select", options: ["none", "concise", "detailed"], label: "默认推理摘要", labelEn: "Default reasoning summary" },
  { key: "support_verbosity", kind: "boolean", label: "支持详细程度", labelEn: "Verbosity control" },
  { key: "default_verbosity", kind: "select", options: ["low", "medium", "high"], label: "默认详细程度", labelEn: "Default verbosity" },
  { key: "supports_parallel_tool_calls", kind: "boolean", label: "支持并行工具调用", labelEn: "Parallel tool calls" },
  { key: "supports_image_detail_original", kind: "boolean", label: "支持原始图片细节", labelEn: "Original image detail" },
  { key: "input_modalities", kind: "multi_select", options: MODEL_CATALOG_ENUMS.inputModalities, label: "输入类型", labelEn: "Input modalities", hint: "默认选择文本和图片；只有上游明确不支持图片时才取消图片。", hintEn: "Text and image are selected by default; clear image only when the upstream does not support it." },
  { key: "supports_search_tool", kind: "boolean", label: "支持搜索工具", labelEn: "Search tool" },
  { key: "prefer_websockets", kind: "boolean", label: "优先 WebSocket", labelEn: "Prefer WebSockets" },
  { key: "tool_mode", kind: "select", options: MODEL_CATALOG_ENUMS.toolModes, label: "工具模式", labelEn: "Tool mode" },
  { key: "apply_patch_tool_type", kind: "select", options: MODEL_CATALOG_ENUMS.patchToolTypes, label: "补丁工具类型", labelEn: "Apply patch tool type" },
  { key: "web_search_tool_type", kind: "select", options: MODEL_CATALOG_ENUMS.webSearchToolTypes, label: "搜索工具类型", labelEn: "Web search tool type" },
  { key: "multi_agent_version", kind: "select", options: MODEL_CATALOG_ENUMS.multiAgentVersions, label: "多 Agent 版本", labelEn: "Multi-agent version" },
  { key: "multi_agent_reasoning_effort", kind: "select", options: MODEL_CATALOG_ENUMS.reasoningEfforts, label: "多 Agent 推理级别", labelEn: "Multi-agent reasoning effort" },
  { key: "use_responses_lite", kind: "boolean", label: "使用 Responses Lite", labelEn: "Use Responses Lite" },
  { key: "include_skills_usage_instructions", kind: "boolean", label: "包含 Skill 使用说明", labelEn: "Include Skill usage instructions" },
  { key: "include_plugin_usage_instructions", kind: "boolean", label: "包含插件使用说明", labelEn: "Include plugin usage instructions" },
  { key: "include_apps_usage_instructions", kind: "boolean", label: "包含应用使用说明", labelEn: "Include app usage instructions" },
  { key: "supports_experimental_context", kind: "boolean", label: "支持实验性上下文", labelEn: "Experimental context" },
  { key: "supports_reasoning_effort_updates", kind: "boolean", label: "支持动态推理级别", labelEn: "Reasoning effort updates" },
  { key: "node_repl_auto_review_required", kind: "boolean", label: "Node REPL 需要自动审查", labelEn: "Node REPL auto-review required" },
  { key: "node_repl_disabled", kind: "boolean", label: "禁用 Node REPL", labelEn: "Node REPL disabled" },
  { key: "auto_review_model_override", kind: "text", label: "自动审查模型覆盖", labelEn: "Auto-review model override" },
  { key: "auto_compact_token_limit", kind: "number", label: "自动压缩 Token 上限", labelEn: "Auto-compact token limit" },
  { key: "comp_hash", kind: "text", label: "编译哈希", labelEn: "Compilation hash" },
  { key: "reasoning_summary_format", kind: "text", label: "推理摘要格式", labelEn: "Reasoning summary format" },
  { key: "minimal_client_version", kind: "text", label: "最低客户端版本", labelEn: "Minimal client version" },
  { key: "quality", kind: "select", options: MODEL_CATALOG_ENUMS.qualities, label: "质量等级", labelEn: "Quality" },
  { key: "default_service_tier", kind: "select", options: MODEL_CATALOG_ENUMS.serviceTiers, label: "默认服务层级", labelEn: "Default service tier" },
  { key: "additional_speed_tiers", kind: "multi_select", options: MODEL_CATALOG_ENUMS.speedTiers, label: "附加速度层级", labelEn: "Additional speed tiers" },
  { key: "service_tiers", kind: "json", label: "服务层级", labelEn: "Service tiers" },
  { key: "available_access_programs", kind: "json", label: "可用访问计划", labelEn: "Available access programs" },
  { key: "context_window", kind: "number", label: "上下文窗口", labelEn: "Context window" },
  { key: "max_context_window", kind: "number", label: "最大上下文窗口", labelEn: "Max context window" },
  { key: "effective_context_window_percent", kind: "number", label: "有效上下文百分比", labelEn: "Effective context window percent" },
  { key: "truncation_policy", kind: "json", label: "截断策略", labelEn: "Truncation policy" },
  { key: "experimental_supported_tools", kind: "json", label: "实验性工具", labelEn: "Experimental supported tools" },
  { key: "model_messages", kind: "json", label: "模型消息配置", labelEn: "Model messages" },
  { key: "availability_nux", kind: "json", label: "可用性 NUX", labelEn: "Availability NUX" },
  { key: "upgrade", kind: "json", label: "升级信息", labelEn: "Upgrade" },
];

export function createDefaultModelEntry(): ModelCatalogEntry {
  return {
    slug: "",
    display_name: "",
    description: "",
    provider_id: "",
    provider_display_name: "",
    provider_model_key: "",
    upstream_model_id: "",
    model_source: "manual",
    protocol: "responses",
    wire_api: "responses",
    api_protocol: "responses",
    supported_protocols: ["responses"],
    default_reasoning_level: "medium",
    supported_reasoning_levels: DEFAULT_REASONING_LEVELS,
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
    additional_speed_tiers: [],
    service_tiers: [],
    available_access_programs: {},
    context_window: 128000,
    max_context_window: 128000,
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    supports_experimental_context: false,
    supports_reasoning_effort_updates: false,
    input_modalities: ["text", "image"],
    supports_search_tool: false,
    prefer_websockets: false,
    tool_mode: "code_mode_only",
    apply_patch_tool_type: "freeform",
    web_search_tool_type: "text_and_image",
    multi_agent_version: "v2",
    multi_agent_reasoning_effort: "medium",
    use_responses_lite: false,
    include_skills_usage_instructions: false,
    include_plugin_usage_instructions: false,
    include_apps_usage_instructions: false,
    node_repl_auto_review_required: false,
    node_repl_disabled: false,
    auto_review_model_override: null,
    auto_compact_token_limit: null,
    comp_hash: "",
    reasoning_summary_format: null,
    minimal_client_version: "",
    availability_nux: null,
    upgrade: null,
    quality: "stable",
    default_service_tier: null,
    model_messages: {},
  };
}

/** Fill newly introduced form fields without dropping custom JSON keys. */
export function normalizeModelEntryForEditor(entry: ModelCatalogEntry): ModelCatalogEntry {
  const defaults = createDefaultModelEntry();
  const merged = { ...defaults, ...entry };
  if (!Array.isArray(merged.input_modalities) || merged.input_modalities.length === 0) {
    merged.input_modalities = [...MODEL_CATALOG_ENUMS.inputModalities];
  }
  return merged;
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
