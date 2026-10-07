import { createHash } from "node:crypto";

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

export class UsageLedger {
  private readonly records: GatewayUsageRecord[] = [];
  private readonly spans: UsageTraceSpan[] = [];
  private readonly maxRecords: number;

  constructor(maxRecords = 100_000) { this.maxRecords = Math.max(100, maxRecords); }

  append(record: GatewayUsageRecord): void {
    if (!record.requestId || !record.traceId || !record.providerId) throw new Error("Usage record is missing identity");
    this.records.push({ ...record, metadata: record.metadata ? { ...record.metadata } : undefined });
    while (this.records.length > this.maxRecords) this.records.shift();
  }

  addSpan(span: UsageTraceSpan): void {
    this.spans.push({ ...span, attributes: { ...span.attributes } });
    while (this.spans.length > this.maxRecords * 2) this.spans.shift();
  }

  query(query: UsageQuery = {}): GatewayUsageRecord[] {
    const from = query.from ?? 0;
    const to = query.to ?? Number.MAX_SAFE_INTEGER;
    const filtered = this.records.filter((record) => record.completedAt >= from && record.completedAt <= to
      && (!query.environmentId || record.environmentId === query.environmentId)
      && (!query.providerId || record.providerId === query.providerId)
      && (!query.agentId || record.agentId === query.agentId)
      && (!query.model || record.servedModel === query.model || record.requestedModel === query.model)
      && (!query.status || record.status === query.status));
    return filtered.slice(Math.max(0, filtered.length - (query.limit ?? 1000)));
  }

  traces(traceId: string): UsageTraceSpan[] { return this.spans.filter((span) => span.traceId === traceId); }

  aggregate(query: UsageQuery = {}, dimension: keyof Pick<GatewayUsageRecord, "environmentId" | "providerId" | "agentId" | "requestedModel" | "servedModel" | "routeGroupId"> = "providerId"): UsageAggregate[] {
    const buckets = new Map<string, GatewayUsageRecord[]>();
    for (const record of this.query(query)) {
      const key = String(record[dimension] ?? "unknown");
      const bucket = buckets.get(key) ?? [];
      bucket.push(record);
      buckets.set(key, bucket);
    }
    return [...buckets.entries()].map(([key, records]) => ({
      key,
      requests: records.length,
      inputTokens: sum(records, "inputTokens"),
      outputTokens: sum(records, "outputTokens"),
      totalTokens: records.reduce((total, record) => total + record.inputTokens + record.outputTokens, 0),
      actualCost: records.reduce((total, record) => total + (record.actualCost ?? 0), 0),
      standardCost: records.reduce((total, record) => total + (record.standardCost ?? 0), 0),
      errorRate: records.filter((record) => record.status === "error").length / records.length,
      averageLatencyMs: records.reduce((total, record) => total + record.completedAt - record.startedAt, 0) / records.length,
    }));
  }

  quota(policy: UsageQuotaPolicy, query: UsageQuery = {}, now = Date.now()): UsageQuotaDecision {
    const resetAt = now + Math.max(1, policy.windowMinutes) * 60_000;
    const from = now - Math.max(1, policy.windowMinutes) * 60_000;
    const records = this.query({ ...query, from, to: now });
    const usedRequests = records.length;
    const usedTokens = records.reduce((total, record) => total + record.inputTokens + record.outputTokens, 0);
    const usedCost = records.reduce((total, record) => total + (record.actualCost ?? record.standardCost ?? 0), 0);
    if (policy.maxRequests !== undefined && usedRequests >= policy.maxRequests) return { allowed: false, reason: "requests", usedRequests, usedTokens, usedCost, resetAt };
    if (policy.maxTokens !== undefined && usedTokens >= policy.maxTokens) return { allowed: false, reason: "tokens", usedRequests, usedTokens, usedCost, resetAt };
    if (policy.maxCost !== undefined && usedCost >= policy.maxCost) return { allowed: false, reason: "cost", usedRequests, usedTokens, usedCost, resetAt };
    return { allowed: true, usedRequests, usedTokens, usedCost, resetAt };
  }

  size(): number { return this.records.length; }
}

export class UsageTrace {
  private readonly started = new Map<string, UsageTraceSpan>();
  constructor(private readonly ledger: UsageLedger, private readonly now: () => number = Date.now) {}
  start(traceId: string, spanId: string, stage: UsageTraceSpan["stage"], attributes: UsageTraceSpan["attributes"] = {}, parentSpanId?: string): void {
    const span = { traceId, spanId, stage, startedAt: this.now(), attributes: { ...attributes }, ...(parentSpanId ? { parentSpanId } : {}) };
    this.started.set(spanId, span);
    this.ledger.addSpan(span);
  }
  finish(spanId: string, attributes: UsageTraceSpan["attributes"] = {}, error?: string): void {
    const span = this.started.get(spanId);
    if (!span) return;
    const complete = { ...span, completedAt: this.now(), attributes: { ...span.attributes, ...attributes }, ...(error ? { error } : {}) };
    this.started.delete(spanId);
    this.ledger.addSpan(complete);
  }
}

export function calculateUsageCost(record: Pick<GatewayUsageRecord, "providerId" | "servedModel" | "inputTokens" | "outputTokens" | "reasoningTokens" | "cacheReadTokens" | "cacheWriteTokens">, profile: UsagePricingProfile): number {
  if (profile.providerId !== record.providerId || !new RegExp(profile.modelPattern).test(record.servedModel)) return 0;
  return (record.inputTokens * profile.inputPerMillion + record.outputTokens * profile.outputPerMillion + record.reasoningTokens * (profile.reasoningPerMillion ?? profile.outputPerMillion) + record.cacheReadTokens * (profile.cacheReadPerMillion ?? 0) + record.cacheWriteTokens * (profile.cacheWritePerMillion ?? 0)) / 1_000_000;
}

export function hashSessionId(value: string): string { return createHash("sha256").update(value).digest("hex").slice(0, 32); }

function sum(records: GatewayUsageRecord[], key: "inputTokens" | "outputTokens"): number { return records.reduce((total, record) => total + record[key], 0); }
