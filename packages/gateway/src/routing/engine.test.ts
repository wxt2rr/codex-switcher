import assert from "node:assert/strict";
import test from "node:test";
import { classifyRouteFailure, resolveRoute, RouteResolveError, type RuntimeRouteCandidate } from "./engine.js";

const candidates: RuntimeRouteCandidate[] = [
  { id: "a", providerId: "openai", credentialId: "a", modelId: "gpt", protocol: "responses", capabilities: ["tools", "reasoning", "streaming"], priority: 1, weight: 1, healthy: true, requestsInWindow: 5, quotaRemaining: 10 },
  { id: "b", providerId: "anthropic", credentialId: "b", modelId: "claude", protocol: "anthropic", capabilities: ["tools", "reasoning", "streaming"], priority: 2, weight: 2, healthy: true, requestsInWindow: 1, quotaRemaining: 100 },
];

test("route engine resolves nested groups, capability requirements and session affinity", () => {
  const groups = {
    mixed: { id: "mixed", displayName: "Mixed", exposedModelId: "smart-model", members: ["group/inner"], strategy: "smart" as const, affinity: "session" as const, fallbackEnabled: true, priority: 0 },
    inner: { id: "inner", displayName: "Inner", exposedModelId: "inner", members: ["a"], strategy: "order" as const, affinity: "off" as const, fallbackEnabled: true, priority: 0 },
  };
  const first = resolveRoute(candidates, groups, { requestedModel: "smart-model", protocol: "responses", requiredCapabilities: { tools: true }, sessionKey: "s1", now: 1000 });
  const second = resolveRoute(candidates, groups, { requestedModel: "smart-model", protocol: "responses", requiredCapabilities: { tools: true }, sessionKey: "s1", state: first.state, now: 2000 });
  assert.equal(first.route.providerId, "openai");
  assert.equal(second.route.providerId, "openai");
  assert.equal(first.groupId, "mixed");
});

test("route engine rejects cycles and depth overflow", () => {
  assert.throws(() => resolveRoute(candidates, { a: { id: "a", displayName: "a", exposedModelId: "a", members: ["b"], strategy: "order", affinity: "off", fallbackEnabled: true, priority: 0 }, b: { id: "b", displayName: "b", exposedModelId: "b", members: ["a"], strategy: "order", affinity: "off", fallbackEnabled: true, priority: 0 } }, { requestedModel: "a", protocol: "responses" }), (error: unknown) => error instanceof RouteResolveError && error.code === "CYCLE");
});

test("failure classes keep retryable and non-retryable failures distinct", () => {
  assert.equal(classifyRouteFailure(429), "rate_limit");
  assert.equal(classifyRouteFailure(401), "unauthorized");
  assert.equal(classifyRouteFailure(503), "upstream_5xx");
  assert.equal(classifyRouteFailure(null, new Error("timeout")), "timeout");
});

test("route groups expose deterministic pre-first-byte fallback chains for every strategy", () => {
  const pool: RuntimeRouteCandidate[] = [
    { id: "a", providerId: "openai", credentialId: "a", modelId: "gpt", protocol: "responses", capabilities: ["tools", "streaming"], priority: 0, weight: 1, healthy: true, requestsInWindow: 5, quotaRemaining: 10, resetAt: 10_000 },
    { id: "b", providerId: "anthropic", credentialId: "b", modelId: "claude", protocol: "anthropic", capabilities: ["tools", "streaming"], priority: 1, weight: 2, healthy: true, requestsInWindow: 1, quotaRemaining: 100, resetAt: 20_000 },
    { id: "c", providerId: "gemini", credentialId: "c", modelId: "gemini", protocol: "gemini", capabilities: ["tools", "streaming"], priority: 2, weight: 1, healthy: true, requestsInWindow: 2, quotaRemaining: 40, resetAt: 15_000 },
  ];
  for (const strategy of ["smart", "order", "rotate", "usage", "pace", "weight", "weighted_round_robin"] as const) {
    const resolved = resolveRoute(pool, {
      group: { id: "group", displayName: "Group", exposedModelId: "logical", members: ["a", "b", "c"], strategy, affinity: "off", fallbackEnabled: true, priority: 0 },
    }, { requestedModel: "logical", protocol: "responses", allowProtocolConversion: true, sessionKey: "session", now: 1_000 });
    assert.equal(resolved.fallbackRoutes.length, 2, strategy);
    assert.equal(new Set(resolved.fallbackRoutes.map((route) => route.credentialId)).size, 2, strategy);
    assert.ok(resolved.fallbackRoutes.every((route) => route.decisionTrace.some((trace) => trace.stage === "fallback")), strategy);
  }
  const noFallback = resolveRoute(pool, {
    group: { id: "group", displayName: "Group", exposedModelId: "logical", members: ["a", "b"], strategy: "order", affinity: "off", fallbackEnabled: false, priority: 0 },
  }, { requestedModel: "logical", protocol: "responses", allowProtocolConversion: true });
  assert.equal(noFallback.fallbackRoutes.length, 0);
});

