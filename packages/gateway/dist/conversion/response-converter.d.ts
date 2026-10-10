import type { GatewayProtocol, JsonObject } from "../protocol.js";
import { type ConversionUsage } from "./usage.js";
import type { ConversionMetadata, ConversionOptions, ConversionResult } from "./types.js";
export type ConversionResponseEvent = {
    type: "message_start";
    responseId: string;
    role: "assistant";
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
    usage: ConversionUsage;
} | {
    type: "error";
    code: string;
    message: string;
    retryable: boolean;
} | {
    type: "message_end";
    reason?: string;
};
export interface ConvertedResponse {
    responseId: string;
    text: string;
    reasoning: string;
    toolCalls: Array<{
        callId: string;
        name?: string;
        arguments: string;
    }>;
    usage: ConversionUsage;
    endReason?: string;
}
export declare function decodeResponseEvents(protocol: GatewayProtocol, body: JsonObject): ConversionResponseEvent[];
export declare function encodeResponseEvents(protocol: GatewayProtocol, events: readonly ConversionResponseEvent[], metadata?: ConversionMetadata): JsonObject;
export declare function convertGatewayResponse(source: GatewayProtocol, target: GatewayProtocol, body: JsonObject, metadata?: ConversionMetadata, _options?: ConversionOptions): Promise<ConversionResult<JsonObject>>;
