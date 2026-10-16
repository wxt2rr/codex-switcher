import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import type { GatewayProtocol } from "../protocol.js";
import type { ProviderAuthMethod, ProviderEndpoint } from "../provider/adapters.js";
import { ProviderRegistry } from "../provider/registry.js";
import { PluginConcurrencyLimiter, PluginHost, ProcessPluginTransport, RestartingPluginTransport, validatePluginManifest, type GatewayPluginManifest, type PluginHostOptions, type PluginLogSink, type PluginTransport } from "./host.js";
import { createPluginProviderAdapter } from "./provider-adapter.js";
import type { InstalledPlugin } from "./market.js";
import type { PluginSandboxOptions } from "./sandbox.js";

export interface PluginProviderDescriptor {
  id: string;
  displayName: string;
  authMethods: ProviderAuthMethod[];
  endpoints: ProviderEndpoint[];
  managed?: boolean;
  managementUrl?: string;
}

export interface PluginRuntimeOptions {
  registry: ProviderRegistry;
  sandbox?: PluginSandboxOptions;
  host?: Omit<PluginHostOptions, "manifest">;
  globalConcurrency?: { maxConcurrent?: number; maxQueue?: number };
  maxRestarts?: number;
  log?: PluginLogSink;
  transportFactory?: (manifest: GatewayPluginManifest, path: string, sandbox: PluginSandboxOptions) => PluginTransport | Promise<PluginTransport>;
  settings?: (pluginId: string) => Promise<Record<string, unknown>> | Record<string, unknown>;
  /** Host-owned writable data root for managed provider plugins. */
  pluginDataDir?: string;
  /** Optional writable fallback for hosts whose primary state directory is not writable. */
  pluginDataFallbackDir?: string;
}

export interface ActivePluginProvider {
  manifest: GatewayPluginManifest;
  path: string;
  descriptor: PluginProviderDescriptor;
  host: PluginHost;
}

/**
 * Turns an installed provider plugin into a live ProviderAdapter. The plugin
 * must first describe its explicit provider contract over RPC; no credential
 * or prompt data is needed for activation.
 */
export class PluginRuntimeManager {
  private readonly active = new Map<string, ActivePluginProvider>();
  private readonly transportFactory: NonNullable<PluginRuntimeOptions["transportFactory"]>;
  private readonly globalConcurrency: PluginConcurrencyLimiter;

  constructor(private readonly options: PluginRuntimeOptions) {
    this.transportFactory = options.transportFactory ?? ((manifest, path, sandbox) => {
      const dataDir = options.pluginDataDir
        ? ensurePluginDataDirectory(options.pluginDataDir, manifest.id, options.pluginDataFallbackDir)
        : undefined;
      const launchSandbox = dataDir
        ? { ...sandbox, writablePaths: [...(sandbox.writablePaths ?? []), dataDir] }
        : sandbox;
      return ProcessPluginTransport.start(
        manifest,
        path,
        dataDir ? { CODEX_SWITCHER_PLUGIN_DATA_DIR: dataDir } : {},
        launchSandbox,
        options.log,
      );
    });
    this.globalConcurrency = new PluginConcurrencyLimiter(options.globalConcurrency);
  }

  async activate(manifest: GatewayPluginManifest, path: string): Promise<ActivePluginProvider> {
    const pluginId = manifest.id;
    if (!validatePluginManifest(manifest)) throw new Error(`Plugin '${pluginId}' has an invalid manifest`);
    if (!path.trim()) throw new Error(`Plugin '${pluginId}' has no installation path`);
    if (this.active.has(pluginId)) throw new Error(`Plugin '${pluginId}' is already active`);
    if (!manifest.permissions.includes("provider")) throw new Error(`Plugin '${pluginId}' does not declare provider permission`);
    const restarting = new RestartingPluginTransport(
      (attempt) => this.transportFactory(manifest, path, this.options.sandbox ?? {}),
      this.options.maxRestarts ?? 2,
    );
    const host = new PluginHost(restarting, {
      ...(this.options.host ?? {}),
      concurrencyLimiter: this.globalConcurrency,
      manifest,
    });
    try {
      const response = await host.call("provider.describe");
      const declaredProviderIds = new Set([
        manifest.id,
        ...(manifest.providers?.map((provider) => provider.id) ?? []),
      ]);
      const descriptor = normalizeProviderDescriptor(response.result, declaredProviderIds);
      const adapter = createPluginProviderAdapter({
        ...descriptor,
        host,
        ...(this.options.settings ? { settings: () => this.options.settings!(manifest.id) } : {}),
      });
      this.options.registry.register(adapter);
      const active: ActivePluginProvider = { manifest, path, descriptor, host };
      this.active.set(manifest.id, active);
      return active;
    } catch (error) {
      await host.close().catch(() => undefined);
      throw error;
    }
  }

