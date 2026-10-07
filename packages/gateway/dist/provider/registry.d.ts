import { type ProviderAdapter } from "./adapters.js";
export declare class ProviderRegistry {
    private readonly adapters;
    constructor(includeBuiltIns?: boolean);
    register(adapter: ProviderAdapter): void;
    replace(adapter: ProviderAdapter): void;
    unregister(id: string): boolean;
    get(id: string): ProviderAdapter;
    has(id: string): boolean;
    list(): ProviderAdapter[];
    ids(): string[];
}
