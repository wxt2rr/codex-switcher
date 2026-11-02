import { setTimeout as delay } from "node:timers/promises";

import { fetchWithOptionalProxy } from "./upstream-proxy.js";
import {
  resetCardType,
  safeCardId,
  type CodexSubscriptionAccount,
  type StoredResetCard,
  type StoredUsageWindow,
} from "./codex-reset-card-utils.js";

export type CodexSubscriptionErrorKind = "unauthorized" | "unsupported" | "rate-limited" | "network" | "api" | "parse";

export class CodexSubscriptionError extends Error {
  readonly kind: CodexSubscriptionErrorKind;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(kind: CodexSubscriptionErrorKind, message: string, options: { status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = "CodexSubscriptionError";
    this.kind = kind;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export interface CodexSubscriptionReadResult {
  accountId?: string;
  workspaceId?: string;
  plan?: string;
  usageWindows: StoredUsageWindow[];
  cards: StoredResetCard[];
  observedAt: number;
}

interface FetchResponseLike {
  status: number;
  headers: Headers;
  json(): Promise<unknown>;
}

type FetchLike = typeof fetch;

export interface CodexSubscriptionClientOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  fetchWithProxyImpl?: typeof fetchWithOptionalProxy;
  timeoutMs?: number;
  userAgent?: string;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_BASE_URL = "https://chatgpt.com/backend-api";
const DEFAULT_USER_AGENT = "codex-switcher/desktop subscription-quota";

export class CodexSubscriptionClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly fetchWithProxyImpl: typeof fetchWithOptionalProxy;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: CodexSubscriptionClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.fetchWithProxyImpl = options.fetchWithProxyImpl ?? fetchWithOptionalProxy;
    this.timeoutMs = Math.max(1000, options.timeoutMs ?? 8000);
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.sleep = options.sleep ?? ((ms) => delay(ms).then(() => undefined));
  }

  async readAccount(account: CodexSubscriptionAccount): Promise<CodexSubscriptionReadResult> {
    const usagePayload = await this.requestJson(account, "/wham/usage");
    const resetPayload = await this.requestJson(account, "/wham/rate-limit-reset-credits");
    const usage = parseUsagePayload(usagePayload);
    const credits = parseResetCreditsPayload(resetPayload);
    return {
      accountId: account.accountId ?? credits.accountId,
      workspaceId: account.workspaceId,
      plan: usage.plan,
      usageWindows: usage.windows,
      cards: credits.cards,
      observedAt: Date.now(),
    };
  }

  async consume(account: CodexSubscriptionAccount, creditId: string, requestId: string): Promise<{ code: string; windowsReset: number }> {
    const payload = await this.requestJson(account, "/wham/rate-limit-reset-credits/consume", {
      method: "POST",
      body: JSON.stringify({ credit_id: creditId, redeem_request_id: requestId }),
    });
    if (!isRecord(payload) || typeof payload.code !== "string") {
      throw new CodexSubscriptionError("parse", "Codex reset consume response did not include a result code");
    }
    return {
      code: payload.code,
      windowsReset: numberValue(payload.windows_reset) ?? numberValue(payload.windowsReset) ?? 0,
    };
  }

  private async requestJson(
    account: CodexSubscriptionAccount,
    path: string,
    options: { method?: "GET" | "POST"; body?: string } = {},
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = new Headers({
        authorization: `Bearer ${account.accessToken}`,
        accept: "application/json",
        "user-agent": this.userAgent,
      });
      if (account.accountId) headers.set("chatgpt-account-id", account.accountId);
      if (account.workspaceId) headers.set("chatgpt-workspace-id", account.workspaceId);
      if (options.body !== undefined) headers.set("content-type", "application/json");
      let response: FetchResponseLike;
      try {
        response = await this.fetchWithProxyImpl(
          `${this.baseUrl}${path}`,
          { method: options.method ?? "GET", headers, body: options.body, signal: controller.signal },
          account.proxyUrl,
          this.fetchImpl,
        );
      } catch (error) {
        if (controller.signal.aborted) throw new CodexSubscriptionError("network", "Codex subscription request timed out");
        throw new CodexSubscriptionError("network", `Codex subscription request failed: ${safeErrorMessage(error)}`);
      }
      const retryAfterMs = parseRetryAfter(response.headers);
      // Classify the HTTP status before decoding an error body. Private
      // endpoints sometimes return an empty/HTML error page; that must not
      // turn a clear 401/404/429 into an opaque parse failure.
      if (response.status === 401 || response.status === 403) {
        throw new CodexSubscriptionError("unauthorized", "Codex subscription credentials are unauthorized", { status: response.status });
      }
      if (response.status === 404) {
        throw new CodexSubscriptionError("unsupported", "Codex reset-card endpoint is unavailable", { status: response.status });
      }
      if (response.status === 429) {
        throw new CodexSubscriptionError("rate-limited", "Codex subscription endpoint is rate limited", { status: response.status, retryAfterMs });
      }
      if (response.status < 200 || response.status >= 300) {
        throw new CodexSubscriptionError("api", `Codex subscription endpoint returned HTTP ${response.status}`, { status: response.status, retryAfterMs });
      }
      const payload = await parseJsonResponse(response);
      if (!isRecord(payload)) throw new CodexSubscriptionError("parse", "Codex subscription response was not an object", { status: response.status });
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** A short, provider-safe delay used by tests and callers that retry 429s. */
  async waitRetry(retryAfterMs?: number): Promise<void> {
    await this.sleep(Math.min(Math.max(retryAfterMs ?? 1000, 250), 60_000));
  }
}

async function parseJsonResponse(response: FetchResponseLike): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new CodexSubscriptionError("parse", `Codex subscription response was invalid JSON: ${safeErrorMessage(error)}`, { status: response.status });
  }
}

