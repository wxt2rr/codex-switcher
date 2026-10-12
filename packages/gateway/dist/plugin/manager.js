import { join } from "node:path";
import { ProviderRegistry } from "../provider/registry.js";
import { PluginInstallationStore, } from "./market.js";
import { PluginRuntimeManager, } from "./runtime.js";
import { GatewayMiddlewareRegistry } from "./middleware.js";
import { PluginMiddlewareRuntimeManager, } from "./middleware-runtime.js";
import { PluginSettingsStore } from "./settings.js";
/**
 * Desktop-facing lifecycle coordinator for installed Provider plugins.
 * Installation metadata is persisted beside each version, activation is
 * fail-closed through PluginRuntimeManager, and one broken plugin never
 * prevents the remaining providers from starting.
 */
export class ProviderPluginManager {
    options;
    registry;
    middlewareRegistry;
    installations;
    runtime;
    middlewareRuntime;
    settings;
    constructor(options) {
        this.options = options;
        this.registry = options.registry ?? new ProviderRegistry();
        this.middlewareRegistry = options.middlewareRegistry ?? new GatewayMiddlewareRegistry();
        this.settings = options.settingsDir ? new PluginSettingsStore(join(options.settingsDir, "settings.enc.json")) : undefined;
        this.installations = new PluginInstallationStore(join(options.rootDir, "installed"), {
            ...(options.verifySignature ? { verifySignature: options.verifySignature } : {}),
        });
        this.runtime = new PluginRuntimeManager({ ...options, registry: this.registry, ...(this.settings ? { settings: (pluginId) => this.settings.get(pluginId) } : {}) });
        this.middlewareRuntime = new PluginMiddlewareRuntimeManager({ ...options, registry: this.middlewareRegistry });
    }
    async activateInstalled() {
        const activated = [];
        const middlewareActivated = [];
        const failed = [];
        for (const installed of await this.installations.list()) {
            const manifest = installed.manifest;
            if (!manifest) {
                failed.push({ id: installed.id, version: installed.version, message: "Installed plugin manifest is missing or invalid" });
                continue;
            }
            try {
                await this.assertTrustedManifest(manifest, installed.checksum);
                const components = await this.activateInstalledComponents(manifest, installed);
                if (components.provider)
                    activated.push(components.provider);
                if (components.middleware)
                    middlewareActivated.push(components.middleware);
            }
            catch (error) {
                failed.push({ id: installed.id, version: installed.version, message: error instanceof Error ? error.message : String(error) });
            }
        }
        return { activated, middlewareActivated, failed };
    }
    async install(manifest, source, runCommand) {
        const result = await this.installPlugin(manifest, source, runCommand);
        if (!result.provider)
            throw new Error(`Plugin '${manifest.id}' does not expose a provider`);
        return result.provider;
    }
    async installPlugin(manifest, source, runCommand) {
        const previous = (await this.installations.list()).find((item) => item.id === manifest.id);
        await this.deactivate(manifest.id);
        let installed;
        try {
            installed = await this.installations.installFromSource(manifest, source, runCommand);
            await this.assertTrustedManifest(manifest, installed.checksum);
            return await this.activateInstalledComponents(manifest, installed);
        }
        catch (error) {
            await this.deactivate(manifest.id).catch(() => undefined);
            if (installed?.previousVersion) {
                const restored = await this.installations.rollback(manifest.id).catch(() => undefined);
                if (restored?.manifest)
                    await this.activateInstalledComponents(restored.manifest, restored).catch(() => undefined);
            }
            else if (previous?.manifest) {
                await this.activateInstalledComponents(previous.manifest, previous).catch(() => undefined);
            }
            else {
                await this.installations.remove(manifest.id).catch(() => undefined);
            }
            throw error;
        }
    }
    async deactivate(id) {
        const provider = await this.runtime.deactivate(id);
        const middleware = await this.middlewareRuntime.deactivate(id);
        return provider || middleware;
    }
    async activate(id) {
        if (this.runtime.list().some((item) => item.manifest.id === id) || this.middlewareRuntime.list().some((item) => item.id === id)) {
            throw new Error(`Plugin '${id}' is already active`);
        }
        const installed = (await this.installations.list()).find((item) => item.id === id);
        if (!installed?.manifest)
            throw new Error(`Plugin '${id}' is not installed or its manifest is invalid`);
        await this.assertTrustedManifest(installed.manifest, installed.checksum);
        return this.activateInstalledComponents(installed.manifest, installed);
    }
    async rollback(id) {
        const result = await this.rollbackPlugin(id);
        if (!result.provider)
            throw new Error(`Plugin '${id}' does not expose a provider`);
        return result.provider;
    }
    async rollbackPlugin(id) {
        await this.deactivate(id);
        const installed = await this.installations.rollback(id);
        if (!installed.manifest)
            throw new Error(`Plugin '${id}' rollback manifest is missing or invalid`);
        await this.assertTrustedManifest(installed.manifest, installed.checksum);
        return this.activateInstalledComponents(installed.manifest, installed);
    }
    async remove(id) {
        await this.deactivate(id);
        await this.installations.remove(id);
        await this.settings?.clear(id);
    }
    listInstalled() {
        return this.installations.list();
    }
    listActive() {
        return this.runtime.list();
    }
    listActiveMiddleware() {
        return this.middlewareRuntime.list();
    }
    async getSettings(id) {
        return this.settings?.get(id) ?? {};
    }
    async setSettings(id, values) {
        const installed = (await this.installations.list()).find((item) => item.id === id);
        if (!installed?.manifest)
            throw new Error(`Plugin '${id}' is not installed`);
        return this.settings?.set(id, values, installed.manifest.settingsSchema) ?? values;
    }
    async clearSettings(id) {
        await this.settings?.clear(id);
    }
    async close() {
        await this.runtime.close();
        await this.middlewareRuntime.close();
    }
    async activateInstalledComponents(manifest, installed) {
        if (manifest.id !== installed.id || manifest.version !== installed.version)
            throw new Error("Installed plugin does not match its manifest");
        const shouldActivateProvider = manifest.permissions.includes("provider");
        const shouldActivateMiddleware = manifest.permissions.includes("middleware");
        if (!shouldActivateProvider && !shouldActivateMiddleware)
            throw new Error(`Plugin '${manifest.id}' declares no executable capability`);
        let provider;
        let middleware;
        try {
            if (shouldActivateProvider)
                provider = await this.runtime.activateInstalled(manifest, installed);
            if (shouldActivateMiddleware)
                middleware = await this.middlewareRuntime.activate(manifest, installed.path);
            return { ...(provider ? { provider } : {}), ...(middleware ? { middleware } : {}) };
        }
        catch (error) {
            await this.runtime.deactivate(manifest.id).catch(() => undefined);
            await this.middlewareRuntime.deactivate(manifest.id).catch(() => undefined);
            throw error;
        }
    }
    async assertTrustedManifest(manifest, checksum) {
        if (!manifest.signature)
            return;
        if (!this.options.verifySignature)
            throw new Error(`Plugin '${manifest.id}' has no configured signature verifier`);
        if (!checksum || !await this.options.verifySignature(manifest, checksum)) {
            throw new Error(`Plugin '${manifest.id}' signature verification failed`);
        }
    }
}
//# sourceMappingURL=manager.js.map