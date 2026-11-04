import type { GatewayProtocol, JsonObject, JsonValue } from "../protocol.js";
import type { CapabilityProfile } from "../capability/contracts.js";
/**
 * Tool semantics shared by all wire protocols. The wire shape is deliberately
 * not stored here: Responses, Chat, Anthropic and Gemini do not use the same
 * function-tool envelope and must be encoded independently.
 */
export type CanonicalToolKind = "function" | "custom" | "namespace" | "web_search" | "code_interpreter" | "computer_use" | "tool_search" | "hosted";
export interface CanonicalTool {
    kind: CanonicalToolKind;
    /** For a namespace child this is the child function name, not a qualified wire name. */
    name: string;
    description?: string;
    inputSchema?: JsonObject;
    namespace?: string;
    namespaceDescription?: string;
    namespaceDeferLoading?: boolean;
    strict?: boolean;
    deferLoading?: boolean;
    /** Responses custom-tool format or another protocol-specific schema. */
    inputFormat?: JsonObject;
    /** Provider-native fields are retained only for lossless same-protocol forwarding. */
    raw?: JsonObject;
}
export interface QualifiedToolSet {
    tools: CanonicalTool[];
    /** Upstream wire name -> original client-visible child name. */
    toolNameMap: Record<string, string>;
    /** Upstream wire name -> original Responses namespace. */
    toolNamespaceMap: Record<string, string>;
    /** Upstream wire name -> original semantic tool kind. */
    toolKindMap: Record<string, CanonicalToolKind>;
    /** Original client-visible child name -> upstream wire name when unique. */
    toolChoiceMap: Record<string, string>;
}
/**
 * Protocols other than Responses do not have a namespace envelope. Preserve
 * the namespace boundary in a valid function name instead of sending two
 * same-named children upstream and hoping the provider can disambiguate them.
 * The generated name is request-scoped and is reversed with the explicit map
 * carried in ConversionMetadata; it is never decoded by string heuristics.
 */
export declare function qualifyToolsForProtocol(protocol: GatewayProtocol, tools: readonly CanonicalTool[]): QualifiedToolSet;
export declare function decodeTools(protocol: GatewayProtocol, value: JsonValue | undefined): CanonicalTool[];
export declare function encodeTools(protocol: GatewayProtocol, tools: readonly CanonicalTool[], capabilityProfile?: CapabilityProfile, capabilityPolicy?: "safe" | "allow", onOmit?: (tool: CanonicalTool, reason: string) => void): JsonValue[] | undefined;
