import type { GatewayProtocol, JsonObject, JsonValue } from "../protocol.js";

export type GatewayResponseEvent =
  | { type: "message_start"; responseId: string; createdAt?: number; model?: string; status?: string; metadata?: JsonObject }
  | { type: "text_delta"; text: string; annotations?: JsonValue[]; annotationIndex?: number; refusal?: string; itemId?: string; outputIndex?: number; contentIndex?: number }
  | { type: "reasoning_delta"; text: string; signature?: string; itemId?: string; outputIndex?: number; summaryIndex?: number; encryptedContent?: string }
  | { type: "media"; mediaType: "image" | "file"; media: JsonObject; itemId?: string; outputIndex?: number }
  | { type: "tool_call_delta"; callId: string; name?: string; namespace?: string; argumentsDelta?: string; signature?: string; index?: number; kind?: "function" | "custom" | "tool_search" | "hosted"; raw?: JsonObject; itemId?: string; outputIndex?: number }
  | { type: "tool_result"; callId: string; name?: string; output: JsonValue; isError?: boolean; kind?: "function" | "custom" | "tool_search" | "hosted"; raw?: JsonObject; itemId?: string; outputIndex?: number }
  | { type: "usage"; inputTokens: number; outputTokens: number; reasoningTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }
  | { type: "error"; code: string; message: string; retryable: boolean; details?: JsonObject }
  | { type: "message_end"; reason?: string; incompleteReason?: string; status?: string; metadata?: JsonObject; incompleteDetails?: JsonObject };

export interface GatewayResponseEnvelope {
  protocol: GatewayProtocol;
  events: GatewayResponseEvent[];
  metadata?: JsonObject;
}

export function isTerminalGatewayResponseEvent(event: GatewayResponseEvent): boolean {
  return event.type === "message_end" || event.type === "error";
}