export function parseUsagePayload(payload: Record<string, unknown>): { plan?: string; windows: StoredUsageWindow[] } {
  const containers: Record<string, unknown>[] = [payload];
  for (const key of ["rate_limit", "rate_limits"]) {
    const value = payload[key];
    if (isRecord(value)) containers.unshift(value);
  }
  const windows: StoredUsageWindow[] = [];
  const seen = new Set<string>();
  for (const container of containers) {
    const candidates: Array<[string, unknown]> = [
      ["primary", container.primary_window ?? container.primary],
      ["secondary", container.secondary_window ?? container.secondary],
    ];
    if (Array.isArray(container.windows)) {
      candidates.push(...container.windows.map((value, index): [string, unknown] => [`window-${index}`, value]));
    }
    for (const [label, value] of candidates) {
      if (!isRecord(value)) continue;
      const parsed = parseUsageWindow(value, label);
      if (!parsed) continue;
      const key = `${parsed.name}:${parsed.resetsAt ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      windows.push(parsed);
    }
  }
  const plan = stringValue(payload.plan_type) ?? containers.map((value) => stringValue(value.plan_type)).find(Boolean);
  return { plan, windows };
}

function parseUsageWindow(value: Record<string, unknown>, label: string): StoredUsageWindow | undefined {
  const minutes = numberValue(value.window_minutes)
    ?? (numberValue(value.limit_window_seconds) ? Math.round((numberValue(value.limit_window_seconds) ?? 0) / 60) : undefined);
  const usedPercent = numberValue(value.used_percent)
    ?? (numberValue(value.unused_percent) !== undefined ? 100 - (numberValue(value.unused_percent) ?? 0) : undefined)
    ?? (numberValue(value.remaining_percent) !== undefined ? 100 - (numberValue(value.remaining_percent) ?? 0) : undefined);
  if (minutes === undefined && usedPercent === undefined) return undefined;
  const normalizedMinutes = minutes ?? 0;
  const name = normalizedMinutes >= 10_000 ? "weekly" : normalizedMinutes >= 240 ? "five-hour" : "other";
  const used = Math.max(0, Math.min(100, usedPercent ?? 0));
  return {
    name,
    ...(usedPercent !== undefined ? { usedPercent: used } : {}),
    ...(timestampValue(value.resets_at ?? value.reset_at) !== undefined ? { resetsAt: timestampValue(value.resets_at ?? value.reset_at) } : {}),
    used: used > 0,
    exhausted: used >= 100,
  };
}

export function parseResetCreditsPayload(payload: Record<string, unknown>): { accountId?: string; cards: StoredResetCard[] } {
  const rawCredits = Array.isArray(payload.credits) ? payload.credits : Array.isArray(payload.reset_credits) ? payload.reset_credits : undefined;
  const availableCount = numberValue(payload.available_count) ?? numberValue(payload.availableCount);
  if (!rawCredits && availableCount === undefined) {
    throw new CodexSubscriptionError("unsupported", "Codex reset-card response did not expose reset credits");
  }
  const cards: StoredResetCard[] = [];
  for (const raw of rawCredits ?? []) {
    if (!isRecord(raw)) continue;
    const creditId = stringValue(raw.id) ?? stringValue(raw.credit_id);
    if (!creditId) continue;
    const status = stringValue(raw.status)?.toLowerCase() ?? "available";
    if (status !== "available") continue;
    const expiresAt = timestampValue(raw.expires_at ?? raw.expiresAt);
    const grantedAt = timestampValue(raw.granted_at ?? raw.grantedAt);
    cards.push({
      id: safeCardId(creditId),
      creditId,
      type: resetCardType(raw.reset_type ?? raw.resetType ?? raw.window),
      ...(grantedAt !== undefined ? { grantedAt } : {}),
      ...(expiresAt !== undefined
        ? { expiresAt }
        : raw.expires_at === null || raw.expiresAt === null
          ? { nonExpiring: true }
          : {}),
      status: "available",
    });
  }
  cards.sort((a, b) => (a.expiresAt ?? Number.POSITIVE_INFINITY) - (b.expiresAt ?? Number.POSITIVE_INFINITY));
  return { accountId: stringValue(payload.account_id), cards };
}

function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

function timestampValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value > 10_000_000_000 ? Math.round(value) : Math.round(value * 1000);
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (/^\d+$/.test(value.trim())) return timestampValue(Number(value));
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]") : String(error).slice(0, 200);
}
