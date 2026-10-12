import type { PluginSettingsSchema } from "./host.js";
/**
 * Small encrypted-at-rest settings store for plugin configuration. Secrets are
 * never sent back to the renderer as plaintext by the desktop bridge. The key
 * is a per-user 0600 file; OS keychain integration can replace this store
 * later without changing the plugin API.
 */
export declare class PluginSettingsStore {
    private readonly filePath;
    private loaded;
    constructor(filePath: string);
    get(pluginId: string): Promise<Record<string, unknown>>;
    set(pluginId: string, values: Record<string, unknown>, schema?: PluginSettingsSchema): Promise<Record<string, unknown>>;
    clear(pluginId: string): Promise<void>;
    private readAll;
    private writeAll;
    private readOrCreateKey;
}
export declare function normalizeSettings(values: Record<string, unknown>, schema?: PluginSettingsSchema): Record<string, unknown>;
