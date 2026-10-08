import { createHash, timingSafeEqual } from "node:crypto";

export type RouteProtocol = "responses" | "chat_completions" | "anthropic" | "gemini";
export type ReasoningProfile = "auto" | "standard" | "reasoning_content" | "think_tags";
export type LongConversationStrategy = "safe" | "continuity";
export type CompatibilityInstructionRole = "auto" | "system" | "developer";
export interface RouteCapabilities {
  reasoning?: boolean;
  tools?: boolean;
  vision?: boolean;
  streaming?: boolean;
}

export interface RouteTarget {
  routeId: string;
  envName: string;
  accountName: string;
  upstreamBaseUrl: string;
  originalBaseUrl: string;
  protocol: RouteProtocol;
  providerId?: string;
  exposedModelId?: string;
  routeGroupId?: string;
  upstreamModel?: string;
  capabilities?: RouteCapabilities;
  reasoningProfile: ReasoningProfile;
  longConversationStrategy?: LongConversationStrategy;
  instructionRole?: CompatibilityInstructionRole;
  requestOverrides?: Record<string, unknown>;
  /** Non-secret configured headers; auth and hop-by-hop headers are always controlled by the router. */
  requestHeaders?: Record<string, string>;
  /** Explicit HTTP(S)/SOCKS5 proxy endpoint for this route; credentials are never embedded. */
  proxyUrl?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface GatewayRequestContext {
  gatewayId: string;
  envName: string;
  protocol: RouteProtocol;
  /** Allow the Gateway ingress protocol to be converted to the selected upstream protocol. */
  allowProtocolConversion?: boolean;
  /** Privacy-safe, in-memory runtime signals used by usage/pace/smart selection. */
  routeMetrics?: Readonly<Record<string, GatewayRouteRuntimeMetrics>>;
  routeRules?: GatewayRouteRule[];
  ruleContext?: GatewayRouteRuleContext;
  requestedModel?: string;
  requestedAccountName?: string;
  sessionKey?: string;
  requiredCapabilities?: RouteCapabilities;
}

export interface GatewayRouteRuleContext {
  tokenCount?: number;
  hasImages?: boolean;
  reasoning?: boolean;
  reasoningProfile?: string;
  agentId?: string;
  contextCompacted?: boolean;
  now?: number;
  requestedModel?: string;
  providerId?: string;
}

export interface GatewayRouteRuntimeMetrics {
  requestsInWindow?: number;
  tokensInWindow?: number;
  latencyMs?: number;
  quotaRemaining?: number;
  resetAt?: number;
}

/** Explicit request metadata only; never contains prompt or intent fields. */
export interface GatewayRouteRule {
  id: string;
  targetModelId: string;
  priority: number;
  enabled: boolean;
  match: {
    tokenCount?: { min?: number; max?: number };
    hasImages?: boolean;
    reasoning?: boolean;
    reasoningProfiles?: string[];
    agentIds?: string[];
    contextCompacted?: boolean;
    time?: { startHour: number; endHour: number; daysOfWeek?: number[]; timezone?: "local" | "utc" };
    modelIds?: string[];
    providerIds?: string[];
  };
}

export interface EnvironmentGateway {
  gatewayId: string;
  envName: string;
  routeIds: string[];
  routeGroups?: Record<string, EnvironmentGatewayRouteGroup>;
  routeRules?: GatewayRouteRule[];
  defaultRouteId?: string;
  poolId?: string;
  quota?: GatewayQuotaPolicy;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface GatewayQuotaPolicy {
  windowMinutes: number;
  maxRequests?: number;
  maxTokens?: number;
}

export interface GatewayRouteHealth {
  routeId: string;
  state: "healthy" | "cooldown";
  consecutiveFailures: number;
  cooldownUntil: number | null;
}

export interface EnvironmentGatewayRouteGroup {
  id: string;
  exposedModelId: string;
  routeIds: string[];
  nestedGroupIds?: string[];
  strategy: "smart" | "order" | "rotate" | "usage" | "pace" | "weight" | "weighted_round_robin";
  sessionPolicy: "auto" | "session" | "turn" | "off";
  fallbackEnabled: boolean;
  weights?: Record<string, number>;
  capabilities?: RouteCapabilities;
}

export interface RouteRuntimeSecret {
  routeId: string;
  upstreamApiKey: string;
  localRouteToken: string;
  authMode?: "auth" | "apikey";
  accountId?: string;
  hydratedAt: number;
}

export function authorizeRouteToken(header: string | undefined, expected: string): boolean {
  const actual = header?.replace(/^Bearer\s+/i, "") ?? "";
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isSafeRouteProxyUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return (["http:", "https:", "socks5:"].includes(parsed.protocol))
      && !parsed.username && !parsed.password && Boolean(parsed.hostname)
      && (!parsed.port || Number(parsed.port) > 0 && Number(parsed.port) <= 65535);
  } catch {
    return false;
  }
}

export interface ExtractedTokenUsage {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens?: number | null;
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
  retryAfterMs?: number | null;
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
  /** The model requested at ingress, before any explicit route/model rewrite. */
  logicalModel?: string | null;
  /** The model reported by or sent to the selected upstream. */
  servedModel?: string | null;
  providerId?: string | null;
  credentialId?: string | null;
  agentId?: string | null;
  ingressProtocol?: RouteProtocol | null;
  upstreamProtocol?: RouteProtocol | null;
  routeGroupId?: string | null;
  /** ID of an explicit metadata rule; never derived from prompt contents. */
  routeRuleId?: string | null;
  timeToFirstTokenMs?: number | null;
  retryAfterMs?: number | null;
  finalCandidate?: string | null;
  failureType?: string | null;
  priceTier?: string | null;
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

export interface UsageTraceEvent {
  event: string;
  at: number;
  envName?: string;
  gatewayId?: string;
  requestedModel?: string | null;
  protocol?: RouteProtocol;
  routeId?: string;
  routeGroupId?: string | null;
  accountName?: string;
  providerId?: string | null;
  reason?: string;
  [key: string]: unknown;
}

export interface UsageTraceQuery {
  from?: number;
  to?: number;
  envName?: string;
  gatewayId?: string;
  routeId?: string;
  event?: string;
  limit?: number;
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
  reasoningTokens?: number;
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
  reasoningTokens?: number;
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
  reasoningPerMillion?: number | null;
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

export function createEnvironmentGatewayId(envName: string): string {
  return createHash("sha256").update(`gateway\0${envName}`).digest("hex").slice(0, 20);
}

export function buildLocalRouteBaseUrl(port: number, routeId: string): string {
  return `http://127.0.0.1:${port}/routes/${encodeURIComponent(routeId)}`;
}

export function buildLocalGatewayBaseUrl(port: number, gatewayId: string): string {
  return `http://127.0.0.1:${port}/gateways/${encodeURIComponent(gatewayId)}`;
}

export function isLocalRouterBaseUrl(value: string | undefined): boolean {
  return /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/(?:routes|pools|gateways)\//i.test(value?.trim() ?? "");
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
  const usage = asRecord(container.usage) ?? asRecord(root.usage) ?? asRecord(container.usageMetadata) ?? asRecord(root.usageMetadata);
  if (!usage) return null;

  const inputDetails =
    asRecord(usage.input_tokens_details) ?? asRecord(usage.prompt_tokens_details) ?? {};
  const outputDetails =
    asRecord(usage.output_tokens_details) ?? asRecord(usage.completion_tokens_details) ?? {};
  const inputTokens = finiteNumber(usage.input_tokens) ?? finiteNumber(usage.prompt_tokens) ?? finiteNumber(usage.promptTokenCount);
  const outputTokens = finiteNumber(usage.output_tokens) ?? finiteNumber(usage.completion_tokens) ?? finiteNumber(usage.candidatesTokenCount);
  const reasoningTokens = finiteNumber(usage.reasoning_tokens)
    ?? finiteNumber(usage.thinking_tokens)
    ?? finiteNumber(usage.thoughtsTokenCount)
    ?? finiteNumber(outputDetails.reasoning_tokens)
    ?? finiteNumber(outputDetails.thinking_tokens);
  const totalTokens =
    finiteNumber(usage.total_tokens) ??
    finiteNumber(usage.totalTokenCount) ??
    (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens + (reasoningTokens ?? 0) : null);

  return {
    model:
      (typeof container.model === "string" ? container.model : null) ??
      (typeof container.modelVersion === "string" ? container.modelVersion : null) ??
      (typeof root.model === "string" ? root.model : null),
    inputTokens,
    outputTokens,
    ...(reasoningTokens !== null ? { reasoningTokens } : {}),
    cacheCreationTokens:
      finiteNumber(inputDetails.cache_creation_tokens) ??
      finiteNumber(usage.cache_creation_input_tokens) ??
      0,
    cacheReadTokens:
      finiteNumber(inputDetails.cached_tokens) ?? finiteNumber(usage.cache_read_input_tokens) ?? 0,
    totalTokens,
  };
}
