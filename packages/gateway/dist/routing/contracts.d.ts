import type { GatewayCapability, GatewayProtocol } from "../protocol.js";
export interface GatewayRouteCandidate {
    providerId: string;
    credentialId: string;
    exposedModelId: string;
    upstreamModelId: string;
    protocol: GatewayProtocol;
    capabilities: GatewayCapability[];
    priority: number;
    weight: number;
}
export interface GatewayDecisionTrace {
    stage: "model" | "capability" | "health" | "quota" | "strategy" | "fallback";
    candidateId?: string;
    outcome: "selected" | "accepted" | "skipped" | "failed";
    reason: string;
}
export interface GatewayResolvedRoute {
    logicalModelId: string;
    providerId: string;
    credentialId: string;
    upstreamModelId: string;
    protocol: GatewayProtocol;
    sessionBindingKey?: string;
    decisionTrace: GatewayDecisionTrace[];
}
