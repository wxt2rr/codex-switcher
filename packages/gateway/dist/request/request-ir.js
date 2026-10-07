import { normalizeCapabilities, isGatewayProtocol, } from "../protocol.js";
export function createGatewayRequestContext(input) {
    const requestId = input.requestId.trim();
    const environmentId = input.environmentId.trim();
    const agentId = input.agentId.trim();
    const logicalModelId = input.logicalModelId.trim();
    if (!requestId || !environmentId || !agentId || !logicalModelId) {
        throw new Error("Gateway request context requires request, environment, agent and model identifiers");
    }
    if (!isGatewayProtocol(input.protocol)) {
        throw new Error(`Unsupported gateway protocol: ${String(input.protocol)}`);
    }
    return {
        requestId,
        environmentId,
        agentId,
        protocol: input.protocol,
        logicalModelId,
        sessionId: input.sessionId?.trim() || undefined,
        capabilities: normalizeCapabilities(input.capabilities),
        receivedAt: input.receivedAt ?? Date.now(),
        metadata: { ...(input.metadata ?? {}) },
    };
}
//# sourceMappingURL=request-ir.js.map