  async activateInstalled(manifest: GatewayPluginManifest, installed: InstalledPlugin): Promise<ActivePluginProvider> {
    if (manifest.id !== installed.id || manifest.version !== installed.version) throw new Error("Installed plugin does not match its manifest");
    return this.activate(manifest, installed.path);
  }

  async deactivate(id: string): Promise<boolean> {
    const active = this.active.get(id);
    if (!active) return false;
    this.active.delete(id);
    this.options.registry.unregister(active.descriptor.id);
    await active.host.close();
    return true;
  }

  async close(): Promise<void> {
    for (const id of [...this.active.keys()]) await this.deactivate(id);
    this.globalConcurrency?.close();
  }

  list(): ActivePluginProvider[] { return [...this.active.values()]; }
}

const PLUGIN_DATA_DIRECTORY_FALLBACK_ERRORS = new Set(["EACCES", "ENOTDIR", "EPERM", "EROFS"]);

/**
 * Creates a host-owned writable directory for a managed plugin. Windows users
 * can have an older shared state directory owned by another account or backed
 * by a protected reparse point; keep that directory as the first choice and
 * use the host's explicit fallback when it cannot be created.
 */
export function ensurePluginDataDirectory(root: string, pluginId: string, fallbackRoot?: string): string {
  const primary = join(root, pluginId);
  try {
    mkdirSync(primary, { recursive: true, mode: 0o700 });
    return primary;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (!fallbackRoot || !PLUGIN_DATA_DIRECTORY_FALLBACK_ERRORS.has(code) || samePath(root, fallbackRoot)) throw error;
    const fallback = join(fallbackRoot, pluginId);
    mkdirSync(fallback, { recursive: true, mode: 0o700 });
    return fallback;
  }
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function normalizeProviderDescriptor(value: unknown, expectedIds: ReadonlySet<string>): PluginProviderDescriptor {
  const record = isRecord(value) && isRecord(value.provider) ? value.provider : value;
  if (!isRecord(record) || typeof record.id !== "string" || !expectedIds.has(record.id) || typeof record.displayName !== "string" || !record.displayName.trim()) {
    throw new Error(`Plugin provider descriptor must use a declared provider id (${[...expectedIds].join(", ")})`);
  }
  const authMethods = Array.isArray(record.authMethods)
    ? record.authMethods.filter((method): method is ProviderAuthMethod => method === "api_key" || method === "oauth" || method === "subscription" || method === "none")
    : [];
  if (!authMethods.length) throw new Error(`Plugin provider '${String(record.id)}' must declare an auth method`);
  if (!Array.isArray(record.endpoints) || !record.endpoints.length) throw new Error(`Plugin provider '${String(record.id)}' must declare an endpoint`);
  const endpoints = record.endpoints.flatMap((endpoint): ProviderEndpoint[] => {
    if (!isRecord(endpoint) || !isGatewayProtocol(endpoint.protocol) || typeof endpoint.baseUrl !== "string" || typeof endpoint.modelsPath !== "string") return [];
    return [{ protocol: endpoint.protocol, baseUrl: endpoint.baseUrl, modelsPath: endpoint.modelsPath, ...(typeof endpoint.quotaPath === "string" ? { quotaPath: endpoint.quotaPath } : {}) }];
  });
  if (!endpoints.length) throw new Error(`Plugin provider '${String(record.id)}' has no valid endpoint`);
  const managementUrl = typeof record.managementUrl === "string" && record.managementUrl.trim() ? record.managementUrl : undefined;
  const managed = record.managed === true;
  return { id: String(record.id), displayName: record.displayName, authMethods, endpoints, ...(managed ? { managed: true } : {}), ...(managementUrl ? { managementUrl } : {}) };
}

function isGatewayProtocol(value: unknown): value is GatewayProtocol {
  return value === "responses" || value === "chat_completions" || value === "anthropic" || value === "gemini";
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
