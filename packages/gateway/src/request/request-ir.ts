import {
  type GatewayCapability,
  type GatewayProtocol,
  type JsonObject,
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
  type: "text" | "image" | "tool_use" | "tool_result" | "reasoning" | "unknown";
  value: JsonObject | string;
}

export interface GatewayMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  parts: GatewayMessagePart[];
  name?: string;
}

export interface GatewayToolDefinition {
  name: string;
  description?: string;
  inputSchema: JsonObject;
}

export interface GatewayRequestIR {
  context: GatewayRequestContext;
  messages: GatewayMessage[];
  tools: GatewayToolDefinition[];
  stream: boolean;
  reasoning?: JsonObject;
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
