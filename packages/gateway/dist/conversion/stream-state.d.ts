import type { GatewayProtocol, JsonObject } from "../protocol.js";
import { type ConversionResponseEvent } from "./response-converter.js";
import { type ConversionUsage } from "./usage.js";
import type { ConversionMetadata, ConversionOptions, ConversionResult } from "./types.js";
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
    };
    responseReasoningState?: {
        itemId: string;
        outputIndex: number;
        text: string;
        announced: boolean;
    };
    responseToolStates: Map<string, {
        callId: string;
        itemId: string;
        outputIndex?: number;
        name?: string;
        arguments: string;
        announced: boolean;
    }>;
    usage: ConversionUsage;
    events: ConversionResponseEvent[];
}
export declare function createResponseStreamState(source: GatewayProtocol, target: GatewayProtocol, metadata?: ConversionMetadata, options?: ConversionOptions): ResponseStreamState;
export declare function convertStreamChunk(state: ResponseStreamState, body: JsonObject): Promise<ConversionResult<JsonObject[]>>;
export declare function finalizeResponseStream(state: ResponseStreamState, reason?: string): Promise<ConversionResult<JsonObject[]>>;
export declare function failResponseStream(state: ResponseStreamState, code: string, message: string): Promise<ConversionResult<JsonObject[]>>;
