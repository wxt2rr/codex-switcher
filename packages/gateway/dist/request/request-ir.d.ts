import { type GatewayCapability, type GatewayProtocol, type JsonObject } from "../protocol.js";
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
export declare function createGatewayRequestContext(input: {
    requestId: string;
    environmentId: string;
    agentId: string;
    protocol: GatewayProtocol;
    logicalModelId: string;
    sessionId?: string;
    capabilities?: readonly GatewayCapability[];
    receivedAt?: number;
    metadata?: JsonObject;
}): GatewayRequestContext;
