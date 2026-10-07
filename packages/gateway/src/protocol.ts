export type GatewayProtocol =
  | "responses"
  | "chat_completions"
  | "anthropic"
  | "gemini";

export type GatewayCapability =
  | "streaming"
  | "tools"
  | "reasoning"
  | "vision"
  | "prompt_cache";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export const GATEWAY_PROTOCOLS: readonly GatewayProtocol[] = [
  "responses",
  "chat_completions",
  "anthropic",
  "gemini",
] as const;

export function isGatewayProtocol(value: unknown): value is GatewayProtocol {
  return typeof value === "string" && GATEWAY_PROTOCOLS.includes(value as GatewayProtocol);
}

export function normalizeCapabilities(
  capabilities: readonly GatewayCapability[] | undefined,
): GatewayCapability[] {
  return [...new Set(capabilities ?? [])].sort();
}
