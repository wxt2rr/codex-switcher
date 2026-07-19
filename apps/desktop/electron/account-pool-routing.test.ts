import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyPoolFailure,
  cooldownForFailure,
  derivePoolSessionKey,
  nextMemberHealth,
  normalizePoolMaxSameAccountFailures,
  selectPoolMember,
  type AccountPool,
  type PoolDispatchState,
  type PoolMemberHealthState,
} from "./account-pool-routing.js";

const pool: AccountPool = {
  poolId: "pool-1", envName: "work", protocol: "responses", enabled: true,
  strategy: "sticky_weighted_round_robin", sessionTtlMinutes: 60, maxFailoverAttempts: 1, maxSameAccountFailures: 1,
  createdAt: 1, updatedAt: 1,
  members: [
    { accountName: "a", routeId: "ra", protocol: "responses", upstreamBaseUrl: "https://a.example", originalBaseUrl: "https://a.example", enabled: true, weight: 1, priority: 0 },
    { accountName: "b", routeId: "rb", protocol: "responses", upstreamBaseUrl: "https://b.example", originalBaseUrl: "https://b.example", enabled: true, weight: 1, priority: 1 },
  ],
};
const health = (accountName: string): PoolMemberHealthState => ({
  poolId: "pool-1", accountName, state: "healthy", consecutiveFailures: 0,
  cooldownUntil: null, lastSuccessAt: null, lastFailureAt: null, lastFailureReason: null, lastFailureStatus: null, updatedAt: 1,
});

function state(overrides: Partial<PoolDispatchState> = {}): PoolDispatchState {
  return { pool, health: [health("a"), health("b")], bindings: [], cursor: 0, ...overrides };
}

test("derives explicit session and previous response keys without persisting raw values", () => {
  const explicit = derivePoolSessionKey({ headers: { "x-codex-session-id": "secret-session" } });
  assert.equal(explicit.source, "binding");
  assert.doesNotMatch(explicit.keyHash, /secret-session/);
  const response = derivePoolSessionKey({ body: { previous_response_id: "resp-123" } });
  assert.equal(response.source, "response_id");
  assert.equal(response.responseId, "resp-123");
});

test("keeps a healthy session on its bound member", () => {
  const key = derivePoolSessionKey({ headers: { "x-session-id": "one" } }).keyHash;
  const selected = selectPoolMember(state({ bindings: [{ poolId: "pool-1", sessionKeyHash: key, accountName: "b", responseIds: [], createdAt: 1, lastUsedAt: 2, expiresAt: Date.now() + 10_000 }] }), { headers: { "x-session-id": "one" } });
  assert.equal(selected?.member.accountName, "b");
  assert.equal(selected?.affinity, "binding");
});

test("uses the entry account before weighted round robin for a new session", () => {
  const selected = selectPoolMember(state(), { entryAccountName: "b" });
  assert.equal(selected?.member.accountName, "b");
  assert.equal(selected?.affinity, "entry_account");
});

test("skips cooldown members and returns no member when all are unavailable", () => {
  const now = Date.now();
  const cooling = { ...health("a"), state: "cooldown" as const, cooldownUntil: now + 60_000 };
  assert.equal(selectPoolMember(state({ health: [cooling, health("b")] }), {})?.member.accountName, "b");
  const unavailable = { ...cooling, accountName: "b" };
  assert.equal(selectPoolMember(state({ health: [cooling, unavailable] }), {}), null);
});

test("classifies retryable and non-retryable failures", () => {
  assert.equal(classifyPoolFailure(429), "rate_limit");
  assert.equal(classifyPoolFailure(422), "validation");
  assert.equal(classifyPoolFailure(null, new Error("socket closed")), "transport");
});

test("normalizes same-account failure thresholds to the supported range", () => {
  assert.equal(normalizePoolMaxSameAccountFailures(undefined), 1);
  assert.equal(normalizePoolMaxSameAccountFailures(2), 2);
  assert.equal(normalizePoolMaxSameAccountFailures(0), 1);
  assert.equal(normalizePoolMaxSameAccountFailures(99), 3);
});

test("applies cooldown and recovers a successful member", () => {
  const now = Date.now();
  const failed = nextMemberHealth(health("a"), { ok: false, status: 429 }, now);
  assert.equal(failed.state, "cooldown");
  assert.equal(failed.cooldownUntil, cooldownForFailure(1, undefined, now));
  const recovered = nextMemberHealth(failed, { ok: true }, now + 1);
  assert.equal(recovered.state, "healthy");
  assert.equal(recovered.consecutiveFailures, 0);
});
