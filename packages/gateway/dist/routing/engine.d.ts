import type { GatewayCapability, GatewayProtocol } from "../protocol.js";
import type { GatewayDecisionTrace, GatewayResolvedRoute } from "./contracts.js";
export type RouteGroupStrategy = "smart" | "order" | "rotate" | "usage" | "pace" | "weight" | "weighted_round_robin";
export type RouteAffinity = "auto" | "session" | "turn" | "off";
export interface RouteGroupNode {
    id: string;
    displayName: string;
    exposedModelId: string;
    members: string[];
    strategy: RouteGroupStrategy;
    affinity: RouteAffinity;
    fallbackEnabled: boolean;
    priority: number;
    weights?: Record<string, number>;
    capabilities?: Partial<Record<GatewayCapability, boolean>>;
}
export interface RuntimeRouteCandidate {
    id: string;
    providerId: string;
    credentialId: string;
    modelId: string;
    protocol: GatewayProtocol;
    capabilities: GatewayCapability[];
    priority: number;
    weight: number;
    healthy: boolean;
    cooldownUntil?: number;
    requestsInWindow?: number;
    tokensInWindow?: number;
    quotaRemaining?: number;
    resetAt?: number;
    latencyMs?: number;
}
export interface RouteEngineState {
    cursors: Record<string, number>;
    affinity: Record<string, {
        routeId: string;
        expiresAt: number;
    }>;
}
export interface RouteResolveInput {
    requestedModel?: string;
    protocol: GatewayProtocol;
    /** Allow the runtime protocol codecs to translate between ingress and upstream protocols. */
    allowProtocolConversion?: boolean;
    requiredCapabilities?: Partial<Record<GatewayCapability, boolean>>;
    sessionKey?: string;
    turnKey?: string;
    agentId?: string;
    rules?: readonly GatewayRouteRule[];
    ruleContext?: GatewayRouteRuleContext;
    now?: number;
    state?: RouteEngineState;
}
export interface GatewayRouteRuleMatch {
    tokenCount?: {
        min?: number;
        max?: number;
    };
    hasImages?: boolean;
    reasoning?: boolean;
    reasoningProfiles?: string[];
    agentIds?: string[];
    contextCompacted?: boolean;
    time?: {
        startHour: number;
        endHour: number;
        daysOfWeek?: number[];
        timezone?: "local" | "utc";
    };
    modelIds?: string[];
    providerIds?: string[];
}
export interface GatewayRouteRule {
    id: string;
    targetModelId: string;
    priority: number;
    enabled: boolean;
    match: GatewayRouteRuleMatch;
}
export interface GatewayRouteRuleContext {
    tokenCount?: number;
    hasImages?: boolean;
    reasoning?: boolean;
    reasoningProfile?: string;
    agentId?: string;
    contextCompacted?: boolean;
    now?: number;
    requestedModel?: string;
    providerId?: string;
}
export interface RouteResolveResult {
    route: GatewayResolvedRoute;
    state: RouteEngineState;
    groupId?: string;
    traces: GatewayDecisionTrace[];
    fallbackRoutes: GatewayResolvedRoute[];
}
export type RouteResolveErrorCode = "NO_ROUTE" | "CYCLE" | "MAX_DEPTH" | "MODEL_NOT_FOUND" | "CAPABILITY_NOT_SUPPORTED";
export declare class RouteResolveError extends Error {
    readonly code: RouteResolveErrorCode;
    readonly traces: GatewayDecisionTrace[];
    constructor(code: RouteResolveErrorCode, message: string, traces?: GatewayDecisionTrace[]);
}
export declare const MAX_ROUTE_GROUP_DEPTH = 8;
export declare function resolveRoute(candidates: readonly RuntimeRouteCandidate[], groups: Readonly<Record<string, RouteGroupNode>>, input: RouteResolveInput): RouteResolveResult;
export type RouteFailureClass = "transport" | "timeout" | "rate_limit" | "quota" | "unauthorized" | "upstream_5xx" | "upstream_4xx" | "validation" | "stream_interrupted";
export declare function classifyRouteFailure(status: number | null, error?: unknown): RouteFailureClass;
export declare function isRetryableRouteFailure(failure: RouteFailureClass): boolean;
