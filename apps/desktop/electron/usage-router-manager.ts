import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  type AccountRequestHealth,
  buildLocalRouteBaseUrl,
  buildLocalGatewayBaseUrl,
  createEnvironmentGatewayId,
  createRouteId,
  type EnvironmentGateway,
  type EnvironmentGatewayRouteGroup,
  type GatewayRouteRule,
  isLocalRouterBaseUrl,
  normalizeUpstreamBaseUrl,
  type PricingProfile,
  type RouteTarget,
  type UsageFilter,
  type UsageRequestPage,
  type UsageRequestQuery,
  type UsageSnapshot,
  type UsageTraceEvent,
  type UsageTraceQuery,
  type RouteCapabilities,
  type RouteProtocol,
} from "./usage-routing-model.js";
import {
  buildLocalPoolBaseUrl,
  createAccountPoolId,
  normalizePoolMaxFailoverAttempts,
  normalizePoolMaxSameAccountFailures,
  normalizePoolSessionTtl,
  normalizePoolWeight,
  type AccountPool,
  type PoolMemberHealthState,
  type PoolProtocol,
} from "./account-pool-routing.js";
import { FileHistoryPersistence } from "./openai-chat-compat/history-persistence.js";
import { createUsageStore } from "./usage-store.js";
import { runCompatibilityCheck, type StagedCompatibilityResult } from "./openai-chat-compat/compatibility-check.js";
import { resolveCredentialCandidates } from "./credential-resolver.js";

const REQUIRED_ROUTER_API_VERSION = 10;

export function isCompatibleRouterHealth(value: unknown): boolean {
  return Boolean(value && typeof value === "object" &&
    (value as { ok?: unknown }).ok === true &&
    (value as { apiVersion?: unknown }).apiVersion === REQUIRED_ROUTER_API_VERSION);
}

interface RouterStateFile {
  pid: number;
  port: number;
  adminToken: string;
  startedAt: number;
}

export interface RoutableAccount {
  envName: string;
  accountName: string;
  authMode: string;
  providerId?: string;
  providerAuthMethod?: "api_key" | "oauth" | "subscription" | "plugin" | "none";
  baseUrl: string;
  protocol?: RouteTarget["protocol"];
  apiKey?: string;
  authAccountId?: string;
  upstreamModel?: string;
  reasoningProfile?: RouteTarget["reasoningProfile"];
  longConversationStrategy?: RouteTarget["longConversationStrategy"];
  instructionRole?: RouteTarget["instructionRole"];
  requestOverrides?: Record<string, unknown>;
  requestHeaders?: Record<string, string>;
  proxyUrl?: string;
}

export interface AccountPoolInput {
  envName: string;
  protocol: PoolProtocol;
  accountNames: string[];
  weights?: Record<string, number>;
  sessionTtlMinutes?: number;
  maxFailoverAttempts?: number;
  maxSameAccountFailures?: number;
}

/**
 * An explicit gateway model binding.  These bindings are materialized as
 * gateway-only routes so a single credential can expose more than the one
 * legacy account-default model.  Selection is always driven by the request's
 * explicit model or RouteGroup; this type intentionally has no prompt/intent
 * selector.
 */
export interface GatewayRouteBinding {
  providerId: string;
  modelId: string;
  upstreamModel: string;
  exposedModelId: string;
  routeGroupId?: string;
  accountNames: string[];
  protocols?: RouteTarget["protocol"][];
  /** The protocol configured by each concrete account bound to this model. */
  protocolByAccount?: Record<string, RouteTarget["protocol"]>;
  /** The protocol used on the provider side for each account.  This may differ
   * from the Codex ingress protocol when the gateway performs conversion. */
  upstreamProtocolByAccount?: Record<string, RouteTarget["protocol"]>;
  capabilities?: RouteCapabilities;
  capabilityProfile?: RouteTarget["capabilityProfile"];
  requestHeadersByAccount?: Record<string, Record<string, string>>;
  proxyUrlByAccount?: Record<string, string>;
}

export interface AccountPoolStatus extends AccountPool {
  cursor: number;
  health: PoolMemberHealthState[];
  localBaseUrl?: string;
  readyMembers: number;
}

export interface AccountRouteStatus {
  envName: string;
  accountName: string;
  enabled: boolean;
  state: "disabled" | "ready" | "degraded";
  routeId?: string;
  localBaseUrl?: string;
  message?: string;
}

export interface CompatibilityCheckResult extends StagedCompatibilityResult { ok: boolean; status: number; message: string; }

export interface GatewayCapabilityObservationEntry {
  key: string;
  providerId: string;
  endpoint: string;
  protocol: string;
  modelId: string;
  credentialId: string;
  capability: string;
  status: "supported" | "unsupported" | "unknown" | "degraded";
  source: "provider" | "preset" | "discovery" | "probe" | "observed" | "legacy";
  checkedAt?: number;
  expiresAt?: number;
  evidence?: string;
}

/**
 * Keep smoke tests on the strict Responses wire shape used by Codex App.
 * Codex's official backend requires `input` to be an array even though some
 * OpenAI-compatible endpoints also accept a plain string.
 */
function buildResponsesTestInput(prompt: string): Array<{
  role: "user";
  content: Array<{ type: "input_text"; text: string }>;
}> {
  return [{ role: "user", content: [{ type: "input_text", text: prompt }] }];
}

export interface ModelRequestTestInput {
  envName: string;
  accountName: string;
  model: string;
  upstreamModel?: string;
  prompt?: string;
}

export interface ModelRequestTestResult {
  ok: boolean;
  status: number;
  message: string;
  responseText?: string;
  latencyMs: number;
  model: string;
}

export interface ModelRequestPreviewInput {
  envName: string;
  accountName: string;
  model: string;
  prompt?: string;
  route: RouteTarget;
  upstreamApiKey?: string;
  authMode?: "auth" | "apikey" | "none";
  accountId?: string;
  /** Keep managed provider routes unhydrated when the saved route would not have a secret. */
  hydrateRouteSecret?: boolean;
}

interface RouteTokenFile { routes: Record<string, string>; pools?: Record<string, string>; gateways?: Record<string, string>; }

export interface EnvironmentRouteStatus {
  envName: string;
  enabled: boolean;
  routedAccounts: number;
  port: number | null;
  poolEnabled?: boolean;
  poolId?: string;
  poolMemberCount?: number;
  poolReadyMembers?: number;
  gatewayEnabled?: boolean;
  gatewayId?: string;
  localGatewayBaseUrl?: string;
  localAgentAccessEnabled?: boolean;
  localAgentBaseUrl?: string;
  localAgentModelsUrl?: string;
  localAgentAccessToken?: string;
}

