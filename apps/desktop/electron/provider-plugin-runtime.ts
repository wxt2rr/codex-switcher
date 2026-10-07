import { join } from "node:path";

import type {
  GatewayPluginManifest,
  PluginInstallSource,
  PluginMarketEntry,
} from "../../../packages/gateway/dist/index.js";
import type { ProviderAdapter } from "../../../packages/gateway/dist/provider/adapters.js";
import { loadGatewayPluginRuntime, type GatewayPluginRuntime } from "./core-runtime.js";

export interface ProviderPluginSnapshot {
  id: string;
  name: string;
  version: string;
  active: boolean;
  permissions: string[];
  provider?: {
    id: string;
    displayName: string;
    authMethods: string[];
    endpoints: Array<{ protocol: string; baseUrl: string; modelsPath: string; quotaPath?: string }>;
  };
  error?: string;
}

export interface ProviderPluginInstallRequest {
  manifest: GatewayPluginManifest;
  source: PluginInstallSource;
}

export interface ProviderPluginMarketInstallRequest {
  id: string;
  version?: string;
}

let managerStateDir: string | undefined;
let manager: InstanceType<Awaited<ReturnType<typeof loadGatewayPluginRuntime>>["ProviderPluginManager"]> | undefined;
let managerLoad: Promise<NonNullable<typeof manager>> | undefined;
let activationFailures = new Map<string, string>();

function getPluginSignatureVerifier(verifyPluginManifestSignature: GatewayPluginRuntime["verifyPluginManifestSignature"]) {
  const trustedPublicKeyPem = process.env.CODEX_SWITCHER_PLUGIN_TRUSTED_PUBLIC_KEY?.trim();
  if (!trustedPublicKeyPem) return undefined;
  return (manifest: GatewayPluginManifest, checksum?: string) =>
    verifyPluginManifestSignature(manifest, trustedPublicKeyPem, checksum);
}

/**
 * Owns the desktop process' persistent provider-plugin runtime. The Gateway
 * service and the admin bridge use the same installed state, but activation
 * remains lazy so a normal manual-switching session never starts a plugin.
 */
async function getManager(stateDir: string) {
  if (manager && managerStateDir === stateDir) return manager;
  if (managerLoad && managerStateDir === stateDir) return managerLoad;
  if (manager) await manager.close().catch(() => undefined);
  manager = undefined;
  managerStateDir = stateDir;
  activationFailures = new Map();
  managerLoad = (async () => {
    const runtime = await loadGatewayPluginRuntime();
    const verifySignature = getPluginSignatureVerifier(runtime.verifyPluginManifestSignature);
    const next = new runtime.ProviderPluginManager({
      rootDir: join(stateDir, "provider-plugins"),
      ...(verifySignature ? { verifySignature } : {}),
      log: (line: string) => console.warn(`[provider-plugin] ${line}`),
    });
    const report = await next.activateInstalled();
    for (const failure of report.failed) activationFailures.set(failure.id, failure.message);
    manager = next;
    return next;
  })();
  try {
    return await managerLoad;
  } finally {
    managerLoad = undefined;
  }
}

export async function getProviderPluginAdapter(stateDir: string, providerId: string): Promise<ProviderAdapter | undefined> {
  const registry = (await getManager(stateDir)).registry;
  return registry.has(providerId) ? registry.get(providerId) : undefined;
}

export async function getProviderPluginDescriptor(stateDir: string, providerId: string): Promise<ProviderPluginSnapshot["provider"] | undefined> {
  const active = (await getManager(stateDir)).listActive().find((item) => item.descriptor.id === providerId);
  return active?.descriptor;
}

export async function listProviderPlugins(stateDir: string): Promise<ProviderPluginSnapshot[]> {
  const current = await getManager(stateDir);
  const installed = await current.listInstalled();
  const active = new Map(current.listActive().map((item) => [item.manifest.id, item]));
  return installed.map((item) => {
    const running = active.get(item.id);
    return {
      id: item.id,
      name: item.manifest?.name ?? item.id,
      version: item.version,
      active: Boolean(running),
      permissions: [...(item.manifest?.permissions ?? [])],
      ...(running ? { provider: running.descriptor } : {}),
      ...(activationFailures.has(item.id) ? { error: activationFailures.get(item.id) } : {}),
    };
  });
}

export async function installProviderPlugin(stateDir: string, input: ProviderPluginInstallRequest): Promise<ProviderPluginSnapshot> {
  const current = await getManager(stateDir);
  const running = await current.install(input.manifest, input.source);
  activationFailures.delete(input.manifest.id);
  return {
    id: running.manifest.id,
    name: running.manifest.name,
    version: running.manifest.version,
    active: true,
    permissions: [...running.manifest.permissions],
    provider: running.descriptor,
  };
}

export async function listProviderPluginMarket(stateDir: string): Promise<PluginMarketEntry[]> {
  const runtime = await loadGatewayPluginRuntime();
  const verifySignature = getPluginSignatureVerifier(runtime.verifyPluginManifestSignature);
  return new runtime.PluginMarket(runtime.PluginMarket.cachePath(stateDir), verifySignature ? { verifySignature } : {}).list();
}

export async function refreshProviderPluginMarket(stateDir: string, url: string): Promise<PluginMarketEntry[]> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Provider plugin market URL must use http or https");
  }
  const runtime = await loadGatewayPluginRuntime();
  const verifySignature = getPluginSignatureVerifier(runtime.verifyPluginManifestSignature);
  const market = new runtime.PluginMarket(runtime.PluginMarket.cachePath(stateDir), verifySignature ? { verifySignature } : {});
  return market.update(url, {
    fetchIndex: async (indexUrl) => {
      const response = await fetch(indexUrl, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`Provider plugin market returned HTTP ${response.status}`);
      return response.json() as Promise<unknown>;
    },
  });
}

export async function installProviderPluginFromMarket(
  stateDir: string,
  input: ProviderPluginMarketInstallRequest,
): Promise<ProviderPluginSnapshot> {
  const entry = (await listProviderPluginMarket(stateDir)).find((candidate) =>
    candidate.id === input.id && (input.version === undefined || candidate.version === input.version));
  if (!entry) throw new Error(`Provider plugin market entry '${input.id}${input.version ? `@${input.version}` : ""}' was not found`);
  if (!entry.source) throw new Error(`Provider plugin market entry '${entry.id}@${entry.version}' has no explicit install source`);
  return installProviderPlugin(stateDir, { manifest: entry, source: entry.source });
}

export async function deactivateProviderPlugin(stateDir: string, id: string): Promise<ProviderPluginSnapshot[]> {
  await (await getManager(stateDir)).deactivate(id);
  return listProviderPlugins(stateDir);
}

export async function rollbackProviderPlugin(stateDir: string, id: string): Promise<ProviderPluginSnapshot[]> {
  await (await getManager(stateDir)).rollback(id);
  activationFailures.delete(id);
  return listProviderPlugins(stateDir);
}

export async function removeProviderPlugin(stateDir: string, id: string): Promise<ProviderPluginSnapshot[]> {
  await (await getManager(stateDir)).remove(id);
  activationFailures.delete(id);
  return listProviderPlugins(stateDir);
}

export async function closeProviderPluginRuntime(): Promise<void> {
  if (managerLoad) await managerLoad.catch(() => undefined);
  await manager?.close().catch(() => undefined);
  manager = undefined;
  managerStateDir = undefined;
  managerLoad = undefined;
  activationFailures = new Map();
}
