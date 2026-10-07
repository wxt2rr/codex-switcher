import { createHash } from "node:crypto";
export class UsageLedger {
    records = [];
    spans = [];
    maxRecords;
    constructor(maxRecords = 100_000) { this.maxRecords = Math.max(100, maxRecords); }
    append(record) {
        if (!record.requestId || !record.traceId || !record.providerId)
            throw new Error("Usage record is missing identity");
        this.records.push({ ...record, metadata: record.metadata ? { ...record.metadata } : undefined });
        while (this.records.length > this.maxRecords)
            this.records.shift();
    }
    addSpan(span) {
        this.spans.push({ ...span, attributes: { ...span.attributes } });
        while (this.spans.length > this.maxRecords * 2)
            this.spans.shift();
    }
    query(query = {}) {
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
    traces(traceId) { return this.spans.filter((span) => span.traceId === traceId); }
    aggregate(query = {}, dimension = "providerId") {
        const buckets = new Map();
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
    quota(policy, query = {}, now = Date.now()) {
        const resetAt = now + Math.max(1, policy.windowMinutes) * 60_000;
        const from = now - Math.max(1, policy.windowMinutes) * 60_000;
        const records = this.query({ ...query, from, to: now });
        const usedRequests = records.length;
        const usedTokens = records.reduce((total, record) => total + record.inputTokens + record.outputTokens, 0);
        const usedCost = records.reduce((total, record) => total + (record.actualCost ?? record.standardCost ?? 0), 0);
        if (policy.maxRequests !== undefined && usedRequests >= policy.maxRequests)
            return { allowed: false, reason: "requests", usedRequests, usedTokens, usedCost, resetAt };
        if (policy.maxTokens !== undefined && usedTokens >= policy.maxTokens)
            return { allowed: false, reason: "tokens", usedRequests, usedTokens, usedCost, resetAt };
        if (policy.maxCost !== undefined && usedCost >= policy.maxCost)
            return { allowed: false, reason: "cost", usedRequests, usedTokens, usedCost, resetAt };
        return { allowed: true, usedRequests, usedTokens, usedCost, resetAt };
    }
    size() { return this.records.length; }
}
export class UsageTrace {
    ledger;
    now;
    started = new Map();
    constructor(ledger, now = Date.now) {
        this.ledger = ledger;
        this.now = now;
    }
    start(traceId, spanId, stage, attributes = {}, parentSpanId) {
        const span = { traceId, spanId, stage, startedAt: this.now(), attributes: { ...attributes }, ...(parentSpanId ? { parentSpanId } : {}) };
        this.started.set(spanId, span);
        this.ledger.addSpan(span);
    }
    finish(spanId, attributes = {}, error) {
        const span = this.started.get(spanId);
        if (!span)
            return;
        const complete = { ...span, completedAt: this.now(), attributes: { ...span.attributes, ...attributes }, ...(error ? { error } : {}) };
        this.started.delete(spanId);
        this.ledger.addSpan(complete);
    }
}
export function calculateUsageCost(record, profile) {
    if (profile.providerId !== record.providerId || !new RegExp(profile.modelPattern).test(record.servedModel))
        return 0;
    return (record.inputTokens * profile.inputPerMillion + record.outputTokens * profile.outputPerMillion + record.reasoningTokens * (profile.reasoningPerMillion ?? profile.outputPerMillion) + record.cacheReadTokens * (profile.cacheReadPerMillion ?? 0) + record.cacheWriteTokens * (profile.cacheWritePerMillion ?? 0)) / 1_000_000;
}
export function hashSessionId(value) { return createHash("sha256").update(value).digest("hex").slice(0, 32); }
function sum(records, key) { return records.reduce((total, record) => total + record[key], 0); }
//# sourceMappingURL=ledger.js.map