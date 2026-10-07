export type GatewayProtocol = "responses" | "chat_completions" | "anthropic" | "gemini";
export type GatewayCapability = "streaming" | "tools" | "reasoning" | "vision" | "prompt_cache";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
    [key: string]: JsonValue;
}
export declare const GATEWAY_PROTOCOLS: readonly GatewayProtocol[];
export declare function isGatewayProtocol(value: unknown): value is GatewayProtocol;
export declare function normalizeCapabilities(capabilities: readonly GatewayCapability[] | undefined): GatewayCapability[];
