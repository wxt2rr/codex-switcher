import { createHash } from "node:crypto";

export interface RouteTarget {
  routeId: string;
  envName: string;
  accountName: string;
  upstreamBaseUrl: string;
  originalBaseUrl: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ExtractedTokenUsage {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
  totalTokens: number | null;
}

export interface UsageRequest extends ExtractedTokenUsage {
  requestId: string;
  routeId: string;
  startedAt: number;
  completedAt: number;
  envName: string;
  accountName: string;
  upstreamBaseUrl: string;
  endpoint: string;
  httpStatus: number;
  latencyMs: number;
  actualCost: number | null;
  standardCost: number | null;
}

export interface UsageFilter {
  from: number;
  to: number;
  envName?: string;
  accountName?: string;
  baseUrl?: string;
  model?: string;
}

export interface UsageSummary {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  actualCost: number | null;
  standardCost: number | null;
  requestsWithoutUsage: number;
  cacheHitRate: number | null;
}

export interface UsageDimensionAggregate {
  key: string;
  model?: string;
  baseUrl?: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  actualCost: number | null;
  standardCost: number | null;
}

export interface UsageTrendPoint extends UsageSummary {
  bucket: number;
}

export interface UsageSnapshot {
  generatedAt: number;
  summary: UsageSummary;
  models: UsageDimensionAggregate[];
  baseUrls: UsageDimensionAggregate[];
  trend: UsageTrendPoint[];
}

export interface PricingProfile {
  kind: "actual" | "standard";
  baseUrl: string;
  modelPattern: string;
  inputPerMillion: number;
  outputPerMillion: number;
  cacheCreationPerMillion: number | null;
  cacheReadPerMillion: number | null;
  updatedAt: number;
}

export function normalizeUpstreamBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    parsed.search = "";
    const pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.pathname = pathname || "/";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

export function createRouteId(envName: string, accountName: string, upstreamBaseUrl: string): string {
  return createHash("sha256")
    .update(`${envName}\0${accountName}\0${normalizeUpstreamBaseUrl(upstreamBaseUrl)}`)
    .digest("hex")
    .slice(0, 20);
}

export function buildLocalRouteBaseUrl(port: number, routeId: string): string {
  return `http://127.0.0.1:${port}/routes/${encodeURIComponent(routeId)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function extractTokenUsage(payload: unknown): ExtractedTokenUsage | null {
  const root = asRecord(payload);
  if (!root) return null;
  const response = asRecord(root.response);
  const container = response ?? root;
  const usage = asRecord(container.usage) ?? asRecord(root.usage);
  if (!usage) return null;

  const inputDetails =
    asRecord(usage.input_tokens_details) ?? asRecord(usage.prompt_tokens_details) ?? {};
  const inputTokens = finiteNumber(usage.input_tokens) ?? finiteNumber(usage.prompt_tokens);
  const outputTokens = finiteNumber(usage.output_tokens) ?? finiteNumber(usage.completion_tokens);
  const totalTokens =
    finiteNumber(usage.total_tokens) ??
    (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);

  return {
    model:
      (typeof container.model === "string" ? container.model : null) ??
      (typeof root.model === "string" ? root.model : null),
    inputTokens,
    outputTokens,
    cacheCreationTokens:
      finiteNumber(inputDetails.cache_creation_tokens) ??
      finiteNumber(usage.cache_creation_input_tokens) ??
      0,
    cacheReadTokens:
      finiteNumber(inputDetails.cached_tokens) ?? finiteNumber(usage.cache_read_input_tokens) ?? 0,
    totalTokens,
  };
}
