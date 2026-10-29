import type { GatewayProtocol, JsonObject } from "../protocol.js";
export interface StoredToolCall {
    id: string;
    name: string;
    arguments: string;
}
export interface ToolExchangeHistorySnapshot {
    sessions: Record<string, Record<string, StoredToolCall[]>>;
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
    clear(sessionId?: string): void;
}