export interface UsageRouterManagerOptions {
  stateDir: string;
  serviceEntryPath: string;
  executablePath?: string;
  preferredPort?: () => number | Promise<number>;
  launchService?: (preferredPort?: number) => Promise<void>;
  defaultProxyUrl?: () => string | undefined | Promise<string | undefined>;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function capabilityObservationEntry(key: string, value: unknown): GatewayCapabilityObservationEntry[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const observation = value as Partial<GatewayCapabilityObservationEntry>;
  if (!["supported", "unsupported", "unknown", "degraded"].includes(String(observation.status))) return [];
  if (!["provider", "preset", "discovery", "probe", "observed", "legacy"].includes(String(observation.source))) return [];
  const parts = key.split("|");
  const capability = parts.pop() ?? "";
  const credentialId = parts.pop() ?? "*";
  const modelId = parts.pop() ?? "unknown";
  const protocol = parts.pop() ?? "unknown";
  const endpoint = parts.pop() ?? "*";
  const providerId = parts.join("|") || "unknown-provider";
  return [{ key, providerId, endpoint, protocol, modelId, credentialId,
    capability, status: observation.status as GatewayCapabilityObservationEntry["status"],
    source: observation.source as GatewayCapabilityObservationEntry["source"],
    ...(typeof observation.checkedAt === "number" ? { checkedAt: observation.checkedAt } : {}),
    ...(typeof observation.expiresAt === "number" ? { expiresAt: observation.expiresAt } : {}),
    ...(typeof observation.evidence === "string" ? { evidence: observation.evidence } : {}),
  }];
}

async function collectModelTestResult(
  response: Response,
  requestedModel: string,
  startedAt: number,
): Promise<ModelRequestTestResult> {
  const raw = await response.text();
  let parsed: Record<string, unknown> | undefined;
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch {
    // Some providers return plain text or an SSE body. Keep a short excerpt.
  }
  const responseBody = parsed?.response && typeof parsed.response === "object" && !Array.isArray(parsed.response)
    ? parsed.response as Record<string, unknown>
    : parsed;
  const responseError = responseBody?.error && typeof responseBody.error === "object" && !Array.isArray(responseBody.error)
    ? responseBody.error as Record<string, unknown>
    : parsed?.error && typeof parsed.error === "object" && !Array.isArray(parsed.error)
      ? parsed.error as Record<string, unknown>
      : undefined;
  const responseErrorMessage = typeof responseError?.message === "string" ? responseError.message : undefined;
  const responseStatus = typeof responseBody?.status === "string" ? responseBody.status : undefined;
  const output = Array.isArray(responseBody?.output) ? responseBody.output : undefined;
  const hasUsableOutput = output?.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const entry = item as Record<string, unknown>;
    if (entry.type === "function_call" || entry.type === "custom_tool_call" || entry.type === "tool_search_call") return true;
    if (entry.type !== "message" && entry.type !== undefined) return false;
    const content = entry.content;
    if (typeof content === "string") return content.trim().length > 0;
    return Array.isArray(content) && content.some((part) => part && typeof part === "object" && !Array.isArray(part)
      && typeof (part as Record<string, unknown>).text === "string"
      && String((part as Record<string, unknown>).text).trim().length > 0);
  }) ?? undefined;
  const responseOutputText = output?.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const entry = item as Record<string, unknown>;
    if (entry.type !== "message") return [];
    if (typeof entry.content === "string") return [entry.content];
    if (!Array.isArray(entry.content)) return [];
    return entry.content.flatMap((part) => part && typeof part === "object" && !Array.isArray(part)
      && typeof (part as Record<string, unknown>).text === "string" ? [String((part as Record<string, unknown>).text)] : []);
  }).join(" ");
  const outputText = typeof parsed?.output_text === "string"
    ? parsed.output_text
    : responseOutputText
      ? responseOutputText
    : typeof parsed?.response === "string"
      ? parsed.response
      : typeof parsed?.text === "string"
        ? parsed.text
        : Array.isArray(parsed?.choices) && typeof parsed.choices[0] === "object" && parsed.choices[0]
          ? String((parsed.choices[0] as Record<string, unknown>).message && typeof (parsed.choices[0] as Record<string, unknown>).message === "object"
            ? ((parsed.choices[0] as Record<string, unknown>).message as Record<string, unknown>).content ?? ""
            : "")
          : raw;
  const excerpt = outputText.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!response.ok || responseStatus === "failed" || responseErrorMessage) {
    const errorText = responseErrorMessage || excerpt || `HTTP ${response.status}`;
    return { ok: false, status: response.status, message: errorText, responseText: excerpt || undefined, latencyMs: Date.now() - startedAt, model: requestedModel };
  }
  if (output && !hasUsableOutput) {
    return { ok: false, status: response.status, message: "Model completed without assistant text or an executable tool call", responseText: undefined, latencyMs: Date.now() - startedAt, model: requestedModel };
  }
  if (!excerpt && !output?.length) {
    return { ok: false, status: response.status, message: "Model returned an empty response", responseText: undefined, latencyMs: Date.now() - startedAt, model: requestedModel };
  }
  return { ok: true, status: response.status, message: excerpt || "Model responded successfully", responseText: excerpt || undefined, latencyMs: Date.now() - startedAt, model: requestedModel };
}

export class UsageRouterManager {
  private readonly routerDir: string;

  constructor(private readonly options: UsageRouterManagerOptions) {
    this.routerDir = join(options.stateDir, "usage-router");
  }

  private tokenPath(): string { return join(this.routerDir, "compatibility-route-tokens.json"); }

  private async readRouteTokens(): Promise<RouteTokenFile> {
    try { return JSON.parse(await readFile(this.tokenPath(), "utf8")) as RouteTokenFile; }
    catch { return { routes: {}, pools: {}, gateways: {} }; }
  }

  private async writeRouteTokens(value: RouteTokenFile): Promise<void> {
    await mkdir(this.routerDir, { recursive: true });
    const target = this.tokenPath(); const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    if (process.platform !== "win32") await chmod(target, 0o600);
  }

  private async readState(): Promise<RouterStateFile | null> {
    try {
      return JSON.parse(await readFile(join(this.routerDir, "router-state.json"), "utf8")) as RouterStateFile;
    } catch {
      return null;
    }
  }

