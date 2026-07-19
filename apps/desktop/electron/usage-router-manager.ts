import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  type AccountRequestHealth,
  buildLocalRouteBaseUrl,
  createRouteId,
  normalizeUpstreamBaseUrl,
  type PricingProfile,
  type RouteTarget,
  type UsageFilter,
  type UsageRequestPage,
  type UsageRequestQuery,
  type UsageSnapshot,
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
} from "./account-pool-routing.js";
import { FileHistoryPersistence } from "./openai-chat-compat/history-persistence.js";
import { createUsageStore } from "./usage-store.js";
import { runCompatibilityCheck, type StagedCompatibilityResult } from "./openai-chat-compat/compatibility-check.js";

const REQUIRED_ROUTER_API_VERSION = 9;

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
  baseUrl: string;
  protocol?: RouteTarget["protocol"];
  apiKey?: string;
  authAccountId?: string;
  upstreamModel?: string;
  reasoningProfile?: RouteTarget["reasoningProfile"];
  longConversationStrategy?: RouteTarget["longConversationStrategy"];
  instructionRole?: RouteTarget["instructionRole"];
  requestOverrides?: Record<string, unknown>;
}

export interface AccountPoolInput {
  envName: string;
  protocol: RouteTarget["protocol"];
  accountNames: string[];
  weights?: Record<string, number>;
  sessionTtlMinutes?: number;
  maxFailoverAttempts?: number;
  maxSameAccountFailures?: number;
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

interface RouteTokenFile { routes: Record<string, string>; pools?: Record<string, string>; }

export interface EnvironmentRouteStatus {
  envName: string;
  enabled: boolean;
  routedAccounts: number;
  port: number | null;
  poolEnabled?: boolean;
  poolId?: string;
  poolMemberCount?: number;
  poolReadyMembers?: number;
}

export interface UsageRouterManagerOptions {
  stateDir: string;
  serviceEntryPath: string;
  executablePath?: string;
  preferredPort?: () => number | Promise<number>;
  launchService?: (preferredPort?: number) => Promise<void>;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class UsageRouterManager {
  private readonly routerDir: string;

  constructor(private readonly options: UsageRouterManagerOptions) {
    this.routerDir = join(options.stateDir, "usage-router");
  }

  private tokenPath(): string { return join(this.routerDir, "compatibility-route-tokens.json"); }

  private async readRouteTokens(): Promise<RouteTokenFile> {
    try { return JSON.parse(await readFile(this.tokenPath(), "utf8")) as RouteTokenFile; }
    catch { return { routes: {}, pools: {} }; }
  }

  private async writeRouteTokens(value: RouteTokenFile): Promise<void> {
    await mkdir(this.routerDir, { recursive: true });
    const target = this.tokenPath(); const temporary = `${target}.tmp`;
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, target);
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
    if (existing && await this.isHealthy(existing)) return existing;
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
      if (state && await this.isHealthy(state)) return state;
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

  async enableAccountPool(
    input: AccountPoolInput,
    accounts: RoutableAccount[],
    updateBaseUrl: (accountName: string, baseUrl: string) => Promise<void>,
  ): Promise<AccountPoolStatus> {
    const selected = accounts.filter((account) => input.accountNames.includes(account.accountName));
    if (!selected.length) throw new Error(`Environment '${input.envName}' has no selected pool accounts`);
    if (selected.some((account) => !account.apiKey?.trim())) throw new Error("Account pool members require a bearer credential");
    if (input.protocol === "chat_completions" && selected.some((account) => account.authMode === "auth")) {
      throw new Error("Chat compatibility pools require API-key accounts");
    }
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
        originalBaseUrl: account.baseUrl, upstreamModel: account.upstreamModel,
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
            enabled: true, createdAt: previous?.createdAt ?? now, updatedAt: now,
          };
          await this.admin<void>(`/admin/routes/${encodeURIComponent(member.routeId)}`, {
            method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(route),
          });
        }
        await this.admin<void>(`/admin/pools/${encodeURIComponent(poolId)}/members/${encodeURIComponent(member.accountName)}/secret`, {
          method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({
            upstreamBearerToken: account.apiKey,
            authMode: account.authMode === "auth" ? "auth" : "apikey",
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
    return envNames.map((envName) => {
      const pool = pools.find((item) => item.envName === envName && item.enabled);
      if (pool) return {
        envName, enabled: true, routedAccounts: pool.members.length, port: state.port,
        poolEnabled: true, poolId: pool.poolId, poolMemberCount: pool.members.length, poolReadyMembers: pool.readyMembers,
      };
      const count = routes.filter((route) => route.envName === envName && route.enabled).length;
      return { envName, enabled: count > 0, routedAccounts: count, port: count > 0 ? state.port : null };
    });
  }

  async removeAccountRoutes(envName: string, accountName: string): Promise<number> {
    return this.removeRoutesMatching((route) => route.envName === envName && route.accountName === accountName);
  }

  async removeEnvironmentRoutes(envName: string): Promise<number> {
    return this.removeRoutesMatching((route) => route.envName === envName);
  }

  async enableAccountCompatibility(
    account: RoutableAccount,
    updateRuntime: (value: { baseUrl: string; localRouteToken: string; providerId: string }) => Promise<void>,
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
      upstreamModel: account.upstreamModel, reasoningProfile: account.reasoningProfile ?? "auto",
      longConversationStrategy: account.longConversationStrategy ?? "safe",
      instructionRole: account.instructionRole ?? "auto",
      requestOverrides: account.requestOverrides, enabled: true, createdAt: previous?.createdAt ?? now, updatedAt: now };
    const tokens = await this.readRouteTokens();
    const localRouteToken = tokens.routes[routeId] || randomBytes(32).toString("hex");
    const providerId = `codex_switcher_${routeId}`;
    try {
      await this.admin<void>(`/admin/routes/${encodeURIComponent(routeId)}`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(route),
      });
      await this.admin<void>(`/admin/routes/${encodeURIComponent(routeId)}/secret`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ upstreamApiKey: account.apiKey, localRouteToken }),
      });
      tokens.routes[routeId] = localRouteToken; await this.writeRouteTokens(tokens);
      await updateRuntime({ baseUrl: buildLocalRouteBaseUrl(state.port, routeId), localRouteToken, providerId });
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
        const { content } = await execute({ input: "Reply with OK." }, signal);
        if (!content.includes("output_text")) throw new Error("No text output");
      } else if (stage === "stream") {
        const { content } = await execute({ input: "Reply with OK.", stream: true }, signal);
        if (!content.includes("response.output_text.delta")) throw new Error("No streaming text delta");
      } else if (stage === "sequential_tool") {
        const first = await execute({ input: "Call echo_probe once.", tools: [{ type: "function", name: "echo_probe",
          description: "Echo a value", parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"] } }],
          tool_choice: { type: "function", name: "echo_probe" } }, signal);
        const payload = JSON.parse(first.content) as { id?: string; output?: Array<Record<string, unknown>> };
        const call = payload.output?.find((item) => item.type === "function_call");
        if (!payload.id || typeof call?.call_id !== "string") throw new Error("No sequential tool call");
        await execute({ previous_response_id: payload.id, input: [{ type: "function_call_output", call_id: call.call_id, output: "probe-ok" }] }, signal);
      } else if (stage === "parallel_tool") {
        const { content } = await execute({ input: "Call echo_a and echo_b.", tools: ["echo_a", "echo_b"].map((name) => ({
          type: "function", name, parameters: { type: "object", properties: {} },
        })), tool_choice: "required" }, signal);
        const payload = JSON.parse(content) as { output?: Array<Record<string, unknown>> };
        if ((payload.output?.filter((item) => item.type === "function_call").length ?? 0) < 2) throw new Error("No parallel tool calls");
      } else {
        const { content } = await execute({ input: "Think briefly, then answer OK.", reasoning: { effort: "low" } }, signal);
        const payload = JSON.parse(content) as { output?: Array<Record<string, unknown>> };
        if (!payload.output?.some((item) => item.type === "reasoning")) throw new Error("No explicit reasoning item");
      }
    } });
    return { ...result, ok: result.state !== "failed", status: result.state === "failed" ? 422 : 200,
      message: result.state === "ready" ? "All compatibility checks passed" : result.state === "degraded"
        ? "Core compatibility passed with optional limitations" : "A required compatibility check failed" };
  }

  async enableEnvironment(
    envName: string,
    accounts: RoutableAccount[],
    updateBaseUrl: (accountName: string, baseUrl: string) => Promise<void>,
  ): Promise<EnvironmentRouteStatus> {
    const eligible = accounts.filter((account) => account.envName === envName && account.authMode !== "auth");
    if (!eligible.length) throw new Error(`Environment '${envName}' has no non-AUTH accounts`);
    const state = await this.ensureService();
    const existing = await this.listRoutes();
    const changed: Array<{ accountName: string; originalBaseUrl: string; routeId: string }> = [];
    try {
      for (const account of eligible) {
        const prior = existing.find((route) => route.envName === envName && route.accountName === account.accountName);
        const originalBaseUrl = prior?.originalBaseUrl || account.baseUrl || "default";
        const upstreamBaseUrl = prior?.upstreamBaseUrl || normalizeUpstreamBaseUrl(
          originalBaseUrl === "default" ? "https://api.openai.com/v1" : originalBaseUrl,
        );
        if (!upstreamBaseUrl) throw new Error(`Account '${envName}/${account.accountName}' has no Base URL`);
        const routeId = createRouteId(envName, account.accountName, upstreamBaseUrl);
        const now = Date.now();
        const route: RouteTarget = {
          routeId, envName, accountName: account.accountName, upstreamBaseUrl,
          originalBaseUrl, protocol: prior?.protocol ?? "responses",
          upstreamModel: prior?.upstreamModel,
          reasoningProfile: prior?.reasoningProfile ?? "auto",
          longConversationStrategy: prior?.longConversationStrategy ?? "safe",
          instructionRole: prior?.instructionRole ?? "auto",
          requestOverrides: prior?.requestOverrides,
          enabled: true, createdAt: prior?.createdAt ?? now, updatedAt: now,
        };
        await this.admin<void>(`/admin/routes/${encodeURIComponent(routeId)}`, {
          method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(route),
        });
        await updateBaseUrl(account.accountName, buildLocalRouteBaseUrl(state.port, routeId));
        changed.push({ accountName: account.accountName, originalBaseUrl, routeId });
      }
    } catch (error) {
      await Promise.allSettled(changed.map(async (item) => {
        await updateBaseUrl(item.accountName, item.originalBaseUrl);
        await this.admin<void>(`/admin/routes/${encodeURIComponent(item.routeId)}`, { method: "DELETE" });
      }));
      throw error;
    }
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
