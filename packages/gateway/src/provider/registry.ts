import { createBuiltInProviderAdapters, type BuiltInProviderId, type ProviderAdapter } from "./adapters.js";

export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  constructor(includeBuiltIns = true) {
    if (includeBuiltIns) for (const [id, adapter] of createBuiltInProviderAdapters()) this.adapters.set(id, adapter);
  }

  register(adapter: ProviderAdapter): void {
    if (this.adapters.has(adapter.id)) throw new Error(`Provider '${adapter.id}' is already registered`);
    this.adapters.set(adapter.id, adapter);
  }

  replace(adapter: ProviderAdapter): void { this.adapters.set(adapter.id, adapter); }
  unregister(id: string): boolean { return this.adapters.delete(id); }
  get(id: string): ProviderAdapter { const adapter = this.adapters.get(id); if (!adapter) throw new Error(`Provider '${id}' is not registered`); return adapter; }
  has(id: string): boolean { return this.adapters.has(id); }
  list(): ProviderAdapter[] { return [...this.adapters.values()].sort((a, b) => a.id.localeCompare(b.id)); }
  ids(): string[] { return this.list().map((adapter) => adapter.id); }
}
