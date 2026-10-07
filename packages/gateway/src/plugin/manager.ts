import { join } from "node:path";

import { ProviderRegistry } from "../provider/registry.js";
import {
  PluginInstallationStore,
  type InstalledPlugin,
  type PluginCommandRunner,
  type PluginInstallSource,
} from "./market.js";
import {
  PluginRuntimeManager,
  type ActivePluginProvider,
  type PluginRuntimeOptions,
} from "./runtime.js";
import type { GatewayPluginManifest } from "./host.js";

export interface ProviderPluginManagerOptions extends Omit<PluginRuntimeOptions, "registry"> {
  rootDir: string;
  registry?: ProviderRegistry;
  verifySignature?: (manifest: GatewayPluginManifest, checksum: string) => boolean | Promise<boolean>;
}

export interface PluginActivationFailure {
  id: string;
  version: string;
  message: string;
}

export interface PluginActivationReport {
  activated: ActivePluginProvider[];
  failed: PluginActivationFailure[];
}

/**
 * Desktop-facing lifecycle coordinator for installed Provider plugins.
 * Installation metadata is persisted beside each version, activation is
 * fail-closed through PluginRuntimeManager, and one broken plugin never
 * prevents the remaining providers from starting.
 */
export class ProviderPluginManager {
  readonly registry: ProviderRegistry;
  readonly installations: PluginInstallationStore;
  readonly runtime: PluginRuntimeManager;

  constructor(private readonly options: ProviderPluginManagerOptions) {
    this.registry = options.registry ?? new ProviderRegistry();
    this.installations = new PluginInstallationStore(join(options.rootDir, "installed"), {
      ...(options.verifySignature ? { verifySignature: options.verifySignature } : {}),
    });
    this.runtime = new PluginRuntimeManager({ ...options, registry: this.registry });
  }

  async activateInstalled(): Promise<PluginActivationReport> {
    const activated: ActivePluginProvider[] = [];
    const failed: PluginActivationFailure[] = [];
    for (const installed of await this.installations.list()) {
      const manifest = installed.manifest;
      if (!manifest) {
        failed.push({ id: installed.id, version: installed.version, message: "Installed plugin manifest is missing or invalid" });
        continue;
      }
      try {
        await this.assertTrustedManifest(manifest, installed.checksum);
        activated.push(await this.runtime.activateInstalled(manifest, installed));
      } catch (error) {
        failed.push({ id: installed.id, version: installed.version, message: error instanceof Error ? error.message : String(error) });
      }
    }
    return { activated, failed };
  }

  async install(
    manifest: GatewayPluginManifest,
    source: PluginInstallSource,
    runCommand?: PluginCommandRunner,
  ): Promise<ActivePluginProvider> {
    const previous = (await this.installations.list()).find((item) => item.id === manifest.id);
    await this.runtime.deactivate(manifest.id);
    let installed: InstalledPlugin | undefined;
    try {
      installed = await this.installations.installFromSource(manifest, source, runCommand);
      await this.assertTrustedManifest(manifest, installed.checksum);
      return await this.runtime.activateInstalled(manifest, installed);
    } catch (error) {
      await this.runtime.deactivate(manifest.id).catch(() => undefined);
      if (installed?.previousVersion) {
        const restored = await this.installations.rollback(manifest.id).catch(() => undefined);
        if (restored?.manifest) await this.runtime.activateInstalled(restored.manifest, restored).catch(() => undefined);
      } else if (previous?.manifest) {
        await this.runtime.activateInstalled(previous.manifest, previous).catch(() => undefined);
      } else {
        await this.installations.remove(manifest.id).catch(() => undefined);
      }
      throw error;
    }
  }

  async deactivate(id: string): Promise<boolean> {
    return this.runtime.deactivate(id);
  }

  async rollback(id: string): Promise<ActivePluginProvider> {
    await this.runtime.deactivate(id);
    const installed = await this.installations.rollback(id);
    if (!installed.manifest) throw new Error(`Plugin '${id}' rollback manifest is missing or invalid`);
    await this.assertTrustedManifest(installed.manifest, installed.checksum);
    return this.runtime.activateInstalled(installed.manifest, installed);
  }

  async remove(id: string): Promise<void> {
    await this.runtime.deactivate(id);
    await this.installations.remove(id);
  }

  listInstalled(): Promise<InstalledPlugin[]> {
    return this.installations.list();
  }

  listActive(): ActivePluginProvider[] {
    return this.runtime.list();
  }

  close(): Promise<void> {
    return this.runtime.close();
  }

  private async assertTrustedManifest(manifest: GatewayPluginManifest, checksum: string | undefined): Promise<void> {
    if (!manifest.signature) return;
    if (!this.options.verifySignature) throw new Error(`Plugin '${manifest.id}' has no configured signature verifier`);
    if (!checksum || !await this.options.verifySignature(manifest, checksum)) {
      throw new Error(`Plugin '${manifest.id}' signature verification failed`);
    }
  }
}
