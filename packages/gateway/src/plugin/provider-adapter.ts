import { randomUUID } from "node:crypto";

import type { GatewayProtocol } from "../protocol.js";
import type {
  ProviderAccountRef,
  ProviderAdapter,
  ProviderAuthMethod,
  ProviderEndpoint,
  ProviderErrorInput,
  ProviderFailureClass,
  ProviderHttpClient,
  ProviderLoginStart,
  ProviderModel,
  ProviderQuotaSnapshot,
  ProviderSignRequestInput,
  ProviderSignedRequest,
} from "../provider/adapters.js";
import { PluginHost } from "./host.js";

export interface PluginProviderAdapterOptions {
  id: string;
  displayName: string;
  authMethods: readonly ProviderAuthMethod[];
  endpoints: readonly ProviderEndpoint[];
  host: PluginHost;
  random?: () => string;
}

/**
 * Exposes a signed/installed provider plugin through the same adapter
 * contract as built-in providers. The host remains authoritative for
 * permissions and the plugin only receives raw credential material when the
 * manifest explicitly declares `secrets`.
 */
export function createPluginProviderAdapter(options: PluginProviderAdapterOptions): ProviderAdapter {
  if (!/^[a-z][a-z0-9._-]{1,63}$/.test(options.id)) throw new Error("Plugin provider id is invalid");
  if (!options.endpoints.length) throw new Error(`Plugin provider '${options.id}' must expose at least one endpoint`);
  const random = options.random ?? randomUUID;
  return {
    id: options.id,
    displayName: options.displayName,
    authMethods: options.authMethods,
    endpoints: options.endpoints,
    beginLogin(redirectUri, now = Date.now()): ProviderLoginStart {
      const state = random();
      const expiresAt = now + 10 * 60 * 1000;
      const params = new URLSearchParams({ response_type: "code", redirect_uri: redirectUri, state });
      return { providerId: options.id, state, authorizationUrl: `codex-switcher://${options.id}/authorize?${params}`, expiresAt };
    },
    completeLogin(input) {
      if (!input.state || input.state !== input.expectedState) throw new Error("Provider login state mismatch");
      if (!input.code.trim()) throw new Error("Provider login code is required");
      const accountId = input.accountId?.trim() || `${options.id}-${input.code.slice(0, 8)}`;
      const authMethod: ProviderAuthMethod = options.authMethods.includes("subscription") ? "subscription" : options.authMethods.includes("oauth") ? "oauth" : options.authMethods.includes("api_key") ? "api_key" : "none";
      return { account: { accountId, displayName: `${options.displayName} (${accountId})`, authMethod, secretRef: `provider/${options.id}/${accountId}`, status: "active" }, accessToken: input.code };
    },
    async refresh(_client, account, refreshToken) {
      if (!refreshToken.trim()) throw new Error(`Provider '${options.id}' refresh token is required`);
      return normalizeCredentialResult(await callPlugin(options.host, "provider.refresh", { account, refreshToken }, true), account);
    },
    async revoke(_client, account, secret = "") {
      await callPlugin(options.host, "provider.revoke", { account, ...(secret ? { secret } : {}) }, Boolean(secret));
    },
    async discoverModels(_client, account, secret) {
      const models = normalizeModels(await callPlugin(options.host, "provider.models", { account, secretRef: account.secretRef, ...(secret !== undefined ? { secret } : {}) }, secret !== undefined), options.id);
      if (!account.allowedModelIds) return models;
      const allowed = new Set(account.allowedModelIds);
      return models.filter((model) => allowed.has(model.id));
    },
    async listModels(client, account, secret) {
      return this.discoverModels(client, account, secret);
    },
    async readQuota(_client, account, secret) {
      const result = await callPlugin(options.host, "provider.quota", { account, secretRef: account.secretRef, ...(secret !== undefined ? { secret } : {}) }, secret !== undefined);
      return result == null ? null : normalizeQuota(result, options.id, account.accountId);
    },
    async fetchQuota(client, account, secret) {
      return this.readQuota(client, account, secret);
    },
    authorizationHeaders(account, secret, protocol) {
      const headers = new Headers(account.requestHeaders);
      if (!headers.has("accept")) headers.set("accept", "application/json");
      if (protocol === "anthropic") {
        headers.set("x-api-key", secret);
        headers.set("anthropic-version", "2023-06-01");
      } else if (protocol === "gemini") {
        headers.set("x-goog-api-key", secret);
      } else if (account.authMethod !== "none") {
        headers.set("authorization", `Bearer ${secret}`);
      }
      return headers;
    },
    signRequest(input: ProviderSignRequestInput): ProviderSignedRequest {
      const headers = new Headers(input.headers);
      for (const [key, value] of this.authorizationHeaders(input.account, input.secret, input.protocol).entries()) headers.set(key, value);
      if (input.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
      return { url: input.url, init: { method: input.method, headers, ...(input.body !== undefined ? { body: input.body } : {}) } };
    },
    classifyError(input) {
      return classifyProviderError(input);
    },
  };
}

async function callPlugin(host: PluginHost, method: string, params: Record<string, unknown>, includesSecret: boolean): Promise<unknown> {
  const response = includesSecret
    ? await host.callWithPermission(method, params, "secrets")
    : await host.call(method, params);
  return response.result;
}

function normalizeCredentialResult(value: unknown, fallback: ProviderAccountRef): { account: ProviderAccountRef; accessToken?: string; refreshToken?: string } {
  if (!isRecord(value)) throw new Error("Provider plugin returned an invalid credential result");
  const account = isRecord(value.account) ? normalizeAccount(value.account, fallback) : fallback;
  return {
    account,
    ...(typeof value.accessToken === "string" ? { accessToken: value.accessToken } : {}),
    ...(typeof value.refreshToken === "string" ? { refreshToken: value.refreshToken } : {}),
  };
}

function normalizeModels(value: unknown, providerId: string): ProviderModel[] {
  const rawModels = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.models) ? value.models : [];
  return rawModels.filter(isRecord).flatMap((item) => {
    if (typeof item.id !== "string" || !item.id.trim()) return [];
    const protocols = Array.isArray(item.protocols) ? item.protocols.filter((protocol): protocol is GatewayProtocol => ["responses", "chat_completions", "anthropic", "gemini"].includes(String(protocol))) : [];
    const capabilities = isRecord(item.capabilities) ? item.capabilities : {};
    return [{
      id: item.id,
      displayName: typeof item.displayName === "string" && item.displayName.trim() ? item.displayName : item.id,
      providerId,
      protocols: protocols.length ? protocols : ["responses"],
      capabilities: { reasoning: capabilities.reasoning === true, tools: capabilities.tools !== false, vision: capabilities.vision === true, streaming: capabilities.streaming !== false },
      ...(typeof item.contextWindow === "number" ? { contextWindow: item.contextWindow } : {}),
      source: item.source === "preset" || item.source === "manual" ? item.source : "discovery",
    }];
  });
}

