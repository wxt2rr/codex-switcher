import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  buildLocalRouteBaseUrl,
  createRouteId,
  normalizeUpstreamBaseUrl,
  type PricingProfile,
  type RouteTarget,
  type UsageFilter,
  type UsageSnapshot,
} from "./usage-routing-model.js";

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
}

export interface EnvironmentRouteStatus {
  envName: string;
  enabled: boolean;
  routedAccounts: number;
  port: number | null;
}

export interface UsageRouterManagerOptions {
  stateDir: string;
  serviceEntryPath: string;
  executablePath?: string;
  launchService?: () => Promise<void>;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class UsageRouterManager {
  private readonly routerDir: string;

  constructor(private readonly options: UsageRouterManagerOptions) {
    this.routerDir = join(options.stateDir, "usage-router");
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
      return response.ok;
    } catch {
      return false;
    }
  }

  async ensureService(): Promise<RouterStateFile> {
    const existing = await this.readState();
    if (existing && await this.isHealthy(existing)) return existing;

    if (this.options.launchService) {
      await this.options.launchService();
    } else {
      const child = spawn(this.options.executablePath ?? process.execPath, [
        this.options.serviceEntryPath, "--state-dir", this.routerDir,
      ], {
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

  listRoutes(): Promise<RouteTarget[]> {
    return this.admin<RouteTarget[]>("/admin/routes");
  }

  async listRoutesIfRunning(): Promise<RouteTarget[]> {
    const state = await this.readState();
    if (!state || !await this.isHealthy(state)) return [];
    return this.adminWithState<RouteTarget[]>(state, "/admin/routes");
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
    return envNames.map((envName) => {
      const count = routes.filter((route) => route.envName === envName && route.enabled).length;
      return { envName, enabled: count > 0, routedAccounts: count, port: count > 0 ? state.port : null };
    });
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
          originalBaseUrl, enabled: true, createdAt: prior?.createdAt ?? now, updatedAt: now,
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
        await updateBaseUrl(route.accountName, route.originalBaseUrl);
        restored.push(route);
      }
      for (const route of routes) {
        await this.admin<void>(`/admin/routes/${encodeURIComponent(route.routeId)}`, { method: "DELETE" });
      }
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

  listPricing(): Promise<PricingProfile[]> {
    return this.admin<PricingProfile[]>("/admin/pricing");
  }

  upsertPricing(profile: PricingProfile): Promise<void> {
    return this.admin<void>("/admin/pricing", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(profile),
    });
  }
}
