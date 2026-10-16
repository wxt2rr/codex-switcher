import type { GatewayProtocol, JsonObject, JsonValue } from "../protocol.js";
import type { CapabilityProfile } from "../capability/contracts.js";
export type CanonicalToolKind = "function" | "custom" | "namespace" | "web_search" | "code_interpreter" | "computer_use";
export interface CanonicalTool {
    kind: CanonicalToolKind;
    name: string;
    description?: string;
    inputSchema?: JsonObject;
    namespace?: string;
    raw?: JsonObject;
}
export declare function decodeTools(protocol: GatewayProtocol, value: JsonValue | undefined): CanonicalTool[];
export declare function encodeTools(protocol: GatewayProtocol, tools: readonly CanonicalTool[], capabilityProfile?: CapabilityProfile, capabilityPolicy?: "safe" | "allow", onOmit?: (tool: CanonicalTool, reason: string) => void): JsonValue[] | undefined;
