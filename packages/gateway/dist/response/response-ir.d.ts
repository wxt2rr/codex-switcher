import type { GatewayProtocol, JsonObject } from "../protocol.js";
export type GatewayResponseEvent = {
    type: "message_start";
    responseId: string;
} | {
    type: "text_delta";
    text: string;
} | {
    type: "reasoning_delta";
    text: string;
} | {
    type: "tool_call_delta";
    callId: string;
    name?: string;
    argumentsDelta?: string;
} | {
    type: "usage";
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
} | {
    type: "error";
    code: string;
    message: string;
    retryable: boolean;
} | {
    type: "message_end";
    reason?: string;
};
export interface GatewayResponseEnvelope {
    protocol: GatewayProtocol;
    events: GatewayResponseEvent[];
    metadata?: JsonObject;
}
export declare function isTerminalGatewayResponseEvent(event: GatewayResponseEvent): boolean;
