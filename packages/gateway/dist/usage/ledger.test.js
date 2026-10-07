import assert from "node:assert/strict";
import test from "node:test";
import { calculateUsageCost, UsageLedger, UsageTrace } from "./ledger.js";
const record = (overrides = {}) => ({ requestId: `r-${Math.random()}`, traceId: "t", agentId: "codex", environmentId: "e", providerId: "openai", credentialId: "c", requestedModel: "logical", servedModel: "gpt", protocol: "responses", startedAt: 0, completedAt: 1000, inputTokens: 100, outputTokens: 50, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, actualCost: 0.01, standardCost: 0.02, status: "success", retryCount: 0, ...overrides });
test("usage ledger aggregates cost, latency, quota and traces", () => {
    const ledger = new UsageLedger();
    ledger.append(record());
    ledger.append(record({ requestId: "r-2", completedAt: 2000, status: "error" }));
    assert.equal(ledger.size(), 2);
    assert.equal(ledger.aggregate({}, "providerId")[0]?.requests, 2);
    assert.equal(ledger.quota({ windowMinutes: 60, maxRequests: 2 }, { environmentId: "e" }, 3000).allowed, false);
    const trace = new UsageTrace(ledger, () => 10);
    trace.start("t", "s", "route", { providerId: "openai" });
    trace.finish("s", { routeId: "a" });
    assert.equal(ledger.traces("t").length, 2);
});
test("cost calculation uses token dimensions and never needs a secret", () => {
    const cost = calculateUsageCost({ providerId: "openai", servedModel: "gpt-5", inputTokens: 1_000_000, outputTokens: 500_000, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, { providerId: "openai", modelPattern: "^gpt", inputPerMillion: 1, outputPerMillion: 2, currency: "USD" });
    assert.equal(cost, 2);
});
//# sourceMappingURL=ledger.test.js.map