import { join } from "node:path";
import { ProviderRegistry } from "../provider/registry.js";
import { PluginInstallationStore, } from "./market.js";
import { PluginRuntimeManager, } from "./runtime.js";
/**
 * Desktop-facing lifecycle coordinator for installed Provider plugins.
 * Installation metadata is persisted beside each version, activation is
 * fail-closed through PluginRuntimeManager, and one broken plugin never
 * prevents the remaining providers from starting.
 */
export class ProviderPluginManager {
    options;
    registry;
    installations;
    runtime;
    constructor(options) {
        this.options = options;
        this.registry = options.registry ?? new ProviderRegistry();
        this.installations = new PluginInstallationStore(join(options.rootDir, "installed"), {
            ...(options.verifySignature ? { verifySignature: options.verifySignature } : {}),
        });
        this.runtime = new PluginRuntimeManager({ ...options, registry: this.registry });
    }
    async activateInstalled() {
        const activated = [];
        const failed = [];
        for (const installed of await this.installations.list()) {
            const manifest = installed.manifest;
            if (!manifest) {
                failed.push({ id: installed.id, version: installed.version, message: "Installed plugin manifest is missing or invalid" });
                continue;
            }
            try {
                await this.assertTrustedManifest(manifest, installed.checksum);
                activated.push(await this.runtime.activateInstalled(manifest, installed));
            }
            catch (error) {
                failed.push({ id: installed.id, version: installed.version, message: error instanceof Error ? error.message : String(error) });
            }
        }
        return { activated, failed };
    }
    async install(manifest, source, runCommand) {
        const previous = (await this.installations.list()).find((item) => item.id === manifest.id);
        await this.runtime.deactivate(manifest.id);
        let installed;
        try {
            installed = await this.installations.installFromSource(manifest, source, runCommand);
            await this.assertTrustedManifest(manifest, installed.checksum);
            return await this.runtime.activateInstalled(manifest, installed);
        }
        catch (error) {
            await this.runtime.deactivate(manifest.id).catch(() => undefined);
            if (installed?.previousVersion) {
                const restored = await this.installations.rollback(manifest.id).catch(() => undefined);
                if (restored?.manifest)
                    await this.runtime.activateInstalled(restored.manifest, restored).catch(() => undefined);
            }
            else if (previous?.manifest) {
                await this.runtime.activateInstalled(previous.manifest, previous).catch(() => undefined);
            }
            else {
                await this.installations.remove(manifest.id).catch(() => undefined);
            }
            throw error;
        }
    }
    async deactivate(id) {
        return this.runtime.deactivate(id);
    }
    async rollback(id) {
        await this.runtime.deactivate(id);
        const installed = await this.installations.rollback(id);
        if (!installed.manifest)
            throw new Error(`Plugin '${id}' rollback manifest is missing or invalid`);
        await this.assertTrustedManifest(installed.manifest, installed.checksum);
        return this.runtime.activateInstalled(installed.manifest, installed);
    }
    async remove(id) {
        await this.runtime.deactivate(id);
        await this.installations.remove(id);
    }
    listInstalled() {
        return this.installations.list();
    }
    listActive() {
        return this.runtime.list();
    }
    close() {
        return this.runtime.close();
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