import type { GatewayProtocol, JsonObject, JsonValue } from "../protocol.js";
import type { ConversionDiagnostic, ToolLossPolicy } from "./diagnostics.js";
import type { ConversionPath, ConversionQuality, ConversionStep } from "./formats.js";
import type { CapabilityProfile } from "../capability/contracts.js";

export interface ReasoningConversionState {
  enabled?: boolean;
  effort?: "low" | "medium" | "high" | "xhigh";
  budgetTokens?: number;
  returnThinking?: boolean;
  /** Provider-specific request mode, for example Anthropic `adaptive`. */
  mode?: "enabled" | "adaptive" | "disabled";
  /** OpenAI Responses reasoning summary preference. */
  summary?: "auto" | "concise" | "detailed";
  /** Provider-native fields retained for lossless same-protocol forwarding. */
  raw?: JsonObject;
}

/**
 * Request controls shared by the supported wire protocols. Keeping these
 * values in one object prevents protocol-specific decoders from silently
 * dropping valid controls before the target encoder gets a chance to map
 * them. `raw` is only used for fields that have no cross-protocol semantic.
 */
export interface CanonicalRequestParameters {
  maxTokens?: number;
  maxCompletionTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: JsonValue;
  stopSequences?: JsonValue;
  serviceTier?: string;
  promptCacheKey?: string;
  include?: JsonValue;
  streamOptions?: JsonObject;
  responseFormat?: JsonValue;
  /** OpenAI Chat Completions hosted web-search options (top-level field). */
  webSearchOptions?: JsonObject;
  textFormat?: JsonObject;
  clientMetadata?: JsonObject;
  providerMetadata?: JsonObject;
  outputConfig?: JsonObject;
  speed?: string;
  safeguards?: JsonValue;
  /** Shared sampling/penalty controls used by Chat-compatible providers. */
  frequencyPenalty?: number;
  presencePenalty?: number;
  topK?: number;
  topLogprobs?: number;
  logprobs?: JsonValue;
  seed?: number;
  n?: number;
  user?: string;
  modalities?: JsonValue;
  prediction?: JsonValue;
  logitBias?: JsonValue;
  audio?: JsonValue;
  /** Responses lifecycle/privacy controls. */
  store?: boolean;
  background?: boolean;
  truncation?: string;
  safetyIdentifier?: string;
  maxToolCalls?: number;
  promptCacheRetention?: string;
  /** Anthropic-specific controls retained in the canonical request. */
  topKAnthropic?: number;
  contextManagement?: JsonObject;
  container?: JsonValue;
  mcpServers?: JsonValue;
  betas?: JsonValue;
  /** Gemini top-level controls. */
  safetySettings?: JsonValue;
  cachedContent?: string;
  /** Gemini generationConfig fields not represented by the shared controls. */
  geminiGenerationConfig?: JsonObject;
  /** Provider-specific fields retained for same-provider forwarding. */
  raw?: JsonObject;
}

export interface ConversionMetadata {
  requestId?: string;
  traceId?: string;
  originModelName?: string;
  upstreamModelName?: string;
  reasoning?: ReasoningConversionState;
  toolState?: JsonObject;
  providerDialect?: string;
  upstreamEndpoint?: string;
  options?: JsonObject;
  /**
   * Deterministic tool-name rewrites applied when a protocol without
   * namespaces receives a Responses namespace. Keys are upstream wire names;
   * values are the original client-visible child names. The map is request
   * scoped and is carried into response/stream conversion so tool calls are
   * restored without guessing from a string delimiter.
   */
  toolNameMap?: Record<string, string>;
  /** Upstream qualified name -> original Responses namespace. */
  toolNamespaceMap?: Record<string, string>;
  /** Upstream name -> semantic kind, used to restore custom/tool-search calls. */
  toolKindMap?: Record<string, "function" | "custom" | "namespace" | "web_search" | "code_interpreter" | "computer_use" | "tool_search" | "hosted">;
  /** Original client-visible names to their deterministic upstream names. */
  toolChoiceMap?: Record<string, string>;
}

export interface ConversionOptions {
  toolLossPolicy?: ToolLossPolicy;
  /**
   * Role used for developer instructions when encoding Chat Completions.
   * Most compatible providers only accept `system`; preserve `developer`
   * only when the route explicitly opts into it.
   */
  instructionRole?: "auto" | "system" | "developer";
  /** Capability observations for the selected provider/model/protocol route. */
  capabilityProfile?: CapabilityProfile;
  /** Safe mode omits unknown hosted tools; allow preserves legacy conversion. */
  capabilityPolicy?: "safe" | "allow";
  mediaResolver?: MediaResolver;
  emitSequenceNumber?: boolean;
  /** Provider dialect for Chat token budget serialization. */
  chatMaxTokensField?: "max_tokens" | "max_completion_tokens";
  /** Optional compatibility warning emitted before the first streamed output. */
  warning?: string;
}

export interface MediaResolver {
  resolveImage?(input: string): Promise<{ mimeType: string; data: string }>;
  resolveFile?(input: string): Promise<{ mimeType: string; data: string; fileName?: string }>;
}

export interface ConversionResult<T extends JsonValue | JsonValue[] | JsonObject = JsonObject> {
  value: T;
  from: GatewayProtocol;
  to: GatewayProtocol;
  converterId: string;
  quality: ConversionQuality;
  steps: ConversionStep[];
  diagnostics: ConversionDiagnostic[];
  usage?: JsonObject;
  stream?: boolean;
  /** Effective request-scoped metadata, including any tool-name mapping. */
  metadata?: ConversionMetadata;
}

export interface ConversionPlanResult {
  path: ConversionPath;
  metadata: ConversionMetadata;
  options: ConversionOptions;
}