  private async isHealthy(state: RouterStateFile): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${state.port}/health`, { signal: AbortSignal.timeout(800) });
      return response.ok && isCompatibleRouterHealth(await response.json());
    } catch {
      return false;
    }
  }

  async ensureService(): Promise<RouterStateFile> {
    const existing = await this.readState();
    if (existing && await this.isHealthy(existing)) {
      await this.syncDefaultProxy(existing);
      return existing;
    }
    if (existing?.pid && existing.pid !== process.pid) {
      try { process.kill(existing.pid); } catch { /* stale process already exited */ }
    }

    const preferredPort = await this.options.preferredPort?.();
    if (this.options.launchService) {
      await this.options.launchService(preferredPort);
    } else {
      const args = [this.options.serviceEntryPath, "--state-dir", this.routerDir];
      if (preferredPort !== undefined) args.push("--preferred-port", String(preferredPort));
      const child = spawn(this.options.executablePath ?? process.execPath, args, {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      });
      child.unref();
    }

    for (let attempt = 0; attempt < 50; attempt += 1) {
      await delay(100);
      const state = await this.readState();
      if (state && await this.isHealthy(state)) {
        await this.syncDefaultProxy(state);
        return state;
      }
    }
    throw new Error("Local usage router did not start within 5 seconds");
  }

  private async adminWithState<T>(state: RouterStateFile, path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`http://127.0.0.1:${state.port}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${state.adminToken}`, ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Usage router ${response.status}: ${await response.text()}`);
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  private async admin<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.adminWithState<T>(await this.ensureService(), path, init);
  }

  private async syncDefaultProxy(state: RouterStateFile): Promise<void> {
    if (!this.options.defaultProxyUrl) return;
    const proxyUrl = await this.options.defaultProxyUrl();
    await this.adminWithState<void>(state, "/admin/proxy", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proxyUrl: proxyUrl || null }),
    });
  }

  async refreshDefaultProxy(): Promise<boolean> {
    const state = await this.readState();
    if (!state || !await this.isHealthy(state)) return false;
    await this.syncDefaultProxy(state);
    return true;
  }

  private async deleteRoutes(routes: RouteTarget[]): Promise<void> {
    if (!routes.length) return;
    const tokens = await this.readRouteTokens();
    for (const route of routes) {
      await this.admin<void>(`/admin/routes/${encodeURIComponent(route.routeId)}`, { method: "DELETE" });
      delete tokens.routes[route.routeId];
    }
    await this.writeRouteTokens(tokens);
  }

  private isMissingAccountError(error: unknown, envName: string, accountName: string): boolean {
    return error instanceof Error && error.message === `Account '${envName}/${accountName}' not found`;
  }

  private async removeRoutesMatching(predicate: (route: RouteTarget) => boolean): Promise<number> {
    const runningState = await this.readState();
    if (runningState && await this.isHealthy(runningState)) {
      const routes = (await this.adminWithState<RouteTarget[]>(runningState, "/admin/routes")).filter(predicate);
      await this.deleteRoutes(routes);
      return routes.length;
    }

    const store = await createUsageStore(join(this.routerDir, "usage.db"));
    const history = new FileHistoryPersistence(join(this.routerDir, "chat-history"));
    try {
      const routes = (await store.listRoutes()).filter(predicate);
      const tokens = await this.readRouteTokens();
      for (const route of routes) {
        await store.removeRoute(route.routeId);
        delete tokens.routes[route.routeId];
        await history.delete(route.routeId);
      }
      await this.writeRouteTokens(tokens);
      return routes.length;
    } finally {
      await store.close();
    }
  }

  listRoutes(): Promise<RouteTarget[]> {
    return this.admin<RouteTarget[]>("/admin/routes");
  }

  async listRoutesIfRunning(): Promise<RouteTarget[]> {
    const state = await this.readState();
    if (!state || !await this.isHealthy(state)) return [];
    return this.adminWithState<RouteTarget[]>(state, "/admin/routes");
  }

  async listAccountPools(): Promise<AccountPoolStatus[]> {
    const state = await this.readState();
    if (!state || !await this.isHealthy(state)) return [];
    const pools = await this.adminWithState<Array<AccountPool & { cursor: number }>>(state, "/admin/pools");
    return Promise.all(pools.map(async (pool) => {
      const health = await this.adminWithState<PoolMemberHealthState[]>(state, `/admin/pools/${encodeURIComponent(pool.poolId)}/health`);
      return { ...pool, health, localBaseUrl: buildLocalPoolBaseUrl(state.port, pool.poolId), readyMembers: health.filter((item) => item.state === "healthy" || item.state === "degraded").length };
    }));
  }

  async listPersistedAccountPools(): Promise<Array<AccountPool & { cursor: number }>> {
    const state = await this.readState();
    if (state && await this.isHealthy(state)) return this.adminWithState<Array<AccountPool & { cursor: number }>>(state, "/admin/pools");
    const store = await createUsageStore(join(this.routerDir, "usage.db"));
    try { return await store.listPools(); } finally { await store.close(); }
  }

  async listEnvironmentGateways(): Promise<EnvironmentGateway[]> {
    const state = await this.readState();
    if (!state || !await this.isHealthy(state)) return [];
    return this.adminWithState<EnvironmentGateway[]>(state, "/admin/gateways");
  }

  async listPersistedEnvironmentGateways(): Promise<EnvironmentGateway[]> {
    const state = await this.readState();
    if (state && await this.isHealthy(state)) return this.adminWithState<EnvironmentGateway[]>(state, "/admin/gateways");
    const store = await createUsageStore(join(this.routerDir, "usage.db"));
    try { return await store.listGateways(); } finally { await store.close(); }
  }

  async listCapabilityObservations(): Promise<GatewayCapabilityObservationEntry[]> {
    const state = await this.readState();
    if (state && await this.isHealthy(state)) {
      return this.adminWithState<GatewayCapabilityObservationEntry[]>(state, "/admin/capabilities");
    }
    try {
      const raw = JSON.parse(await readFile(join(this.routerDir, "capability-observations.json"), "utf8")) as Record<string, unknown>;
      return Object.entries(raw).flatMap(([key, value]) => capabilityObservationEntry(key, value));
    } catch {
      return [];
    }
  }

  async enableAccountPool(
    input: AccountPoolInput,
    accounts: RoutableAccount[],
    updateBaseUrl: (accountName: string, baseUrl: string) => Promise<void>,
  ): Promise<AccountPoolStatus> {
    const selectedInput = accounts.filter((account) => input.accountNames.includes(account.accountName));
    if (!selectedInput.length) throw new Error(`Environment '${input.envName}' has no selected pool accounts`);
    if (input.protocol === "chat_completions" && selectedInput.some((account) => account.authMode === "auth")) {
      throw new Error("Chat compatibility pools require API-key accounts");
    }
    const selected = resolveCredentialCandidates(accounts, {
      envName: input.envName,
      protocol: input.protocol,
    }).candidates.filter((account) => input.accountNames.includes(account.accountName));
    if (!selected.length) throw new Error(`Environment '${input.envName}' has no compatible selected credentials`);
    if (selected.some((account) => !account.apiKey?.trim() && account.providerAuthMethod !== "none")) throw new Error("Account pool members require a bearer credential");
    if (selected.some((account) => account.protocol && account.protocol !== input.protocol)) throw new Error("Pool members must use the same API protocol");
    const state = await this.ensureService();
    const poolId = createAccountPoolId(input.envName);
    const previous = (await this.listAccountPools()).find((pool) => pool.poolId === poolId);
    const now = Date.now();
    const pool: AccountPool = {
      poolId, envName: input.envName, protocol: input.protocol, enabled: true,
      strategy: "sticky_weighted_round_robin", sessionTtlMinutes: normalizePoolSessionTtl(input.sessionTtlMinutes),
      maxFailoverAttempts: normalizePoolMaxFailoverAttempts(input.maxFailoverAttempts),
      maxSameAccountFailures: normalizePoolMaxSameAccountFailures(input.maxSameAccountFailures), createdAt: previous?.createdAt ?? now, updatedAt: now,
      members: selected.map((account, index) => {
        const upstreamBaseUrl = normalizeUpstreamBaseUrl(account.baseUrl === "default"
          ? account.authMode === "auth" ? "https://chatgpt.com/backend-api/codex" : "https://api.openai.com/v1"
          : account.baseUrl);
        return {
        accountName: account.accountName,
        routeId: createRouteId(input.envName, account.accountName, upstreamBaseUrl),
        protocol: input.protocol, upstreamBaseUrl,
        originalBaseUrl: account.baseUrl, upstreamModel: account.upstreamModel, proxyUrl: account.proxyUrl,
        enabled: true, weight: normalizePoolWeight(input.weights?.[account.accountName]), priority: index,
      }; }),
    };
    if (pool.members.some((member) => !member.upstreamBaseUrl)) throw new Error("Pool members require a Base URL");
    const tokens = await this.readRouteTokens();
    tokens.pools ??= {};
    const localRouteToken = tokens.pools[poolId] || randomBytes(32).toString("hex");
    const changed: Array<{ accountName: string; originalBaseUrl: string }> = [];
    try {
      await this.admin<void>("/admin/pools", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(pool) });
      for (const member of pool.members) {
        const account = selected.find((item) => item.accountName === member.accountName)!;
        if (pool.protocol === "chat_completions") {
          const route: RouteTarget = {
            routeId: member.routeId, envName: pool.envName, accountName: member.accountName,
            upstreamBaseUrl: member.upstreamBaseUrl, originalBaseUrl: member.originalBaseUrl,
            protocol: "chat_completions", upstreamModel: account.upstreamModel,
            reasoningProfile: account.reasoningProfile ?? "auto",
            longConversationStrategy: account.longConversationStrategy ?? "safe",
            instructionRole: account.instructionRole ?? "auto", requestOverrides: account.requestOverrides,
            requestHeaders: account.requestHeaders,
            proxyUrl: account.proxyUrl,
            enabled: true, createdAt: previous?.createdAt ?? now, updatedAt: now,
          };
          await this.admin<void>(`/admin/routes/${encodeURIComponent(member.routeId)}`, {
            method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(route),
          });
        }
        await this.admin<void>(`/admin/pools/${encodeURIComponent(poolId)}/members/${encodeURIComponent(member.accountName)}/secret`, {
          method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({
            upstreamBearerToken: account.apiKey ?? "",
            authMode: resolveRouteAuthMode(account),
            accountId: account.authAccountId,
          }),
        });
      }
      await this.admin<void>(`/admin/pools/${encodeURIComponent(poolId)}/token`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ localRouteToken }),
      });
      const localBaseUrl = buildLocalPoolBaseUrl(state.port, poolId);
      for (const member of pool.members) {
        await updateBaseUrl(member.accountName, localBaseUrl);
        changed.push({ accountName: member.accountName, originalBaseUrl: member.originalBaseUrl });
      }
      tokens.pools[poolId] = localRouteToken;
      await this.writeRouteTokens(tokens);
      if (pool.protocol === "responses") {
        await this.deleteRoutes((await this.listRoutes()).filter((route) => route.envName === input.envName));
      }
      const health = await this.admin<PoolMemberHealthState[]>(`/admin/pools/${encodeURIComponent(poolId)}/health`);
      return { ...pool, cursor: previous?.cursor ?? 0, health, localBaseUrl, readyMembers: health.filter((item) => item.state === "healthy" || item.state === "degraded").length };
    } catch (error) {
      await Promise.allSettled(changed.map((item) => updateBaseUrl(item.accountName, item.originalBaseUrl)));
      await this.admin<void>(`/admin/pools/${encodeURIComponent(poolId)}`, { method: "DELETE" }).catch(() => undefined);
      throw error;
    }
  }

  async disableAccountPool(envName: string, updateBaseUrl: (accountName: string, baseUrl: string) => Promise<void>): Promise<void> {
    const pool = (await this.admin<Array<AccountPool & { cursor: number }>>("/admin/pools")).find((item) => item.envName === envName);
    if (!pool) return;
    for (const member of pool.members) await updateBaseUrl(member.accountName, member.originalBaseUrl);
    await this.admin<void>(`/admin/pools/${encodeURIComponent(pool.poolId)}`, { method: "DELETE" });
    if (pool.protocol !== "chat_completions") {
      for (const member of pool.members) {
        await this.admin<void>(`/admin/routes/${encodeURIComponent(member.routeId)}`, { method: "DELETE" }).catch(() => undefined);
      }
    }
    const tokens = await this.readRouteTokens(); delete tokens.pools?.[pool.poolId]; await this.writeRouteTokens(tokens);
  }

  async removeAccountPoolConfiguration(envName: string): Promise<void> {
    const pool = (await this.listPersistedAccountPools()).find((item) => item.envName === envName);
    if (!pool) return;
    const state = await this.readState();
    if (state && await this.isHealthy(state)) {
      await this.adminWithState<void>(state, `/admin/pools/${encodeURIComponent(pool.poolId)}`, { method: "DELETE" });
      for (const member of pool.members) {
        await this.adminWithState<void>(state, `/admin/routes/${encodeURIComponent(member.routeId)}`, { method: "DELETE" }).catch(() => undefined);
      }
    } else {
      const store = await createUsageStore(join(this.routerDir, "usage.db"));
      try { await store.removePool(pool.poolId); } finally { await store.close(); }
    }
    const tokens = await this.readRouteTokens();
    delete tokens.pools?.[pool.poolId];
    await this.writeRouteTokens(tokens);
  }

  async listPersistedRoutes(): Promise<RouteTarget[]> {
    const running = await this.readState();
    if (running && await this.isHealthy(running)) {
      return this.adminWithState<RouteTarget[]>(running, "/admin/routes");
    }
    const store = await createUsageStore(join(this.routerDir, "usage.db"));
    try {
      return await store.listRoutes();
    } finally {
      await store.close();
    }
  }

  async listTraceEvents(query: UsageTraceQuery = {}): Promise<UsageTraceEvent[]> {
    const state = await this.readState();
    if (!state || !await this.isHealthy(state)) return [];
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    }
    return this.adminWithState<UsageTraceEvent[]>(state, `/admin/trace${params.size ? `?${params.toString()}` : ""}`);
  }

  async stopService(): Promise<boolean> {
    const state = await this.readState();
    if (!state || !await this.isHealthy(state)) return false;
    await this.adminWithState<void>(state, "/admin/shutdown", { method: "POST" });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await delay(50);
      if (!await this.isHealthy(state)) return true;
    }
    try { process.kill(state.pid, "SIGTERM"); } catch { /* process already stopped */ }
    return true;
  }

  async isEnvironmentEnabled(envName: string): Promise<boolean> {
    return (await this.listRoutesIfRunning()).some((route) => route.envName === envName && route.enabled);
  }

  async syncEnvironmentIfEnabled(
    envName: string,
    accounts: RoutableAccount[],
    updateBaseUrl: (accountName: string, baseUrl: string) => Promise<void>,
  ): Promise<EnvironmentRouteStatus | null> {
    if (!await this.isEnvironmentEnabled(envName)) return null;
    return this.enableEnvironment(envName, accounts, updateBaseUrl);
  }

  async getEnvironmentStatuses(envNames: string[]): Promise<EnvironmentRouteStatus[]> {
    const state = await this.readState();
    if (!state || !await this.isHealthy(state)) {
      return envNames.map((envName) => ({ envName, enabled: false, routedAccounts: 0, port: null }));
    }
    const routes = await this.listRoutes();
    const pools = await this.listAccountPools();
    const gateways = await this.adminWithState<EnvironmentGateway[]>(state, "/admin/gateways");
    const tokens = await this.readRouteTokens();
    const gatewayDetails = (gateway: EnvironmentGateway | undefined) => {
      if (!gateway) return {};
      const localGatewayBaseUrl = buildLocalGatewayBaseUrl(state.port, gateway.gatewayId);
      return {
        gatewayEnabled: true,
        gatewayId: gateway.gatewayId,
        localGatewayBaseUrl,
        ...(gateway.localAgentAccessEnabled ? {
          localAgentAccessEnabled: true,
          localAgentBaseUrl: `${localGatewayBaseUrl}/v1`,
          localAgentModelsUrl: `${localGatewayBaseUrl}/v1/models`,
          localAgentAccessToken: tokens.gateways?.[gateway.gatewayId],
        } : { localAgentAccessEnabled: false }),
      };
    };
    return envNames.map((envName) => {
      const pool = pools.find((item) => item.envName === envName && item.enabled);
      const gateway = gateways.find((item) => item.envName === envName && item.enabled);
      if (pool) return {
        envName, enabled: true, routedAccounts: pool.members.length, port: state.port,
        poolEnabled: true, poolId: pool.poolId, poolMemberCount: pool.members.length, poolReadyMembers: pool.readyMembers,
        ...gatewayDetails(gateway),
      };
      const count = routes.filter((route) => route.envName === envName && route.enabled).length;
      return { envName, enabled: count > 0, routedAccounts: count, port: count > 0 ? state.port : null,
        ...gatewayDetails(gateway) };
    });
  }

  async setEnvironmentLocalAgentAccess(envName: string, enabled: boolean): Promise<EnvironmentRouteStatus> {
    const state = await this.ensureService();
    const gateway = (await this.adminWithState<EnvironmentGateway[]>(state, "/admin/gateways"))
      .find((item) => item.envName === envName && item.enabled);
    if (!gateway) throw new Error(`Environment '${envName}' gateway is not enabled`);
    const tokens = await this.readRouteTokens();
    tokens.gateways ??= {};
    const token = tokens.gateways[gateway.gatewayId] || randomBytes(32).toString("hex");
    tokens.gateways[gateway.gatewayId] = token;
    const nextGateway: EnvironmentGateway = { ...gateway, localAgentAccessEnabled: enabled, updatedAt: Date.now() };
    await this.adminWithState<void>(state, "/admin/gateways", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(nextGateway),
    });
    await this.adminWithState<void>(state, `/admin/gateways/${encodeURIComponent(gateway.gatewayId)}/access`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled, token }),
    });
    await this.writeRouteTokens(tokens);
    return (await this.getEnvironmentStatuses([envName]))[0] ?? { envName, enabled: false, routedAccounts: 0, port: state.port };
  }

  async enableEnvironmentGateway(
    envName: string,
    accounts: RoutableAccount[],
    updateBaseUrl: (accountName: string, baseUrl: string) => Promise<void>,
    routeGroupDefinitions: Record<string, {
      id: string;
      exposedModelId: string;
      strategy: EnvironmentGatewayRouteGroup["strategy"];
      sessionPolicy: EnvironmentGatewayRouteGroup["sessionPolicy"];
      fallbackEnabled: boolean;
      nestedGroupIds?: string[];
      capabilities?: RouteCapabilities;
      accountNames?: string[];
    }> = {},
    routeBindings: GatewayRouteBinding[] = [],
    routeRules: GatewayRouteRule[] = [],
    defaultRouteGroupId?: string,
  ): Promise<EnvironmentRouteStatus> {
    const routeStatus = await this.enableEnvironment(envName, accounts, updateBaseUrl);
    const state = await this.ensureService();
    const allEnvironmentRoutes = (await this.listRoutes()).filter((route) => route.envName === envName && route.enabled);
    const baseRouteIds = new Set(
      allEnvironmentRoutes
        .filter((route) => route.routeId === createRouteId(envName, route.accountName, route.upstreamBaseUrl))
        .map((route) => route.routeId),
    );
    const baseRoutes = allEnvironmentRoutes.filter((route) => baseRouteIds.has(route.routeId));
    const previous = (await this.admin<EnvironmentGateway[]>("/admin/gateways")).find((gateway) => gateway.envName === envName);
    const tokens = await this.readRouteTokens();
    const routes = [...baseRoutes];
    const accountByName = new Map(accounts.map((account) => [account.accountName, account]));
    const baseRouteByAccount = new Map(baseRoutes.map((route) => [route.accountName, route]));
    const modelRouteIds = new Set<string>();
    for (const binding of routeBindings) {
      if (!binding.providerId.trim() || !binding.modelId.trim() || !binding.upstreamModel.trim() || !binding.exposedModelId.trim()) continue;
      for (const accountName of binding.accountNames) {
        const account = accountByName.get(accountName);
        const baseRoute = baseRouteByAccount.get(accountName);
        const protocol = binding.upstreamProtocolByAccount?.[accountName]
          ?? binding.protocolByAccount?.[accountName]
          ?? account?.protocol
          ?? baseRoute?.protocol;
        if (!account || !baseRoute || !protocol || binding.protocols?.length && !binding.protocols.includes(protocol)) continue;
        const routeId = createGatewayModelRouteId(envName, accountName, baseRoute.upstreamBaseUrl, binding.providerId, binding.modelId);
        modelRouteIds.add(routeId);
        const previousRoute = routes.find((route) => route.routeId === routeId);
        const now = Date.now();
        const modelRoute: RouteTarget = {
          routeId,
          envName,
          accountName,
          upstreamBaseUrl: baseRoute.upstreamBaseUrl,
          originalBaseUrl: baseRoute.originalBaseUrl,
          protocol,
          providerId: binding.providerId,
          exposedModelId: binding.exposedModelId,
          routeGroupId: binding.routeGroupId,
          upstreamModel: binding.upstreamModel,
          capabilities: binding.capabilities,
          capabilityProfile: binding.capabilityProfile,
          reasoningProfile: baseRoute.reasoningProfile,
          longConversationStrategy: baseRoute.longConversationStrategy,
          instructionRole: baseRoute.instructionRole,
          requestOverrides: baseRoute.requestOverrides,
          requestHeaders: binding.requestHeadersByAccount?.[accountName] ?? baseRoute.requestHeaders,
          proxyUrl: binding.proxyUrlByAccount?.[accountName] ?? baseRoute.proxyUrl,
          enabled: true,
          createdAt: previousRoute?.createdAt ?? now,
          updatedAt: now,
        };
        await this.admin<void>(`/admin/routes/${encodeURIComponent(routeId)}`, {
          method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(modelRoute),
        });
        const localRouteToken = tokens.routes[routeId] || randomBytes(32).toString("hex");
        if (shouldHydrateRouteSecret(account)) {
          await this.admin<void>(`/admin/routes/${encodeURIComponent(routeId)}/secret`, {
            method: "PUT", headers: { "content-type": "application/json" },
            body: JSON.stringify({
              upstreamApiKey: account.apiKey ?? "",
              localRouteToken,
              authMode: resolveRouteAuthMode(account),
              accountId: account.authAccountId,
            }),
          });
          tokens.routes[routeId] = localRouteToken;
        }
        routes.push(modelRoute);
      }
    }
    // Reconfiguration must not leave removed model bindings routable.  Keep
    // pool-owned routes because the pool lifecycle owns those records.
    const pool = (await this.listAccountPools()).find((item) => item.envName === envName && item.enabled);
    const poolRouteIds = new Set(pool?.members.map((member) => member.routeId) ?? []);
    const staleModelRouteIds = new Set<string>();
    if (previous) {
      for (const staleRouteId of previous.routeIds) {
        if (!baseRoutes.some((route) => route.routeId === staleRouteId)
          && !modelRouteIds.has(staleRouteId)
          && !poolRouteIds.has(staleRouteId)) {
          staleModelRouteIds.add(staleRouteId);
          await this.admin<void>(`/admin/routes/${encodeURIComponent(staleRouteId)}`, { method: "DELETE" }).catch(() => undefined);
          delete tokens.routes[staleRouteId];
        }
      }
    }
    for (let index = routes.length - 1; index >= 0; index -= 1) {
      if (staleModelRouteIds.has(routes[index]!.routeId)) routes.splice(index, 1);
    }
    await this.writeRouteTokens(tokens);
    if (!routes.length) throw new Error(`Environment '${envName}' has no routes for gateway`);
    const now = Date.now();
    const routeGroups = Object.values(routeGroupDefinitions).map((group) => ({
      id: group.id,
      exposedModelId: group.exposedModelId,
      routeIds: routes.filter((route) =>
        route.routeGroupId === group.id || group.accountNames?.includes(route.accountName),
      ).map((route) => route.routeId),
      strategy: group.strategy,
      sessionPolicy: group.sessionPolicy,
      fallbackEnabled: group.fallbackEnabled,
      ...(group.nestedGroupIds?.length ? { nestedGroupIds: group.nestedGroupIds } : {}),
      capabilities: group.capabilities,
    })).filter((group) => group.routeIds.length > 0 || Boolean(group.nestedGroupIds?.length));
    const preferredGroup = defaultRouteGroupId
      ? routeGroups.find((group) => group.id === defaultRouteGroupId)
      : routeGroups[0];
    const modelRoute = modelRouteIds.size
      ? routes.find((route) => route.routeId === previous?.defaultRouteId && modelRouteIds.has(route.routeId))
        ?? routes.find((route) => route.routeGroupId === preferredGroup?.id && modelRouteIds.has(route.routeId))
        ?? routes.find((route) => modelRouteIds.has(route.routeId))
      : undefined;
    const defaultRoute = modelRoute ?? (previous?.defaultRouteId
      ? routes.find((route) => route.routeId === previous.defaultRouteId)
      : undefined) ?? routes[0];
    const gateway: EnvironmentGateway = {
      gatewayId: previous?.gatewayId ?? createEnvironmentGatewayId(envName),
      envName,
      routeIds: routes.map((route) => route.routeId),
      routeGroups: Object.fromEntries(routeGroups.map((group) => [group.id, group])),
      ...(routeRules.length ? { routeRules } : {}),
      defaultRouteId: defaultRoute?.routeId,
      ...(pool ? { poolId: pool.poolId } : {}),
      ...(previous?.localAgentAccessEnabled ? { localAgentAccessEnabled: true } : {}),
      enabled: true,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    const localBaseUrl = buildLocalGatewayBaseUrl(state.port, gateway.gatewayId);
    const changed: string[] = [];
    try {
      await this.admin<void>("/admin/gateways", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(gateway),
      });
      const tokens = await this.readRouteTokens();
      tokens.gateways ??= {};
      const accessToken = tokens.gateways[gateway.gatewayId] || randomBytes(32).toString("hex");
      tokens.gateways[gateway.gatewayId] = accessToken;
      await this.writeRouteTokens(tokens);
      await this.admin<void>(`/admin/gateways/${encodeURIComponent(gateway.gatewayId)}/access`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: gateway.localAgentAccessEnabled === true, token: accessToken }),
      });
      for (const accountName of new Set(routes.map((route) => route.accountName))) {
        const route = baseRouteByAccount.get(accountName);
        if (!route) continue;
        await updateBaseUrl(accountName, localBaseUrl);
        changed.push(accountName);
      }
      return {
        ...routeStatus,
        gatewayEnabled: true,
        gatewayId: gateway.gatewayId,
        localGatewayBaseUrl: localBaseUrl,
        localAgentAccessEnabled: gateway.localAgentAccessEnabled === true,
        ...(gateway.localAgentAccessEnabled ? {
          localAgentBaseUrl: `${localBaseUrl}/v1`,
          localAgentModelsUrl: `${localBaseUrl}/v1/models`,
          localAgentAccessToken: accessToken,
        } : {}),
      };
    } catch (error) {
      await Promise.allSettled(routes.filter((route) => changed.includes(route.accountName)).map((route) =>
        updateBaseUrl(route.accountName, route.originalBaseUrl)));
      await this.admin<void>(`/admin/gateways/${encodeURIComponent(gateway.gatewayId)}`, { method: "DELETE" }).catch(() => undefined);
      throw error;
    }
  }

  async disableEnvironmentGateway(
    envName: string,
    updateBaseUrl: (accountName: string, baseUrl: string) => Promise<void>,
  ): Promise<EnvironmentRouteStatus> {
    const gateways = await this.admin<EnvironmentGateway[]>("/admin/gateways");
    const gateway = gateways.find((item) => item.envName === envName && item.enabled);
    if (!gateway) return this.disableEnvironment(envName, updateBaseUrl);
    const routes = (await this.listRoutes()).filter((route) => gateway.routeIds.includes(route.routeId));
    const state = await this.readState();
    const pool = (await this.listAccountPools()).find((item) => item.envName === envName && item.enabled);
    const poolRouteIds = new Set(pool?.members.map((member) => member.routeId) ?? []);
    const restoredBaseUrl = pool && state ? pool.localBaseUrl ?? buildLocalPoolBaseUrl(state.port, pool.poolId) : undefined;
    for (const route of routes) await updateBaseUrl(route.accountName, restoredBaseUrl ?? route.originalBaseUrl);
    await this.admin<void>(`/admin/gateways/${encodeURIComponent(gateway.gatewayId)}`, { method: "DELETE" });
    await this.deleteRoutes(routes.filter((route) => !poolRouteIds.has(route.routeId)));
    if (pool && state) {
      return { envName, enabled: true, routedAccounts: pool.members.length, port: state.port,
        poolEnabled: true, poolId: pool.poolId, poolMemberCount: pool.members.length, poolReadyMembers: pool.readyMembers,
        gatewayEnabled: false, gatewayId: gateway.gatewayId };
    }
    return { envName, enabled: false, routedAccounts: 0, port: null,
      gatewayEnabled: false, gatewayId: gateway.gatewayId };
  }

  async removeAccountRoutes(envName: string, accountName: string): Promise<number> {
    return this.removeRoutesMatching((route) => route.envName === envName && route.accountName === accountName);
  }

  async removeEnvironmentRoutes(envName: string): Promise<number> {
    return this.removeRoutesMatching((route) => route.envName === envName);
  }

  async enableAccountCompatibility(
    account: RoutableAccount,
    updateRuntime: (value: { baseUrl: string; localRouteToken: string }) => Promise<void>,
  ): Promise<AccountRouteStatus> {
    if (account.authMode === "auth") throw new Error("Chat compatibility requires an API-key account");
    if (!account.apiKey?.trim()) throw new Error("Account API key is required");
    const upstreamBaseUrl = normalizeUpstreamBaseUrl(account.baseUrl === "default" ? "https://api.openai.com/v1" : account.baseUrl);
    if (!upstreamBaseUrl) throw new Error("Account Base URL is required");
    const state = await this.ensureService();
    const routeId = createRouteId(account.envName, account.accountName, upstreamBaseUrl);
    const previous = (await this.listRoutes()).find((route) => route.routeId === routeId);
    const now = Date.now();
    const route: RouteTarget = { routeId, envName: account.envName, accountName: account.accountName,
      upstreamBaseUrl, originalBaseUrl: account.baseUrl, protocol: "chat_completions",
      providerId: account.providerId ?? previous?.providerId,
      upstreamModel: account.upstreamModel, reasoningProfile: account.reasoningProfile ?? "auto",
      longConversationStrategy: account.longConversationStrategy ?? "safe",
      instructionRole: account.instructionRole ?? "auto",
      requestOverrides: account.requestOverrides, requestHeaders: account.requestHeaders,
      proxyUrl: account.proxyUrl,
      enabled: true, createdAt: previous?.createdAt ?? now, updatedAt: now };
    const tokens = await this.readRouteTokens();
    const localRouteToken = tokens.routes[routeId] || randomBytes(32).toString("hex");
    try {
      await this.admin<void>(`/admin/routes/${encodeURIComponent(routeId)}`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(route),
      });
      await this.admin<void>(`/admin/routes/${encodeURIComponent(routeId)}/secret`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ upstreamApiKey: account.apiKey, localRouteToken }),
      });
      tokens.routes[routeId] = localRouteToken; await this.writeRouteTokens(tokens);
      await updateRuntime({ baseUrl: buildLocalRouteBaseUrl(state.port, routeId), localRouteToken });
      return { envName: account.envName, accountName: account.accountName, enabled: true, state: "ready", routeId,
        localBaseUrl: buildLocalRouteBaseUrl(state.port, routeId) };
    } catch (error) {
      await this.admin<void>(`/admin/routes/${encodeURIComponent(routeId)}`, { method: "DELETE" }).catch(() => undefined);
      throw error;
    }
  }

  async disableAccountCompatibility(
    envName: string,
    accountName: string,
    restoreRuntime: (originalBaseUrl: string) => Promise<void>,
  ): Promise<AccountRouteStatus> {
    const route = (await this.listRoutes()).find((item) => item.envName === envName && item.accountName === accountName && item.protocol === "chat_completions");
    if (!route) return { envName, accountName, enabled: false, state: "disabled" };
    await restoreRuntime(route.originalBaseUrl);
    await this.admin<void>(`/admin/routes/${encodeURIComponent(route.routeId)}`, { method: "DELETE" });
    const tokens = await this.readRouteTokens(); delete tokens.routes[route.routeId]; await this.writeRouteTokens(tokens);
    return { envName, accountName, enabled: false, state: "disabled" };
  }

  async getAccountCompatibilityStatuses(accountKeys: string[]): Promise<AccountRouteStatus[]> {
    const routes = await this.listRoutesIfRunning();
    return Promise.all(accountKeys.map(async (key) => {
      const [envName, ...rest] = key.split("/"); const accountName = rest.join("/");
      const route = routes.find((item) => item.envName === envName && item.accountName === accountName && item.protocol === "chat_completions");
      if (!route) return { envName, accountName, enabled: false, state: "disabled" };
      const hydrated = await this.admin<{ hydrated: boolean }>(`/admin/routes/${encodeURIComponent(route.routeId)}/status`)
        .then((value) => value.hydrated).catch(() => false);
      return { envName, accountName, enabled: true, state: hydrated ? "ready" : "degraded", routeId: route.routeId,
        message: hydrated ? undefined : "Route credentials require rehydration" };
    }));
  }

  async checkAccountCompatibility(envName: string, accountName: string): Promise<CompatibilityCheckResult> {
    const state = await this.ensureService();
    const route = (await this.listRoutes()).find((item) => item.envName === envName && item.accountName === accountName && item.protocol === "chat_completions");
    if (!route) return { ok: false, status: 404, message: "Compatibility route is not enabled", state: "failed",
      checkedAt: Date.now(), probes: [], capabilities: { text: false, streaming: false, sequentialTools: false, parallelTools: false, reasoning: false } };
    const token = (await this.readRouteTokens()).routes[route.routeId];
    if (!token) return { ok: false, status: 503, message: "Compatibility route token is unavailable", state: "failed",
      checkedAt: Date.now(), probes: [], capabilities: { text: false, streaming: false, sequentialTools: false, parallelTools: false, reasoning: false } };
    const endpoint = `${buildLocalRouteBaseUrl(state.port, route.routeId)}/responses`;
    const execute = async (body: Record<string, unknown>, signal: AbortSignal) => {
      const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ model: route.upstreamModel ?? "gpt-4.1-mini", max_output_tokens: 32, ...body }), signal });
      const content = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${content}`);
      return { response, content };
    };
    const result = await runCompatibilityCheck({ probe: async (stage, signal) => {
      if (stage === "auth" || stage === "text") {
        const { content } = await execute({ input: buildResponsesTestInput("Reply with OK.") }, signal);
        if (!content.includes("output_text")) throw new Error("No text output");
      } else if (stage === "stream") {
        const { content } = await execute({ input: buildResponsesTestInput("Reply with OK."), stream: true }, signal);
        if (!content.includes("response.output_text.delta")) throw new Error("No streaming text delta");
      } else if (stage === "sequential_tool") {
        const first = await execute({ input: buildResponsesTestInput("Call echo_probe once."), tools: [{ type: "function", name: "echo_probe",
          description: "Echo a value", parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"] } }],
          tool_choice: { type: "function", name: "echo_probe" } }, signal);
        const payload = JSON.parse(first.content) as { id?: string; output?: Array<Record<string, unknown>> };
        const call = payload.output?.find((item) => item.type === "function_call");
        if (!payload.id || typeof call?.call_id !== "string") throw new Error("No sequential tool call");
        await execute({ previous_response_id: payload.id, input: [{ type: "function_call_output", call_id: call.call_id, output: "probe-ok" }] }, signal);
      } else if (stage === "parallel_tool") {
        const { content } = await execute({ input: buildResponsesTestInput("Call echo_a and echo_b."), tools: ["echo_a", "echo_b"].map((name) => ({
          type: "function", name, parameters: { type: "object", properties: {} },
        })), tool_choice: "required" }, signal);
        const payload = JSON.parse(content) as { output?: Array<Record<string, unknown>> };
        if ((payload.output?.filter((item) => item.type === "function_call").length ?? 0) < 2) throw new Error("No parallel tool calls");
      } else {
        const { content } = await execute({ input: buildResponsesTestInput("Think briefly, then answer OK."), reasoning: { effort: "low" } }, signal);
        const payload = JSON.parse(content) as { output?: Array<Record<string, unknown>> };
        if (!payload.output?.some((item) => item.type === "reasoning")) throw new Error("No explicit reasoning item");
      }
    } });
    return { ...result, ok: result.state !== "failed", status: result.state === "failed" ? 422 : 200,
      message: result.state === "ready" ? "All compatibility checks passed" : result.state === "degraded"
        ? "Core compatibility passed with optional limitations" : "A required compatibility check failed" };
  }

  async testModelRequest(input: ModelRequestTestInput): Promise<ModelRequestTestResult> {
    const envName = input.envName.trim();
    const accountName = input.accountName.trim();
    const requestedModel = input.model.trim();
    const upstreamModel = input.upstreamModel?.trim() || requestedModel;
    const prompt = input.prompt?.trim() || "你是什么模型";
    if (!envName || !accountName || !requestedModel) {
      return { ok: false, status: 400, message: "Environment, account, and model are required", latencyMs: 0, model: requestedModel };
    }

    const state = await this.ensureService();
    const [gateways, routes] = await Promise.all([
      this.listEnvironmentGateways(),
      this.listRoutes(),
    ]);
    const gateway = gateways.find((candidate) => candidate.envName === envName && candidate.enabled);
    const routeCandidates = routes
      .filter((candidate) => candidate.envName === envName && candidate.accountName === accountName && candidate.enabled)
      .sort((left, right) => Number(right.upstreamModel === upstreamModel) - Number(left.upstreamModel === upstreamModel));
    const route = routeCandidates[0];
    if (!gateway && !route) {
      return { ok: false, status: 404, message: `No active route for account '${envName}/${accountName}'`, latencyMs: 0, model: requestedModel };
    }

    const headers = new Headers({ "content-type": "application/json" });
    let endpoint: string;
    let body: Record<string, unknown>;
    if (gateway) {
      endpoint = `${buildLocalGatewayBaseUrl(state.port, gateway.gatewayId)}/responses`;
      // HTTP header values are ByteStrings. Account aliases are user-defined and
      // may contain CJK or other Unicode characters, so keep the routing hint
      // ASCII-safe and let the local router decode it before route selection.
      headers.set("x-codex-account", encodeURIComponent(accountName));
      headers.set("x-codex-account-encoding", "uri");
      body = { model: requestedModel, input: buildResponsesTestInput(prompt), max_output_tokens: 64 };
    } else {
      const protocol: RouteProtocol = route!.protocol;
      const routeBase = buildLocalRouteBaseUrl(state.port, route!.routeId);
      if (protocol === "anthropic") {
        endpoint = `${routeBase}/messages`;
        body = { model: upstreamModel, max_tokens: 64, messages: [{ role: "user", content: prompt }] };
      } else if (protocol === "gemini") {
        endpoint = `${routeBase}/v1beta/models/${encodeURIComponent(upstreamModel)}:generateContent`;
        body = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
      } else {
        endpoint = `${routeBase}/responses`;
        body = { model: upstreamModel, input: buildResponsesTestInput(prompt), max_output_tokens: 64 };
        if (protocol === "chat_completions") {
          const token = (await this.readRouteTokens()).routes[route!.routeId];
          if (token) headers.set("authorization", `Bearer ${token}`);
        }
      }
    }

    const startedAt = Date.now();
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      return collectModelTestResult(response, requestedModel, startedAt);
    } catch (error) {
      return { ok: false, status: 502, message: error instanceof Error ? error.message : String(error), latencyMs: Date.now() - startedAt, model: requestedModel };
    }
  }

  /**
   * Test an unsaved account/model binding through an isolated, short-lived
   * Gateway document. The live Gateway and catalog are never changed.
   */
  async testModelRequestPreview(input: ModelRequestPreviewInput): Promise<ModelRequestTestResult> {
    const envName = input.envName.trim();
    const accountName = input.accountName.trim();
    const requestedModel = input.model.trim();
    const prompt = input.prompt?.trim() || "你是什么模型";
    if (!envName || !accountName || !requestedModel || !input.route.routeId || !input.route.exposedModelId) {
      return { ok: false, status: 400, message: "Environment, account, model, and preview route are required", latencyMs: 0, model: requestedModel };
    }

    const state = await this.ensureService();
    const previewGatewayId = `preview-${randomUUID()}`;
    const previewGroupId = input.route.routeGroupId?.trim() || `preview-group-${randomUUID()}`;
    const now = Date.now();
    const previewGroup: EnvironmentGatewayRouteGroup = {
      id: previewGroupId,
      exposedModelId: input.route.exposedModelId,
      routeIds: [input.route.routeId],
      strategy: "order",
      sessionPolicy: "off",
      fallbackEnabled: false,
      ...(input.route.capabilities ? { capabilities: input.route.capabilities } : {}),
    };
    const previewGateway: EnvironmentGateway = {
      gatewayId: previewGatewayId,
      envName,
      routeIds: [input.route.routeId],
      routeGroups: { [previewGroupId]: previewGroup },
      defaultRouteId: input.route.routeId,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    const localRouteToken = randomBytes(32).toString("hex");
    const startedAt = Date.now();
    try {
      await this.admin<void>(`/admin/routes/${encodeURIComponent(input.route.routeId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input.route),
      });
      if (input.hydrateRouteSecret !== false) {
        await this.admin<void>(`/admin/routes/${encodeURIComponent(input.route.routeId)}/secret`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            upstreamApiKey: input.upstreamApiKey ?? "",
            localRouteToken,
            authMode: input.authMode ?? "apikey",
            accountId: input.accountId,
          }),
        });
      }
      await this.admin<void>("/admin/gateway-previews", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(previewGateway),
      });
      const headers = new Headers({ "content-type": "application/json" });
      headers.set("x-codex-account", encodeURIComponent(accountName));
      headers.set("x-codex-account-encoding", "uri");
      const response = await fetch(`${buildLocalGatewayBaseUrl(state.port, previewGatewayId).replace("/gateways/", "/gateway-previews/")}/responses`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: requestedModel, input: buildResponsesTestInput(prompt), max_output_tokens: 64 }),
        signal: AbortSignal.timeout(30_000),
      });
      return await collectModelTestResult(response, requestedModel, startedAt);
    } catch (error) {
      return { ok: false, status: 502, message: error instanceof Error ? error.message : String(error), latencyMs: Date.now() - startedAt, model: requestedModel };
    } finally {
      await this.admin<void>(`/admin/gateway-previews/${encodeURIComponent(previewGatewayId)}`, { method: "DELETE" }).catch(() => undefined);
      await this.admin<void>(`/admin/routes/${encodeURIComponent(input.route.routeId)}`, { method: "DELETE" }).catch(() => undefined);
    }
  }

  async enableEnvironment(
    envName: string,
    accounts: RoutableAccount[],
    updateBaseUrl: (accountName: string, baseUrl: string) => Promise<void>,
  ): Promise<EnvironmentRouteStatus> {
    const eligible = resolveCredentialCandidates(accounts, {
      envName,
      protocol: "responses",
    }).candidates;
    if (!eligible.length) throw new Error(`Environment '${envName}' has no compatible credentials`);
    const state = await this.ensureService();
    const existing = await this.listRoutes();
    const tokens = await this.readRouteTokens();
    const changed: Array<{ accountName: string; originalBaseUrl: string; routeId: string }> = [];
    try {
      for (const account of eligible) {
        const prior = existing.find((route) => route.envName === envName && route.accountName === account.accountName);
        const accountBaseUrl = account.baseUrl.trim();
        const originalBaseUrl = isLocalRouterBaseUrl(accountBaseUrl)
          ? prior?.originalBaseUrl || "default"
          : accountBaseUrl || prior?.originalBaseUrl || "default";
        const upstreamBaseUrl = normalizeUpstreamBaseUrl(
          originalBaseUrl === "default"
            ? account.authMode === "auth"
              ? "https://chatgpt.com/backend-api/codex"
              : "https://api.openai.com/v1"
            : originalBaseUrl,
        );
        if (!upstreamBaseUrl) throw new Error(`Account '${envName}/${account.accountName}' has no Base URL`);
        const routeId = createRouteId(envName, account.accountName, upstreamBaseUrl);
        const now = Date.now();
        const route: RouteTarget = {
          routeId, envName, accountName: account.accountName, upstreamBaseUrl,
          originalBaseUrl, protocol: account.protocol ?? prior?.protocol ?? "responses",
          providerId: account.providerId ?? prior?.providerId ?? (account.authMode === "auth" ? "chatgpt" : "openai"),
          exposedModelId: account.upstreamModel
            ? `${account.providerId ?? prior?.providerId ?? (account.authMode === "auth" ? "chatgpt" : "openai")}:${account.upstreamModel}`
            : prior?.exposedModelId,
          routeGroupId: account.upstreamModel
            ? `route-group:${encodeURIComponent(envName)}:${encodeURIComponent(account.upstreamModel)}`
            : prior?.routeGroupId,
          upstreamModel: account.upstreamModel ?? prior?.upstreamModel,
          reasoningProfile: prior?.reasoningProfile ?? "auto",
          longConversationStrategy: prior?.longConversationStrategy ?? "safe",
          instructionRole: prior?.instructionRole ?? "auto",
          requestOverrides: prior?.requestOverrides,
          requestHeaders: account.requestHeaders ?? prior?.requestHeaders,
          proxyUrl: account.proxyUrl ?? prior?.proxyUrl,
          enabled: true, createdAt: prior?.createdAt ?? now, updatedAt: now,
        };
        await this.admin<void>(`/admin/routes/${encodeURIComponent(routeId)}`, {
          method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(route),
        });
        if (shouldHydrateRouteSecret(account)) {
          const localRouteToken = tokens.routes[routeId] || randomBytes(32).toString("hex");
          await this.admin<void>(`/admin/routes/${encodeURIComponent(routeId)}/secret`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              upstreamApiKey: account.apiKey ?? "",
              localRouteToken,
              authMode: resolveRouteAuthMode(account),
              accountId: account.authAccountId,
            }),
          });
          tokens.routes[routeId] = localRouteToken;
        }
        await updateBaseUrl(account.accountName, buildLocalRouteBaseUrl(state.port, routeId));
        if (prior && prior.routeId !== routeId) await this.deleteRoutes([prior]);
        changed.push({ accountName: account.accountName, originalBaseUrl, routeId });
      }
    } catch (error) {
      await Promise.allSettled(changed.map(async (item) => {
        await updateBaseUrl(item.accountName, item.originalBaseUrl);
        await this.admin<void>(`/admin/routes/${encodeURIComponent(item.routeId)}`, { method: "DELETE" });
      }));
      throw error;
    }
    await this.writeRouteTokens(tokens);
    return { envName, enabled: true, routedAccounts: changed.length, port: state.port };
  }

  async disableEnvironment(
    envName: string,
    updateBaseUrl: (accountName: string, baseUrl: string) => Promise<void>,
  ): Promise<EnvironmentRouteStatus> {
    const routes = (await this.listRoutes()).filter((route) => route.envName === envName && route.enabled);
    const restored: RouteTarget[] = [];
    try {
      for (const route of routes) {
        try {
          await updateBaseUrl(route.accountName, route.originalBaseUrl);
          restored.push(route);
        } catch (error) {
          if (this.isMissingAccountError(error, route.envName, route.accountName)) {
            continue;
          }
          throw error;
        }
      }
      await this.deleteRoutes(routes);
    } catch (error) {
      const state = await this.ensureService();
      await Promise.allSettled(restored.map((route) =>
        updateBaseUrl(route.accountName, buildLocalRouteBaseUrl(state.port, route.routeId))));
      throw error;
    }
    return { envName, enabled: false, routedAccounts: 0, port: null };
  }

  queryUsage(filter: UsageFilter): Promise<UsageSnapshot> {
    const query = new URLSearchParams({ from: String(filter.from), to: String(filter.to) });
    if (filter.envName) query.set("envName", filter.envName);
    if (filter.accountName) query.set("accountName", filter.accountName);
    if (filter.baseUrl) query.set("baseUrl", filter.baseUrl);
    if (filter.model) query.set("model", filter.model);
    return this.admin<UsageSnapshot>(`/admin/stats?${query}`);
  }

  queryUsageRequests(filter: UsageRequestQuery): Promise<UsageRequestPage> {
    const query = new URLSearchParams({
      from: String(filter.from), to: String(filter.to),
      page: String(filter.page), pageSize: String(filter.pageSize),
    });
    if (filter.envName) query.set("envName", filter.envName);
    if (filter.accountName) query.set("accountName", filter.accountName);
    if (filter.baseUrl) query.set("baseUrl", filter.baseUrl);
    if (filter.model) query.set("model", filter.model);
    if (filter.endpoint) query.set("endpoint", filter.endpoint);
    if (filter.poolId) query.set("poolId", filter.poolId);
    if (filter.failoverReason) query.set("failoverReason", filter.failoverReason);
    if (filter.status) query.set("status", filter.status);
    if (filter.search) query.set("search", filter.search);
    return this.admin<UsageRequestPage>(`/admin/requests?${query}`);
  }

  async queryRecentAccountHealthIfRunning(limit = 60): Promise<AccountRequestHealth[]> {
    const state = await this.readState();
    if (!state || !await this.isHealthy(state)) return [];
    return this.adminWithState<AccountRequestHealth[]>(state, `/admin/account-health?limit=${Math.min(60, Math.max(1, Math.trunc(limit) || 60))}`);
  }

  listPricing(): Promise<PricingProfile[]> {
    return this.admin<PricingProfile[]>("/admin/pricing");
  }

  upsertPricing(profile: PricingProfile): Promise<void> {
    return this.admin<void>("/admin/pricing", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(profile),
    });
  }
}

function createGatewayModelRouteId(
  envName: string,
  accountName: string,
  upstreamBaseUrl: string,
  providerId: string,
  modelId: string,
): string {
  return createHash("sha256")
    .update(`gateway-model\0${envName}\0${accountName}\0${normalizeUpstreamBaseUrl(upstreamBaseUrl)}\0${providerId}\0${modelId}`)
    .digest("hex")
    .slice(0, 20);
}

function resolveRouteAuthMode(account: RoutableAccount): "auth" | "apikey" | "none" {
  if (account.providerAuthMethod === "none") return "none";
  return account.authMode === "auth" ? "auth" : "apikey";
}

function shouldHydrateRouteSecret(account: RoutableAccount): boolean {
  return account.providerAuthMethod === "none" || Boolean(account.apiKey?.trim());
}
