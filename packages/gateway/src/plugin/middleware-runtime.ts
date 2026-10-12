import { PluginConcurrencyLimiter, PluginHost, ProcessPluginTransport, RestartingPluginTransport, validatePluginManifest, type GatewayPluginManifest, type PluginHostOptions, type PluginLogSink, type PluginTransport } from "./host.js";
import { GatewayMiddlewareRegistry, type ActiveGatewayMiddleware, type GatewayMiddlewareHook } from "./middleware.js";
import type { PluginSandboxOptions } from "./sandbox.js";

export interface PluginMiddlewareRuntimeOptions {
  registry: GatewayMiddlewareRegistry;
  sandbox?: PluginSandboxOptions;
  host?: Omit<PluginHostOptions, "manifest">;
  globalConcurrency?: { maxConcurrent?: number; maxQueue?: number };
  maxRestarts?: number;
  log?: PluginLogSink;
  transportFactory?: (manifest: GatewayPluginManifest, path: string, sandbox: PluginSandboxOptions) => PluginTransport | Promise<PluginTransport>;
}

export class PluginMiddlewareRuntimeManager {
  private readonly active = new Map<string, ActiveGatewayMiddleware>();
  private readonly transportFactory: NonNullable<PluginMiddlewareRuntimeOptions["transportFactory"]>;
  private readonly globalConcurrency: PluginConcurrencyLimiter;

  constructor(private readonly options: PluginMiddlewareRuntimeOptions) {
    this.transportFactory = options.transportFactory ?? ((manifest, path, sandbox) => ProcessPluginTransport.start(manifest, path, {}, sandbox, options.log));
    this.globalConcurrency = new PluginConcurrencyLimiter(options.globalConcurrency);
  }

  async activate(manifest: GatewayPluginManifest, path: string): Promise<ActiveGatewayMiddleware> {
    const pluginId = manifest.id;
    if (!validatePluginManifest(manifest)) throw new Error(`Plugin '${pluginId}' has an invalid manifest`);
    if (!manifest.permissions.includes("middleware")) throw new Error(`Plugin '${manifest.id}' does not declare middleware permission`);
    if (this.active.has(manifest.id)) throw new Error(`Middleware '${manifest.id}' is already active`);
    const transport = new RestartingPluginTransport(
      (attempt) => this.transportFactory(manifest, path, this.options.sandbox ?? {}),
      this.options.maxRestarts ?? 2,
    );
    const host = new PluginHost(transport, {
      ...(this.options.host ?? {}),
      concurrencyLimiter: this.globalConcurrency,
      manifest,
    });
    try {
      const response = await host.call("middleware.describe");
      const descriptor = normalizeMiddlewareDescriptor(response.result);
      const active: ActiveGatewayMiddleware = {
        id: manifest.id,
        name: manifest.name,
        priority: descriptor.priority,
        manifest,
        host,
        hooks: descriptor.hooks,
      };
      this.options.registry.register(active);
      this.active.set(manifest.id, active);
      return active;
    } catch (error) {
      await host.close().catch(() => undefined);
      throw error;
    }
  }

  async deactivate(id: string): Promise<boolean> {
    const active = this.active.get(id);
    if (!active) return false;
    this.active.delete(id);
    this.options.registry.unregister(id);
    await active.host.close();
    return true;
  }

  async close(): Promise<void> {
    for (const id of [...this.active.keys()]) await this.deactivate(id);
    this.globalConcurrency.close();
  }

  list(): ActiveGatewayMiddleware[] { return [...this.active.values()]; }
}

function normalizeMiddlewareDescriptor(value: unknown): { hooks: GatewayMiddlewareHook[]; priority: number } {
  const descriptor = isRecord(value) && isRecord(value.middleware) ? value.middleware : value;
  if (!isRecord(descriptor)) throw new Error("Middleware descriptor is invalid");
  const hooks = Array.isArray(descriptor.hooks)
    ? descriptor.hooks.filter((hook): hook is GatewayMiddlewareHook => hook === "onRequest" || hook === "onEvent" || hook === "onResponse")
    : [];
  if (!hooks.length) throw new Error("Middleware descriptor must expose at least one hook");
  const priority = typeof descriptor.priority === "number" && Number.isFinite(descriptor.priority) ? Math.trunc(descriptor.priority) : 100;
  return { hooks: [...new Set(hooks)], priority };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
