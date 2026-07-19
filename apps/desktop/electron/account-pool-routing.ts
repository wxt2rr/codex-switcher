import { createHash } from "node:crypto";

import type { RouteProtocol } from "./usage-routing-model.js";

export type PoolMemberHealth = "healthy" | "degraded" | "cooldown" | "exhausted" | "unauthorized" | "disabled";
export type PoolStrategy = "sticky_weighted_round_robin";
export type PoolFailureReason =
  | "transport"
  | "timeout"
  | "rate_limit"
  | "quota"
  | "unauthorized"
  | "upstream_5xx"
  | "upstream_4xx"
  | "validation"
  | "stream_interrupted"
  | "no_available_member";

export interface AccountPoolMember {
  accountName: string;
  routeId: string;
  protocol: RouteProtocol;
  upstreamBaseUrl: string;
  originalBaseUrl: string;
  upstreamModel?: string;
  enabled: boolean;
  weight: number;
  priority: number;
}

export interface AccountPool {
  poolId: string;
  envName: string;
  protocol: RouteProtocol;
  enabled: boolean;
  strategy: PoolStrategy;
  sessionTtlMinutes: number;
  maxFailoverAttempts: number;
  maxSameAccountFailures: number;
  createdAt: number;
  updatedAt: number;
  members: AccountPoolMember[];
}

export interface PoolMemberHealthState {
  poolId: string;
  accountName: string;
  state: PoolMemberHealth;
  consecutiveFailures: number;
  cooldownUntil: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureReason: PoolFailureReason | null;
  lastFailureStatus: number | null;
  updatedAt: number;
}

export interface PoolSessionBinding {
  poolId: string;
  sessionKeyHash: string;
  accountName: string;
  responseIds: string[];
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
}

export interface PoolDispatchCandidate extends AccountPoolMember {
  health?: PoolMemberHealthState;
}

export interface PoolDispatchState {
  pool: AccountPool;
  health: PoolMemberHealthState[];
  bindings: PoolSessionBinding[];
  cursor: number;
}

export interface PoolSelection {
  member: AccountPoolMember;
  sessionKeyHash: string;
  affinity: "binding" | "response_id" | "request_hash" | "entry_account" | "weighted_round_robin";
}

const DEFAULT_SESSION_TTL_MINUTES = 24 * 60;
const MAX_SESSION_CONTENT_BYTES = 8 * 1024;

export function normalizePoolSessionTtl(value: unknown): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : DEFAULT_SESSION_TTL_MINUTES;
  return Math.min(7 * 24 * 60, Math.max(5, numeric));
}

export function normalizePoolMaxFailoverAttempts(value: unknown): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 1;
  return Math.min(1, Math.max(0, numeric));
}

export function normalizePoolMaxSameAccountFailures(value: unknown): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 1;
  return Math.min(3, Math.max(1, numeric));
}

export function normalizePoolWeight(value: unknown): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 1;
  return Math.min(100, Math.max(1, numeric));
}

export function hashPoolSessionKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export function createAccountPoolId(envName: string): string {
  return createHash("sha256").update(`pool\0${envName}`).digest("hex").slice(0, 20);
}

