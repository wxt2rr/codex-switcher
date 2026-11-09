import { validatePluginManifest } from "./host.js";
export class PluginAgentRuntimeManager {
    active = new Map();
    async activate(manifest, path) {
        const pluginId = manifest.id;
        if (!validatePluginManifest(manifest))
            throw new Error(`Plugin '${pluginId}' has an invalid manifest`);
        if (!manifest.permissions.includes("agent"))
            throw new Error(`Plugin '${manifest.id}' does not declare agent permission`);
        if (!path.trim())
            throw new Error(`Plugin '${manifest.id}' has no installation path`);
        if (this.active.has(manifest.id))
            throw new Error(`Agent plugin '${manifest.id}' is already active`);
        const active = { manifest, path };
        this.active.set(manifest.id, active);
        return active;
    }
    async deactivate(id) {
        return this.active.delete(id);
    }
    async close() {
        this.active.clear();
    }
    list() {
        return [...this.active.values()];
    }
}
//# sourceMappingURL=agent-runtime.js.map