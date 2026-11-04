import type { GatewayProtocol, JsonObject, JsonValue } from "../protocol.js";
import type { ConversionResponseEvent } from "./response-converter.js";
export interface StoredToolCall {
    id: string;
    name: string;
    arguments: string;
    kind?: "function" | "custom" | "tool_search" | "hosted";
    raw?: JsonObject;
    itemId?: string;
    outputIndex?: number;
    /** Gemini thought signature / provider-native call signature. */
    signature?: string;
}
export interface ToolExchangeHistorySnapshot {
    sessions: Record<string, Record<string, StoredToolCall[]>>;
    responseItems?: Record<string, Record<string, JsonValue[]>>;
}
export interface StreamHistoryResult {
    /** Canonical Responses items in the exact first-seen order of the stream. */
    items: JsonObject[];
    /** Valid calls extracted from the same items, including partial turns. */
    calls: StoredToolCall[];
}
/** Session-scoped history for generic Gateway Responses→Chat conversion. */
export declare class ToolExchangeHistory {
    private readonly maxResponses;
    private readonly sessions;
    constructor(maxResponses?: number);
    snapshot(): ToolExchangeHistorySnapshot;
    load(snapshot: unknown): void;
    enrich(sessionId: string | undefined, protocol: GatewayProtocol, body: JsonObject): JsonObject;
    record(sessionId: string | undefined, protocol: GatewayProtocol, body: JsonObject): void;
    recordCalls(sessionId: string | undefined, responseId: string, calls: readonly StoredToolCall[]): void;
    /** Persist canonical Responses items produced by a streamed turn. */
    recordItems(sessionId: string | undefined, responseId: string, items: readonly JsonValue[]): void;
    clear(sessionId?: string): void;
}
export declare function storedCallToResponses(call: StoredToolCall): JsonObject;
/**
 * Reconstruct history from canonical stream events without regrouping all
 * assistant text/media into one item. A provider may interleave message
 * content, reasoning, calls and results; keeping an item-level boundary at
 * each kind transition is what lets a later `previous_response_id` replay
 * preserve the same executable turn.
 */
export declare function buildStreamHistory(events: readonly ConversionResponseEvent[]): StreamHistoryResult;
