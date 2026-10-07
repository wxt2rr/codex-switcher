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
}

export interface PluginRuntimeOptions {
  registry: ProviderRegistry;
  sandbox?: PluginSandboxOptions;
  host?: Omit<PluginHostOptions, "manifest">;
  globalConcurrency?: { maxConcurrent?: number; maxQueue?: number };
  maxRestarts?: number;
  log?: PluginLogSink;
  transportFactory?: (manifest: GatewayPluginManifest, path: string, sandbox: PluginSandboxOptions) => PluginTransport | Promise<PluginTransport>;
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
    this.transportFactory = options.transportFactory ?? ((manifest, path, sandbox) => ProcessPluginTransport.start(manifest, path, {}, sandbox, options.log));
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
      const descriptor = normalizeProviderDescriptor(response.result, manifest.id);
      const adapter = createPluginProviderAdapter({ ...descriptor, host });
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

function normalizeProviderDescriptor(value: unknown, expectedId: string): PluginProviderDescriptor {
  const record = isRecord(value) && isRecord(value.provider) ? value.provider : value;
  if (!isRecord(record) || record.id !== expectedId || typeof record.displayName !== "string" || !record.displayName.trim()) {
    throw new Error(`Plugin provider descriptor must use plugin id '${expectedId}'`);
  }
  const authMethods = Array.isArray(record.authMethods)
    ? record.authMethods.filter((method): method is ProviderAuthMethod => method === "api_key" || method === "oauth" || method === "subscription" || method === "none")
    : [];
  if (!authMethods.length) throw new Error(`Plugin provider '${expectedId}' must declare an auth method`);
  if (!Array.isArray(record.endpoints) || !record.endpoints.length) throw new Error(`Plugin provider '${expectedId}' must declare an endpoint`);
  const endpoints = record.endpoints.flatMap((endpoint): ProviderEndpoint[] => {
    if (!isRecord(endpoint) || !isGatewayProtocol(endpoint.protocol) || typeof endpoint.baseUrl !== "string" || typeof endpoint.modelsPath !== "string") return [];
    return [{ protocol: endpoint.protocol, baseUrl: endpoint.baseUrl, modelsPath: endpoint.modelsPath, ...(typeof endpoint.quotaPath === "string" ? { quotaPath: endpoint.quotaPath } : {}) }];
  });
  if (!endpoints.length) throw new Error(`Plugin provider '${expectedId}' has no valid endpoint`);
  return { id: expectedId, displayName: record.displayName, authMethods, endpoints };
}

function isGatewayProtocol(value: unknown): value is GatewayProtocol {
  return value === "responses" || value === "chat_completions" || value === "anthropic" || value === "gemini";
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