export function buildLocalPoolBaseUrl(port: number, poolId: string): string {
  return `http://127.0.0.1:${port}/pools/${encodeURIComponent(poolId)}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function bounded(value: string): string {
  return value.length > MAX_SESSION_CONTENT_BYTES ? value.slice(0, MAX_SESSION_CONTENT_BYTES) : value;
}

function headerValue(headers: Headers | Record<string, string | string[] | undefined> | undefined, names: string[]): string | undefined {
  if (!headers) return undefined;
  for (const name of names) {
    if (headers instanceof Headers) {
      const value = headers.get(name);
      if (value?.trim()) return value.trim();
      continue;
    }
    const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
    const value = match?.[1];
    const text = Array.isArray(value) ? value[0] : value;
    if (text?.trim()) return text.trim();
  }
  return undefined;
}

export interface PoolSessionKeyInput {
  headers?: Headers | Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
  model?: string;
  endpoint?: string;
  entryAccountName?: string;
}

export function derivePoolSessionKey(input: PoolSessionKeyInput): {
  keyHash: string;
  source: PoolSelection["affinity"];
  responseId?: string;
} {
  const explicit = headerValue(input.headers, ["x-codex-session-id", "x-session-id", "session_id", "conversation_id"])
    ?? (typeof input.body?.session_id === "string" ? input.body.session_id : undefined)
    ?? (typeof input.body?.conversation_id === "string" ? input.body.conversation_id : undefined);
  if (explicit) return { keyHash: hashPoolSessionKey(`explicit:${explicit}`), source: "binding" };

  const previousResponseId = typeof input.body?.previous_response_id === "string"
    ? input.body.previous_response_id.trim() : undefined;
  if (previousResponseId) return {
    keyHash: hashPoolSessionKey(`response:${previousResponseId}`),
    source: "response_id",
    responseId: previousResponseId,
  };

  if (input.entryAccountName) return {
    keyHash: hashPoolSessionKey(`entry:${input.entryAccountName}`),
    source: "entry_account",
  };

  const body = input.body ?? {};
  const content = "input" in body ? body.input : "messages" in body ? body.messages : body.prompt;
  if (content !== undefined) return {
    keyHash: hashPoolSessionKey(`request:${input.endpoint ?? ""}:${input.model ?? body.model ?? ""}:${bounded(stableJson(content))}`),
    source: "request_hash",
  };

  return { keyHash: hashPoolSessionKey(`anonymous:${input.endpoint ?? ""}:${input.model ?? ""}`), source: "request_hash" };
}

export function isMemberEligible(member: PoolDispatchCandidate, now = Date.now()): boolean {
  if (!member.enabled || !member.health) return member.enabled;
  if (["disabled", "unauthorized", "exhausted"].includes(member.health.state)) return false;
  if (member.health.state === "cooldown" && (member.health.cooldownUntil ?? 0) > now) return false;
  return true;
}

export function recoverMemberIfDue(state: PoolMemberHealthState, now = Date.now()): PoolMemberHealthState {
  if (state.state === "cooldown" && (state.cooldownUntil ?? 0) <= now) {
    return { ...state, state: "degraded", cooldownUntil: null, updatedAt: now };
  }
  return state;
}

export function selectPoolMember(
  state: PoolDispatchState,
  input: PoolSessionKeyInput,
  now = Date.now(),
): PoolSelection | null {
  const derived = derivePoolSessionKey(input);
  const healthByAccount = new Map(state.health.map((item) => [item.accountName, recoverMemberIfDue(item, now)]));
  const candidates = state.pool.members
    .map((member) => ({ ...member, health: healthByAccount.get(member.accountName) }))
    .filter((member) => isMemberEligible(member, now));
  if (!candidates.length) return null;

  if (derived.responseId) {
    const responseBinding = state.bindings
      .filter((item) => item.poolId === state.pool.poolId && item.expiresAt > now && item.responseIds.includes(derived.responseId!))
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
    const member = responseBinding && candidates.find((item) => item.accountName === responseBinding.accountName);
    if (member && responseBinding) return { member, sessionKeyHash: responseBinding.sessionKeyHash, affinity: "response_id" };
  }

  const binding = state.bindings
    .filter((item) => item.poolId === state.pool.poolId && item.sessionKeyHash === derived.keyHash && item.expiresAt > now)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
  if (binding) {
    const member = candidates.find((item) => item.accountName === binding.accountName);
    if (member) return { member, sessionKeyHash: derived.keyHash, affinity: derived.source === "response_id" ? "response_id" : "binding" };
  }

  if (input.entryAccountName) {
    const entry = candidates.find((item) => item.accountName === input.entryAccountName);
    if (entry) return { member: entry, sessionKeyHash: derived.keyHash, affinity: "entry_account" };
  }

  const totalWeight = candidates.reduce((sum, item) => sum + normalizePoolWeight(item.weight), 0);
  const offset = ((state.cursor % totalWeight) + totalWeight) % totalWeight;
  let remaining = offset;
  for (const member of candidates) {
    remaining -= normalizePoolWeight(member.weight);
    if (remaining < 0) return { member, sessionKeyHash: derived.keyHash, affinity: "weighted_round_robin" };
  }
  return { member: candidates[candidates.length - 1], sessionKeyHash: derived.keyHash, affinity: "weighted_round_robin" };
}

export function classifyPoolFailure(status: number | null, error?: unknown): PoolFailureReason {
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  if (error instanceof Error && /timeout/i.test(error.message)) return "timeout";
  if (error) return "transport";
  if (status === 401) return "unauthorized";
  if (status === 403) return "quota";
  if (status === 408 || status === 425) return "timeout";
  if (status === 429) return "rate_limit";
  if (status !== null && status >= 500) return "upstream_5xx";
  if (status !== null && status >= 400) return status === 400 || status === 422 ? "validation" : "upstream_4xx";
  return "transport";
}

export function isPoolRetryableFailure(reason: PoolFailureReason, status: number | null): boolean {
  if (reason === "transport" || reason === "timeout" || reason === "rate_limit" || reason === "quota" || reason === "upstream_5xx") return true;
  return status === 401 || status === 403 || status === 408 || status === 425 || (status !== null && status >= 500);
}

export function cooldownForFailure(failures: number, retryAfterMs?: number, now = Date.now()): number {
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs > 0) return now + Math.min(24 * 60 * 60 * 1000, retryAfterMs);
  const steps = [30_000, 2 * 60_000, 10 * 60_000];
  return now + steps[Math.min(steps.length - 1, Math.max(0, failures - 1))];
}

export function nextMemberHealth(
  previous: PoolMemberHealthState,
  outcome: { ok: boolean; status?: number | null; reason?: PoolFailureReason; retryAfterMs?: number },
  now = Date.now(),
): PoolMemberHealthState {
  if (outcome.ok) return {
    ...previous, state: "healthy", consecutiveFailures: 0, cooldownUntil: null,
    lastSuccessAt: now, updatedAt: now,
  };
  const reason = outcome.reason ?? classifyPoolFailure(outcome.status ?? null);
  const failures = previous.consecutiveFailures + 1;
  if (reason === "unauthorized") return { ...previous, state: "unauthorized", consecutiveFailures: failures, cooldownUntil: null, lastFailureAt: now, lastFailureReason: reason, lastFailureStatus: outcome.status ?? null, updatedAt: now };
  return {
    ...previous, state: "cooldown", consecutiveFailures: failures,
    cooldownUntil: cooldownForFailure(failures, outcome.retryAfterMs, now),
    lastFailureAt: now, lastFailureReason: reason, lastFailureStatus: outcome.status ?? null, updatedAt: now,
  };
}
