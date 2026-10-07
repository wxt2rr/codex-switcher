import { createBuiltInProviderAdapters } from "./adapters.js";
export class ProviderRegistry {
    adapters = new Map();
    constructor(includeBuiltIns = true) {
        if (includeBuiltIns)
            for (const [id, adapter] of createBuiltInProviderAdapters())
                this.adapters.set(id, adapter);
    }
    register(adapter) {
        if (this.adapters.has(adapter.id))
            throw new Error(`Provider '${adapter.id}' is already registered`);
        this.adapters.set(adapter.id, adapter);
    }
    replace(adapter) { this.adapters.set(adapter.id, adapter); }
    unregister(id) { return this.adapters.delete(id); }
    get(id) { const adapter = this.adapters.get(id); if (!adapter)
        throw new Error(`Provider '${id}' is not registered`); return adapter; }
    has(id) { return this.adapters.has(id); }
    list() { return [...this.adapters.values()].sort((a, b) => a.id.localeCompare(b.id)); }
    ids() { return this.list().map((adapter) => adapter.id); }
}
//# sourceMappingURL=registry.js.map