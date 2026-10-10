import type { GatewayCapability, GatewayProtocol, JsonObject } from "../protocol.js";
import { convertGatewayRequest } from "../conversion/request-converter.js";
import { type ResponseStreamState } from "../conversion/stream-state.js";
import type { ConversionOptions, ConversionResult } from "../conversion/types.js";
import type { GatewayRequestIR } from "../request/request-ir.js";
import { type RouteEngineState, type RouteGroupNode, type RouteFailureClass, type RouteResolveResult, type RuntimeRouteCandidate } from "../routing/engine.js";
import { ProviderRegistry } from "../provider/registry.js";
import { UsageLedger, type GatewayUsageRecord, type UsagePricingProfile, type UsageQuotaPolicy } from "../usage/ledger.js";
export interface GatewayRuntimeOptions {
    candidates: readonly RuntimeRouteCandidate[];
    groups: Readonly<Record<string, RouteGroupNode>>;
    providerRegistry?: ProviderRegistry;
    ledger?: UsageLedger;
    quotaPolicy?: UsageQuotaPolicy;
    pricingProfiles?: readonly UsagePricingProfile[];
    now?: () => number;
}
export interface GatewayDispatchInput {
    requestId?: string;
    traceId?: string;
    environmentId: string;
    agentId: string;
    protocol: GatewayProtocol;
    model: string;
    body: JsonObject;
    sessionId?: string;
    turnKey?: string;
    capabilities?: GatewayRequestIR["context"]["capabilities"];
    requiredCapabilities?: Partial<Record<GatewayCapability, boolean>>;
    metadata?: JsonObject;
    routeState?: RouteEngineState;
    now?: number;
}
export interface GatewayDispatchResult {
    request: GatewayRequestIR;
    requestBody: JsonObject;
    route: RouteResolveResult;
    upstreamProtocol: GatewayProtocol;
    upstreamModel: string;
    upstreamBody: JsonObject;
    conversion: Awaited<ReturnType<typeof convertGatewayRequest>>;
    traceId: string;
    startedAt: number;
}
export interface GatewayCompletionInput {
    dispatch: GatewayDispatchResult;
    upstreamBody?: JsonObject;
    status?: "success" | "error" | "cancelled";
    failureClass?: string;
    retryCount?: number;
    firstByteAt?: number;
    completedAt?: number;
}
export interface GatewayCompletionResult {
    responseBody?: JsonObject;
    usage: GatewayUsageRecord;
}
export type GatewayStreamResult = ConversionResult<JsonObject[]>;
export interface GatewayTransportResult<T> {
    value?: T;
    status?: number | null;
    firstByteStarted?: boolean;
}
export interface GatewayFallbackAttempt {
    route: GatewayDispatchResult["route"]["route"];
    status: number | null;
    firstByteStarted: boolean;
    failureClass?: RouteFailureClass;
}
export interface GatewayFallbackResult<T> {
    value: T;
    dispatch: GatewayDispatchResult;
    attempts: GatewayFallbackAttempt[];
    retryCount: number;
}
export declare class GatewayFallbackError extends Error {
    readonly attempts: GatewayFallbackAttempt[];
    readonly lastError?: unknown;
    constructor(message: string, attempts: GatewayFallbackAttempt[], lastError?: unknown);
}
/**
 * The framework-agnostic Gateway orchestration layer.
 *
 * Electron/HTTP code supplies transport and persistence; this class owns the
 * request lifecycle: decode, route resolution, protocol
 * conversion, quota admission, usage accounting, and response conversion.
 */
export declare class GatewayRuntime {
    readonly providerRegistry: ProviderRegistry;
    readonly ledger: UsageLedger;
    private readonly now;
    private readonly options;
    private readonly trace;
    constructor(options: GatewayRuntimeOptions);
    dispatch(input: GatewayDispatchInput): Promise<GatewayDispatchResult>;
    dispatchWithFallback<T>(input: GatewayDispatchInput, send: (dispatch: GatewayDispatchResult, attempt: number) => Promise<GatewayTransportResult<T>> | GatewayTransportResult<T>): Promise<GatewayFallbackResult<T>>;
    private materializeDispatch;
    complete(input: GatewayCompletionInput): Promise<GatewayCompletionResult>;
    createResponseStream(dispatch: GatewayDispatchResult, options?: ConversionOptions): ResponseStreamState;
    convertStreamChunk(state: ResponseStreamState, upstreamBody: JsonObject): Promise<GatewayStreamResult>;
    finalizeStream(state: ResponseStreamState, reason?: string): Promise<GatewayStreamResult>;
    failStream(state: ResponseStreamState, code: string, message: string): Promise<GatewayStreamResult>;
}
