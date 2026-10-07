import type { ProviderAdapter, ProviderAuthMethod, ProviderEndpoint } from "../provider/adapters.js";
import { PluginHost } from "./host.js";
export interface PluginProviderAdapterOptions {
    id: string;
    displayName: string;
    authMethods: readonly ProviderAuthMethod[];
    endpoints: readonly ProviderEndpoint[];
    host: PluginHost;
    random?: () => string;
}
/**
 * Exposes a signed/installed provider plugin through the same adapter
 * contract as built-in providers. The host remains authoritative for
 * permissions and the plugin only receives raw credential material when the
 * manifest explicitly declares `secrets`.
 */
export declare function createPluginProviderAdapter(options: PluginProviderAdapterOptions): ProviderAdapter;
