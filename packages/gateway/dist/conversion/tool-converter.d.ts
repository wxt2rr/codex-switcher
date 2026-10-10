import type { GatewayProtocol, JsonObject, JsonValue } from "../protocol.js";
export type CanonicalToolKind = "function" | "custom" | "namespace" | "web_search";
export interface CanonicalTool {
    kind: CanonicalToolKind;
    name: string;
    description?: string;
    inputSchema?: JsonObject;
    namespace?: string;
    raw?: JsonObject;
}
export declare function decodeTools(protocol: GatewayProtocol, value: JsonValue | undefined): CanonicalTool[];
export declare function encodeTools(protocol: GatewayProtocol, tools: readonly CanonicalTool[]): JsonValue[] | undefined;