function normalizeQuota(value: unknown, providerId: string, accountId: string): ProviderQuotaSnapshot {
  const item = isRecord(value) ? value : {};
  return {
    providerId,
    accountId,
    ...(number(item.requestsRemaining) !== undefined ? { requestsRemaining: number(item.requestsRemaining) } : {}),
    ...(number(item.tokensRemaining) !== undefined ? { tokensRemaining: number(item.tokensRemaining) } : {}),
    ...(number(item.resetAt) !== undefined ? { resetAt: number(item.resetAt) } : {}),
    ...(typeof item.plan === "string" ? { plan: item.plan } : {}),
    observedAt: number(item.observedAt) ?? Date.now(),
  };
}

function normalizeAccount(value: Record<string, unknown>, fallback: ProviderAccountRef): ProviderAccountRef {
  return {
    ...fallback,
    ...(typeof value.accountId === "string" ? { accountId: value.accountId } : {}),
    ...(typeof value.displayName === "string" ? { displayName: value.displayName } : {}),
    ...(value.authMethod === "api_key" || value.authMethod === "oauth" || value.authMethod === "subscription" || value.authMethod === "none" ? { authMethod: value.authMethod } : {}),
    ...(typeof value.status === "string" && ["active", "cooldown", "invalid", "expired", "disabled"].includes(value.status) ? { status: value.status as ProviderAccountRef["status"] } : {}),
    ...(typeof value.expiresAt === "number" ? { expiresAt: value.expiresAt } : {}),
    ...(typeof value.proxyUrl === "string" ? { proxyUrl: value.proxyUrl } : {}),
    secretRef: fallback.secretRef,
  };
}

function classifyProviderError(input: ProviderErrorInput): ProviderFailureClass {
  const message = `${input.code ?? ""} ${input.message ?? ""}`.toLowerCase();
  if (/timeout|timed out|aborted/.test(message) || input.status === 408) return "timeout";
  if (input.status === 401 || input.status === 403 || /unauthori[sz]ed|invalid.*key|expired/.test(message)) return "unauthorized";
  if (input.status === 402 || /quota|balance|insufficient/.test(message)) return "quota";
  if (input.status === 429 || /rate.?limit|too many requests/.test(message)) return "rate_limit";
  if (input.status !== undefined && input.status >= 500) return "upstream_5xx";
  if (input.status !== undefined && input.status >= 400) return "upstream_4xx";
  if (/invalid|malformed|missing|required|unsupported/.test(message)) return "validation";
  return "transport";
}

function number(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
