import { validatePluginManifest, type GatewayPluginManifest } from "./host.js";

/**
 * Host-owned lifecycle for agent integrations.
 *
 * Agent plugins are declarative integrations: the desktop host owns the
 * target application's configuration and secret boundary, so activation does
 * not start an untrusted child process or hand it credential material. The
 * manifest still participates in the same install/trust/enable lifecycle as
 * provider and middleware plugins.
 */
export interface ActivePluginAgent {
  manifest: GatewayPluginManifest;
  path: string;
}

export class PluginAgentRuntimeManager {
  private readonly active = new Map<string, ActivePluginAgent>();

  async activate(manifest: GatewayPluginManifest, path: string): Promise<ActivePluginAgent> {
    const pluginId = manifest.id;
    if (!validatePluginManifest(manifest)) throw new Error(`Plugin '${pluginId}' has an invalid manifest`);
    if (!manifest.permissions.includes("agent")) throw new Error(`Plugin '${manifest.id}' does not declare agent permission`);
    if (!path.trim()) throw new Error(`Plugin '${manifest.id}' has no installation path`);
    if (this.active.has(manifest.id)) throw new Error(`Agent plugin '${manifest.id}' is already active`);
    const active = { manifest, path };
    this.active.set(manifest.id, active);
    return active;
  }

  async deactivate(id: string): Promise<boolean> {
    return this.active.delete(id);
  }

  async close(): Promise<void> {
    this.active.clear();
  }

  list(): ActivePluginAgent[] {
    return [...this.active.values()];
  }
}
