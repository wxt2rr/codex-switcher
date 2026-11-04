import type { GatewayProtocol, JsonObject, JsonValue } from "../protocol.js";
import { type ConversionResponseEvent } from "./response-converter.js";
import { type ConversionUsage } from "./usage.js";
import type { ConversionMetadata, ConversionOptions, ConversionResult } from "./types.js";
interface ResponseToolState {
    callId: string;
    itemId: string;
    outputIndex?: number;
    name?: string;
    namespace?: string;
    kind?: "function" | "custom" | "tool_search" | "hosted";
    signature?: string;
    raw?: JsonObject;
    arguments: string;
    announced: boolean;
}
export interface ResponseStreamState {
    readonly id: string;
    readonly source: GatewayProtocol;
    readonly target: GatewayProtocol;
    readonly metadata: ConversionMetadata;
    readonly options: ConversionOptions;
    started: boolean;
    ended: boolean;
    sequenceNumber: number;
    toolCallAliases: Map<string, string>;
    nextToolCallIndex: number;
    anthropicOpenBlock?: {
        type: "text" | "thinking" | "tool_use";
        index: number;
    };
    anthropicNextBlockIndex: number;
    anthropicToolBlockIndexes: Map<string, number>;
    /** Output item bookkeeping used when emitting a native Responses stream. */
    responseCreatedAt: number;
    responseOutputIndex: number;
    responseTextState?: {
        itemId: string;
        outputIndex: number;
        text: string;
        announced: boolean;
        annotations?: JsonValue[];
        refusal?: string;
    };
    responseReasoningState?: {
        itemId: string;
        outputIndex: number;
        text: string;
        announced: boolean;
        signature?: string;
        encryptedContent?: string;
        summaryParts: Array<{
            text: string;
            signature?: string;
        }>;
    };
    /** Responses can interleave multiple message/reasoning output items. Keep
     * each lifecycle independently instead of coalescing the whole response
     * into the first item (the legacy singular fields remain as first-item
     * compatibility aliases for callers that inspect stream state). */
    responseTextStates: Map<string, {
        itemId: string;
        outputIndex: number;
        text: string;
        announced: boolean;
        annotations?: JsonValue[];
        refusal?: string;
    }>;
    responseReasoningStates: Map<string, {
        itemId: string;
        outputIndex: number;
        text: string;
        announced: boolean;
        signature?: string;
        encryptedContent?: string;
        summaryParts: Array<{
            text: string;
            signature?: string;
        }>;
    }>;
    responseMediaStates: Array<{
        itemId: string;
        outputIndex: number;
        mediaType: "image" | "file";
        media: JsonObject;
        announced: boolean;
        completed: boolean;
    }>;
    responseToolStates: Map<string, ResponseToolState>;
    usage: ConversionUsage;
    events: ConversionResponseEvent[];
    responseMetadata?: JsonObject;
    responseStatus?: string;
    responseIncompleteReason?: string;
    responseIncompleteDetails?: JsonObject;
    warningEmitted: boolean;
}
export declare function createResponseStreamState(source: GatewayProtocol, target: GatewayProtocol, metadata?: ConversionMetadata, options?: ConversionOptions): ResponseStreamState;
export declare function convertStreamChunk(state: ResponseStreamState, body: JsonObject): Promise<ConversionResult<JsonObject[]>>;
export declare function finalizeResponseStream(state: ResponseStreamState, reason?: string): Promise<ConversionResult<JsonObject[]>>;
export declare function failResponseStream(state: ResponseStreamState, code: string, message: string, retryable?: boolean, details?: JsonObject): Promise<ConversionResult<JsonObject[]>>;
export {};
