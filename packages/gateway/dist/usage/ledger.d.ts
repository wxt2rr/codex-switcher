export interface GatewayUsageRecord {
    requestId: string;
    traceId: string;
    sessionIdHash?: string;
    agentId: string;
    environmentId: string;
    providerId: string;
    credentialId: string;
    requestedModel: string;
    servedModel: string;
    protocol: string;
    routeGroupId?: string;
    startedAt: number;
    completedAt: number;
    timeToFirstTokenMs?: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    actualCost: number | null;
    standardCost: number | null;
    status: "success" | "error" | "cancelled";
    failureClass?: string;
    retryCount: number;
    metadata?: Record<string, string | number | boolean>;
}
export interface UsagePricingProfile {
    providerId: string;
    modelPattern: string;
    inputPerMillion: number;
    outputPerMillion: number;
    reasoningPerMillion?: number;
    cacheReadPerMillion?: number;
    cacheWritePerMillion?: number;
    currency: string;
}
export interface UsageTraceSpan {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    stage: "ingress" | "model" | "route" | "provider" | "stream" | "usage";
    startedAt: number;
    completedAt?: number;
    attributes: Record<string, string | number | boolean>;
    error?: string;
}
export interface UsageQuotaPolicy {
    windowMinutes: number;
    maxRequests?: number;
    maxTokens?: number;
    maxCost?: number;
}
export interface UsageQuotaDecision {
    allowed: boolean;
    reason?: "requests" | "tokens" | "cost";
    usedRequests: number;
    usedTokens: number;
    usedCost: number;
    resetAt: number;
}
export interface UsageQuery {
    from?: number;
    to?: number;
    environmentId?: string;
    providerId?: string;
    agentId?: string;
    model?: string;
    status?: GatewayUsageRecord["status"];
    limit?: number;
}
export interface UsageAggregate {
    key: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    actualCost: number;
    standardCost: number;
    errorRate: number;
    averageLatencyMs: number;
}
export declare class UsageLedger {
    private readonly records;
    private readonly spans;
    private readonly maxRecords;
    constructor(maxRecords?: number);
    append(record: GatewayUsageRecord): void;
    addSpan(span: UsageTraceSpan): void;
    query(query?: UsageQuery): GatewayUsageRecord[];
    traces(traceId: string): UsageTraceSpan[];
    aggregate(query?: UsageQuery, dimension?: keyof Pick<GatewayUsageRecord, "environmentId" | "providerId" | "agentId" | "requestedModel" | "servedModel" | "routeGroupId">): UsageAggregate[];
    quota(policy: UsageQuotaPolicy, query?: UsageQuery, now?: number): UsageQuotaDecision;
    size(): number;
}
export declare class UsageTrace {
    private readonly ledger;
    private readonly now;
    private readonly started;
    constructor(ledger: UsageLedger, now?: () => number);
    start(traceId: string, spanId: string, stage: UsageTraceSpan["stage"], attributes?: UsageTraceSpan["attributes"], parentSpanId?: string): void;
    finish(spanId: string, attributes?: UsageTraceSpan["attributes"], error?: string): void;
}
export declare function calculateUsageCost(record: Pick<GatewayUsageRecord, "providerId" | "servedModel" | "inputTokens" | "outputTokens" | "reasoningTokens" | "cacheReadTokens" | "cacheWriteTokens">, profile: UsagePricingProfile): number;
export declare function hashSessionId(value: string): string;
