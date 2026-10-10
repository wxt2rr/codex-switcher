import type { GatewayProtocol, JsonObject } from "../protocol.js";
export interface ConversionUsage {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    raw?: JsonObject;
}
export declare function emptyUsage(): ConversionUsage;
export declare function decodeUsage(protocol: GatewayProtocol, body: JsonObject): ConversionUsage | undefined;
export declare function mergeUsage(current: ConversionUsage, next: ConversionUsage | undefined): ConversionUsage;
export declare function addUsage(current: ConversionUsage, next: ConversionUsage | undefined): ConversionUsage;
export declare function encodeUsage(protocol: GatewayProtocol, usage: ConversionUsage): JsonObject;
