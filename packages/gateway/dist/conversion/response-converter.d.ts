import type { GatewayProtocol, JsonObject, JsonValue } from "../protocol.js";
import { type ConversionUsage } from "./usage.js";
import type { ConversionMetadata, ConversionOptions, ConversionResult } from "./types.js";
export type ConversionResponseEvent = {
    type: "message_start";
    responseId: string;
    role: "assistant";
    createdAt?: number;
    model?: string;
    status?: string;
    metadata?: JsonObject;
} | {
    type: "text_delta";
    text: string;
    annotations?: JsonValue[];
    annotationIndex?: number;
    refusal?: string;
    itemId?: string;
    outputIndex?: number;
    contentIndex?: number;
} | {
    type: "reasoning_delta";
    text: string;
    signature?: string;
    encryptedContent?: string;
    itemId?: string;
    outputIndex?: number;
    summaryIndex?: number;
} | {
    type: "media";
    mediaType: "image" | "file";
    media: JsonObject;
    itemId?: string;
    outputIndex?: number;
} | {
    type: "tool_call_delta";
    callId: string;
    name?: string;
    namespace?: string;
    argumentsDelta?: string;
    argumentsFinal?: boolean;
    index?: number;
    signature?: string;
    kind?: "function" | "custom" | "tool_search" | "hosted";
    raw?: JsonObject;
    itemId?: string;
    outputIndex?: number;
} | {
    type: "tool_result";
    callId: string;
    name?: string;
    output: JsonValue;
    isError?: boolean;
    kind?: "function" | "custom" | "tool_search" | "hosted";
    raw?: JsonObject;
    itemId?: string;
    outputIndex?: number;
} | {
    type: "usage";
    usage: ConversionUsage;
} | {
    type: "error";
    code: string;
    message: string;
    retryable: boolean;
    details?: JsonObject;
} | {
    type: "message_end";
    reason?: string;
    incompleteReason?: string;
    status?: string;
    metadata?: JsonObject;
    incompleteDetails?: JsonObject;
};
export interface ConvertedResponse {
    responseId: string;
    text: string;
    textItemId?: string;
    textOutputIndex?: number;
    textContentIndex?: number;
    textAnnotations?: JsonValue[];
    refusal?: string;
    reasoning: string;
    reasoningItemId?: string;
    reasoningOutputIndex?: number;
    reasoningSummaryIndex?: number;
    reasoningSignature?: string;
    reasoningEncryptedContent?: string;
    /** Distinct Responses reasoning items, including ordered summary parts. */
    reasoningItems: Array<{
        itemId?: string;
        outputIndex?: number;
        parts: JsonValue[];
        encryptedContent?: string;
    }>;
    media: Array<{
        mediaType: "image" | "file";
        media: JsonObject;
        itemId?: string;
        outputIndex?: number;
    }>;
    /** Message output items kept separate for Responses item-boundary fidelity. */
    messageItems: Array<{
        itemId?: string;
        outputIndex?: number;
        parts: JsonValue[];
    }>;
    toolCalls: Array<{
        callId: string;
        name?: string;
        namespace?: string;
        arguments: string;
        signature?: string;
        kind?: "function" | "custom" | "tool_search" | "hosted";
        raw?: JsonObject;
        itemId?: string;
        outputIndex?: number;
    }>;
    toolResults: Array<{
        callId: string;
        name?: string;
        output: JsonValue;
        isError?: boolean;
        kind?: "function" | "custom" | "tool_search" | "hosted";
        raw?: JsonObject;
        itemId?: string;
        outputIndex?: number;
    }>;
    /** First-seen output order, used to keep mixed text/media/tool turns stable. */
    outputOrder: Array<{
        kind: "message" | "reasoning" | "media" | "tool_call" | "tool_result";
        id?: string;
        index?: number;
    }>;
    invalidToolCalls: number;
    usage: ConversionUsage;
    endReason?: string;
    incompleteReason?: string;
    incompleteDetails?: JsonObject;
    createdAt?: number;
    status?: string;
}
export declare function decodeResponseEvents(protocol: GatewayProtocol, body: JsonObject, metadata?: ConversionMetadata): ConversionResponseEvent[];
export declare function encodeResponseEvents(protocol: GatewayProtocol, events: readonly ConversionResponseEvent[], metadata?: ConversionMetadata): JsonObject;
export declare function convertGatewayResponse(source: GatewayProtocol, target: GatewayProtocol, body: JsonObject, metadata?: ConversionMetadata, options?: ConversionOptions): Promise<ConversionResult<JsonObject>>;