test("pace strategy uses live request and token pressure when quota metadata is absent", () => {
  const resolved = resolveRoute([
    { id: "busy", providerId: "openai", credentialId: "busy", modelId: "gpt", protocol: "responses", capabilities: [], priority: 0, weight: 1, healthy: true, requestsInWindow: 8, tokensInWindow: 8_000, latencyMs: 80 },
    { id: "idle", providerId: "anthropic", credentialId: "idle", modelId: "claude", protocol: "anthropic", capabilities: [], priority: 1, weight: 1, healthy: true, requestsInWindow: 1, tokensInWindow: 100, latencyMs: 20 },
  ], {
    group: { id: "group", displayName: "Group", exposedModelId: "logical", members: ["busy", "idle"], strategy: "pace", affinity: "off", fallbackEnabled: true, priority: 0 },
  }, { requestedModel: "logical", protocol: "responses", allowProtocolConversion: true, now: 1_000 });
  assert.equal(resolved.route.credentialId, "idle");
});

test("explicit route rules select a model group from request metadata without reading prompt text", () => {
  const resolved = resolveRoute([
    { id: "default", providerId: "openai", credentialId: "default", modelId: "default-upstream", protocol: "responses", capabilities: [], priority: 0, weight: 1, healthy: true },
    { id: "vision-route", providerId: "anthropic", credentialId: "vision", modelId: "vision-upstream", protocol: "anthropic", capabilities: ["vision"], priority: 0, weight: 1, healthy: true },
  ], {
    default: { id: "default", displayName: "Default", exposedModelId: "default-model", members: ["default"], strategy: "order", affinity: "off", fallbackEnabled: true, priority: 0 },
    vision: { id: "vision", displayName: "Vision", exposedModelId: "vision-model", members: ["vision-route"], strategy: "order", affinity: "off", fallbackEnabled: true, priority: 0 },
  }, {
    protocol: "responses",
    allowProtocolConversion: true,
    rules: [{
      id: "vision-rule", targetModelId: "vision-model", priority: 0, enabled: true,
      match: {
        tokenCount: { min: 10, max: 1_000 }, hasImages: true, reasoning: true, reasoningProfiles: ["high"],
        agentIds: ["codex"], contextCompacted: false, modelIds: ["explicit-model"], providerIds: ["anthropic"],
        time: { startHour: 12, endHour: 14, daysOfWeek: [1], timezone: "utc" },
      },
    }],
    ruleContext: {
      tokenCount: 100, hasImages: true, reasoning: true, reasoningProfile: "high", agentId: "codex",
      contextCompacted: false, requestedModel: "explicit-model", providerId: "anthropic", now: Date.UTC(2026, 0, 5, 13),
    },
  });
  assert.equal(resolved.route.credentialId, "vision");
  assert.ok(resolved.traces.some((trace) => trace.reason.includes("vision-rule")));
});

test("model-name route rules can map an explicit request model without enabling broad overrides", () => {
  const groups = {
    default: { id: "default", displayName: "Default", exposedModelId: "default", members: ["default-route"], strategy: "order" as const, affinity: "off" as const, fallbackEnabled: true, priority: 0 },
    routed: { id: "routed", displayName: "Routed", exposedModelId: "routed", members: ["routed-route"], strategy: "order" as const, affinity: "off" as const, fallbackEnabled: true, priority: 0 },
  };
  const rules = [
    { id: "broad", targetModelId: "routed", priority: 0, enabled: true, match: { hasImages: true } },
    { id: "named", targetModelId: "routed", priority: 1, enabled: true, match: { modelIds: ["requested-model"] } },
  ];

  const named = resolveRoute([
    { id: "default-route", providerId: "openai", credentialId: "default", modelId: "default-upstream", protocol: "responses", capabilities: [], priority: 0, weight: 1, healthy: true },
    { id: "routed-route", providerId: "anthropic", credentialId: "routed", modelId: "routed-upstream", protocol: "anthropic", capabilities: [], priority: 0, weight: 1, healthy: true },
  ], groups, {
    requestedModel: "requested-model",
    protocol: "responses",
    allowProtocolConversion: true,
    rules,
    ruleContext: { hasImages: true },
  });
  assert.equal(named.route.credentialId, "routed");
  assert.ok(named.traces.some((trace) => trace.reason.includes("named")));

  const broadOnly = resolveRoute([
    { id: "default-route", providerId: "openai", credentialId: "default", modelId: "default", protocol: "responses", capabilities: [], priority: 0, weight: 1, healthy: true },
    { id: "other", providerId: "anthropic", credentialId: "other", modelId: "other", protocol: "anthropic", capabilities: [], priority: 0, weight: 1, healthy: true },
  ], {
    default: groups.default,
    other: { ...groups.routed, id: "other", exposedModelId: "other", members: ["other"] },
  }, {
    requestedModel: "default",
    protocol: "responses",
    allowProtocolConversion: true,
    rules: [rules[0]!],
    ruleContext: { hasImages: true },
  });
  assert.equal(broadOnly.route.credentialId, "default");
  assert.ok(!broadOnly.traces.some((trace) => trace.reason.includes("broad")));
});
