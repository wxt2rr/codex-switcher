import { createHash, timingSafeEqual } from "node:crypto";

export type RouteProtocol = "responses" | "chat_completions";
export type ReasoningProfile = "auto" | "standard" | "reasoning_content" | "think_tags";
export type LongConversationStrategy = "safe" | "continuity";
export type CompatibilityInstructionRole = "auto" | "system" | "developer";

export interface RouteTarget {
  routeId: string;
  envName: string;
  accountName: string;
  upstreamBaseUrl: string;
  originalBaseUrl: string;
  protocol: RouteProtocol;
  upstreamModel?: string;
  reasoningProfile: ReasoningProfile;
  longConversationStrategy?: LongConversationStrategy;
  instructionRole?: CompatibilityInstructionRole;
  requestOverrides?: Record<string, unknown>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface RouteRuntimeSecret {
  routeId: string;
  upstreamApiKey: string;
  localRouteToken: string;
  hydratedAt: number;
}

export function authorizeRouteToken(header: string | undefined, expected: string): boolean {
  const actual = header?.replace(/^Bearer\s+/i, "") ?? "";
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface ExtractedTokenUsage {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
  totalTokens: number | null;
}

export interface UsageRequestAttempt {
  accountName: string;
  startedAt: number;
  completedAt: number;
  httpStatus: number | null;
  reason: string | null;
  errorMessage: string | null;
  outcome: "success" | "retry" | "returned" | "failed";
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
  poolId?: string | null;
  entryAccountName?: string | null;
  attemptedAccounts?: string[];
  attemptCount?: number;
  failoverReason?: string | null;
  sessionKeyHash?: string | null;
  errorMessage?: string | null;
  attempts?: UsageRequestAttempt[];
}

export interface UsageFilter {
  from: number;
  to: number;
  envName?: string;
  accountName?: string;
  baseUrl?: string;
  model?: string;
}

export interface UsageRequestQuery extends UsageFilter {
  page: number;
  pageSize: number;
  endpoint?: string;
  status?: "success" | "error";
  poolId?: string;
  failoverReason?: string;
  search?: string;
}

export interface UsageRequestFacets {
  envNames: string[];
  accountNames: string[];
  models: string[];
  endpoints: string[];
  poolIds: string[];
  failoverReasons: string[];
}

export interface UsageRequestPage {
  generatedAt: number;
  items: UsageRequest[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  facets: UsageRequestFacets;
}

export interface AccountRequestHealthSegment {
  completedAt: number;
  success: boolean;
  cacheHit: boolean | null;
}

export interface AccountRequestHealth {
  envName: string;
  accountName: string;
  sampleSize: number;
  successRate: number | null;
  cacheHitRate: number | null;
  segments: AccountRequestHealthSegment[];
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

export function isLocalRouterBaseUrl(value: string | undefined): boolean {
  return /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/(?:routes|pools)\//i.test(value?.trim() ?? "");
}

export function selectCompatibilityUpstreamBaseUrl(
  routes: RouteTarget[],
  envName: string,
  accountName: string,
  runtimeBaseUrl: string,
): string {
  const accountRoutes = routes.filter((route) => route.envName === envName && route.accountName === accountName);
  const route = accountRoutes.find((candidate) => candidate.protocol === "chat_completions") ?? accountRoutes[0];
  return route ? resolveRouteDisplayBaseUrl(route) : runtimeBaseUrl;
}

export function resolveRouteDisplayBaseUrl(route: Pick<RouteTarget, "originalBaseUrl" | "upstreamBaseUrl">): string {
  const original = route.originalBaseUrl.trim();
  return isLocalRouterBaseUrl(original)
    ? route.upstreamBaseUrl
    : original || route.upstreamBaseUrl;
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
