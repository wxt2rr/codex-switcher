import {
  type GatewayCapability,
  type GatewayProtocol,
  type JsonObject,
  type JsonValue,
  normalizeCapabilities,
  isGatewayProtocol,
} from "../protocol.js";

export interface GatewayRequestContext {
  requestId: string;
  environmentId: string;
  agentId: string;
  protocol: GatewayProtocol;
  logicalModelId: string;
  sessionId?: string;
  capabilities: GatewayCapability[];
  receivedAt: number;
  metadata: JsonObject;
}

export interface GatewayMessagePart {
  type: "text" | "image" | "file" | "tool_use" | "tool_result" | "reasoning" | "unknown";
  value: JsonObject | string;
  /** Gemini thought signature / Anthropic thinking signature when present. */
  signature?: string;
}

export interface GatewayMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  parts: GatewayMessagePart[];
  name?: string;
  /** Responses assistant-message phase, required when replaying Codex history. */
  phase?: "commentary" | "final_answer";
}

export interface GatewayToolDefinition {
  kind?: "function" | "custom" | "namespace" | "web_search" | "code_interpreter" | "computer_use" | "tool_search" | "hosted";
  name: string;
  description?: string;
  inputSchema: JsonObject;
  namespace?: string;
  namespaceDescription?: string;
  namespaceDeferLoading?: boolean;
  strict?: boolean;
  deferLoading?: boolean;
  inputFormat?: JsonObject;
  raw?: JsonObject;
}

/** Request controls preserved by the public protocol codec before routing. */
export interface GatewayRequestParameters {
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
  geminiGenerationConfig?: JsonObject;
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
  store?: boolean;
  background?: boolean;
  truncation?: string;
  safetyIdentifier?: string;
  maxToolCalls?: number;
  promptCacheRetention?: string;
  contextManagement?: JsonObject;
  container?: JsonValue;
  mcpServers?: JsonValue;
  betas?: JsonValue;
  safetySettings?: JsonValue;
  cachedContent?: string;
}

export interface GatewayRequestIR {
  context: GatewayRequestContext;
  messages: GatewayMessage[];
  tools: GatewayToolDefinition[];
  stream: boolean;
  toolChoice?: JsonValue;
  parallelToolCalls?: boolean;
  reasoning?: JsonObject;
  parameters?: GatewayRequestParameters;
  metadata: JsonObject;
}

export function createGatewayRequestContext(input: {
  requestId: string;
  environmentId: string;
  agentId: string;
  protocol: GatewayProtocol;
  logicalModelId: string;
  sessionId?: string;
  capabilities?: readonly GatewayCapability[];
  receivedAt?: number;
  metadata?: JsonObject;
}): GatewayRequestContext {
  const requestId = input.requestId.trim();
  const environmentId = input.environmentId.trim();
  const agentId = input.agentId.trim();
  const logicalModelId = input.logicalModelId.trim();
  if (!requestId || !environmentId || !agentId || !logicalModelId) {
    throw new Error("Gateway request context requires request, environment, agent and model identifiers");
  }
  if (!isGatewayProtocol(input.protocol)) {
    throw new Error(`Unsupported gateway protocol: ${String(input.protocol)}`);
  }
  return {
    requestId,
    environmentId,
    agentId,
    protocol: input.protocol,
    logicalModelId,
    sessionId: input.sessionId?.trim() || undefined,
    capabilities: normalizeCapabilities(input.capabilities),
    receivedAt: input.receivedAt ?? Date.now(),
    metadata: { ...(input.metadata ?? {}) },
  };
}
