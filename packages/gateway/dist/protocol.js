export const GATEWAY_PROTOCOLS = [
    "responses",
    "chat_completions",
    "anthropic",
    "gemini",
];
export function isGatewayProtocol(value) {
    return typeof value === "string" && GATEWAY_PROTOCOLS.includes(value);
}
export function normalizeCapabilities(capabilities) {
    return [...new Set(capabilities ?? [])].sort();
}
//# sourceMappingURL=protocol.js.map