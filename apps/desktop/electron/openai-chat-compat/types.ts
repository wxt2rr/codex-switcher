import type { CompatibilityInstructionRole, LongConversationStrategy, ReasoningProfile } from "../usage-routing-model.js";

export class CompatibilityError extends Error {
  constructor(
    readonly code: "UNSUPPORTED_ITEM" | "INVALID_TOOL" | "INVALID_REQUEST" | "UPSTREAM_PROTOCOL" | "INCOMPATIBLE_COMPACTION",
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "CompatibilityError";
  }
}

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content?: string | Array<Record<string, unknown>> | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
}

export interface ToolRegistryEntry {
  originalType: "function" | "custom" | "namespace" | "tool_search";
  originalName: string;
  namespace?: string;
  chatName: string;
  definition: Record<string, unknown>;
}

export interface ToolRegistry {
  entries: ToolRegistryEntry[];
  chatTools: Record<string, unknown>[];
  byChatName: Map<string, ToolRegistryEntry>;
  byOriginalName: Map<string, ToolRegistryEntry>;
}

export interface TransformResponsesRequestInput {
  request: Record<string, unknown>;
  upstreamModel?: string;
  reasoningProfile?: ReasoningProfile;
  requestOverrides?: Record<string, unknown>;
  longConversationStrategy?: LongConversationStrategy;
  instructionRole?: CompatibilityInstructionRole;
}

export interface TransformedChatRequest {
  body: Record<string, unknown>;
  tools: ToolRegistry;
  requestedModel: string;
  warning?: string;
}
