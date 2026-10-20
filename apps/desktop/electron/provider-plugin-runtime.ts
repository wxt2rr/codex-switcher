import { join } from "node:path";
import { dirname } from "node:path";
import { readFile, stat, mkdir, rename, writeFile } from "node:fs/promises";

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
  kind: string[];
  description?: string;
  author?: string;
  homepage?: string;
  icon?: string;
  trust?: string;
  settingsSchema?: unknown;
  middleware?: { hooks: string[]; priority: number };
  provider?: {
    id: string;
    displayName: string;
    authMethods: string[];
    managed?: boolean;
    managementUrl?: string;
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

export interface ProviderPluginDiagnostic {
  pluginId?: string;
  level: "info" | "error";
  phase: "activation" | "install" | "runtime" | "settings" | "market" | "lifecycle";
  message: string;
  at: number;
}

let managerStateDir: string | undefined;
let manager: InstanceType<Awaited<ReturnType<typeof loadGatewayPluginRuntime>>["ProviderPluginManager"]> | undefined;
let managerLoad: Promise<NonNullable<typeof manager>> | undefined;
let activationFailures = new Map<string, string>();
let diagnosticStateDir: string | undefined;
let pluginDiagnostics: ProviderPluginDiagnostic[] = [];
let diagnosticWrite: Promise<void> = Promise.resolve();

const PLUGIN_DIAGNOSTIC_LIMIT = 200;

async function loadPluginDiagnostics(stateDir: string): Promise<void> {
  diagnosticStateDir = stateDir;
  try {
    const parsed = JSON.parse(await readFile(join(stateDir, "provider-plugin-diagnostics.json"), "utf8")) as { entries?: unknown };
    pluginDiagnostics = Array.isArray(parsed.entries)
      ? parsed.entries.filter((entry): entry is ProviderPluginDiagnostic => Boolean(entry && typeof entry === "object" && typeof (entry as ProviderPluginDiagnostic).message === "string" && typeof (entry as ProviderPluginDiagnostic).at === "number")).slice(-PLUGIN_DIAGNOSTIC_LIMIT)
      : [];
  } catch {
    pluginDiagnostics = [];
  }
}

function recordPluginDiagnostic(input: Omit<ProviderPluginDiagnostic, "at">): void {
  const entry: ProviderPluginDiagnostic = { ...input, at: Date.now() };
  pluginDiagnostics = [...pluginDiagnostics, entry].slice(-PLUGIN_DIAGNOSTIC_LIMIT);
  const stateDir = diagnosticStateDir;
  if (!stateDir) return;
  diagnosticWrite = diagnosticWrite.then(async () => {
    await mkdir(stateDir, { recursive: true });
    const path = join(stateDir, "provider-plugin-diagnostics.json");
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, entries: pluginDiagnostics }, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  }).catch(() => undefined);
}

function recordPluginError(pluginId: string | undefined, phase: ProviderPluginDiagnostic["phase"], error: unknown): void {
  recordPluginDiagnostic({
    ...(pluginId ? { pluginId } : {}),
    level: "error",
    phase,
    message: error instanceof Error ? error.message : String(error),
  });
}

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
    await loadPluginDiagnostics(stateDir);
    const runtime = await loadGatewayPluginRuntime();
    const verifySignature = getPluginSignatureVerifier(runtime.verifyPluginManifestSignature);
    const next = new runtime.ProviderPluginManager({
      rootDir: join(stateDir, "provider-plugins"),
      settingsDir: join(stateDir, "provider-plugin-settings"),
      pluginDataDir: resolveProviderPluginDataDir(stateDir),
      ...(process.platform === "win32" ? {
        pluginDataFallbackDir: resolvePluginDataFallbackDir(stateDir),
      } : {}),
      ...(verifySignature ? { verifySignature } : {}),
      log: (line: string) => {
        recordPluginDiagnostic({ level: "info", phase: "runtime", message: line });
        console.warn(`[provider-plugin] ${line}`);
      },
    });
    const report = await next.activateInstalled();
    for (const failure of report.failed) {
      activationFailures.set(failure.id, failure.message);
      recordPluginError(failure.id, "activation", failure.message);
    }
    manager = next;
    return next;
  })();
  try {
    return await managerLoad;
  } finally {
    managerLoad = undefined;
  }
}

/**
 * Returns the shared host-owned data directory used by managed provider
 * plugins. Packaged Windows builds set this to an absolute application-data
 * path before any IPC handler can create a plugin manager. The usage router
 * inherits the same environment variable, so both processes use one store.
 */
export function resolveProviderPluginDataDir(stateDir: string): string {
  if (process.platform !== "win32") return join(stateDir, "provider-plugin-data");
  const configured = process.env.CODEX_SWITCHER_PLUGIN_DATA_DIR?.trim();
  if (configured) return configured;
  return join(
    process.env.LOCALAPPDATA || join(process.env.USERPROFILE || stateDir, "AppData", "Local"),
    "codex-switcher",
    "provider-plugin-data",
  );
}

/**
 * Returns a second Windows location for hosts that cannot create the primary
 * plugin data directory. This remains available for standalone/dev hosts and
 * for older installations that have not set the new absolute directory env.
 */
export function resolvePluginDataFallbackDir(stateDir: string): string {
  const configured = process.env.CODEX_SWITCHER_PLUGIN_DATA_FALLBACK_DIR?.trim();
  if (configured) return join(configured, "provider-plugin-data");
  return join(
    process.env.LOCALAPPDATA || join(process.env.USERPROFILE || stateDir, "AppData", "Local"),
    "codex-switcher",
    "provider-plugin-data",
  );
}

export interface ProviderPluginSettingsSnapshot {
  pluginId: string;
  values: Record<string, unknown>;
  secretKeys: string[];
}

export async function getProviderPluginSettings(stateDir: string, id: string): Promise<ProviderPluginSettingsSnapshot> {
  const current = await getManager(stateDir);
  const installed = (await current.listInstalled()).find((item) => item.id === id);
  if (!installed?.manifest) throw new Error(`Plugin '${id}' is not installed`);
  const values = await current.getSettings(id);
  const secretKeys = Object.entries(installed.manifest.settingsSchema?.properties ?? {})
    .filter(([, property]) => property.secret === true)
    .map(([key]) => key);
  const redacted = { ...values };
  for (const key of secretKeys) if (key in redacted) redacted[key] = "";
  return { pluginId: id, values: redacted, secretKeys };
}

export async function setProviderPluginSettings(stateDir: string, id: string, values: Record<string, unknown>): Promise<ProviderPluginSettingsSnapshot> {
  const current = await getManager(stateDir);
  const installed = (await current.listInstalled()).find((item) => item.id === id);
  if (!installed?.manifest) throw new Error(`Plugin '${id}' is not installed`);
  const previous = await current.getSettings(id);
  const nextValues = { ...values };
  for (const [key, property] of Object.entries(installed.manifest.settingsSchema?.properties ?? {})) {
    if (property.secret && nextValues[key] === "") nextValues[key] = previous[key];
  }
  await current.setSettings(id, nextValues);
  return getProviderPluginSettings(stateDir, id);
}

export async function clearProviderPluginSettings(stateDir: string, id: string): Promise<void> {
  await (await getManager(stateDir)).clearSettings(id);
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
  const activeMiddleware = new Map((current.listActiveMiddleware?.() ?? []).map((item) => [item.id, item]));
  return installed.map((item) => {
    const running = active.get(item.id);
    const middleware = activeMiddleware.get(item.id);
    const manifest = item.manifest;
    return {
      id: item.id,
      name: manifest?.name ?? item.id,
      version: item.version,
      active: Boolean(running || middleware),
      permissions: [...(manifest?.permissions ?? [])],
      kind: [...(manifest?.kind ?? (manifest?.permissions.includes("middleware") ? ["middleware"] : ["provider"]))],
      ...(manifest?.description ? { description: manifest.description } : {}),
      ...(manifest?.author ? { author: manifest.author } : {}),
      ...(manifest?.homepage ? { homepage: manifest.homepage } : {}),
      ...(manifest?.icon ? { icon: manifest.icon } : {}),
      ...(manifest?.trust ? { trust: manifest.trust } : {}),
      ...(manifest?.settingsSchema ? { settingsSchema: manifest.settingsSchema } : {}),
      ...(running ? { provider: running.descriptor } : {}),
      ...(middleware ? { middleware: { hooks: [...middleware.hooks], priority: middleware.priority } } : {}),
      ...(activationFailures.has(item.id) ? { error: activationFailures.get(item.id) } : {}),
    };
  });
}

export async function listProviderPluginDiagnostics(stateDir: string, pluginId?: string): Promise<ProviderPluginDiagnostic[]> {
  await getManager(stateDir);
  return pluginDiagnostics
    .filter((entry) => !pluginId || entry.pluginId === pluginId)
    .slice(-PLUGIN_DIAGNOSTIC_LIMIT)
    .reverse();
}

export async function installProviderPlugin(stateDir: string, input: ProviderPluginInstallRequest): Promise<ProviderPluginSnapshot> {
  const current = await getManager(stateDir);
  let components: Awaited<ReturnType<typeof current.installPlugin>>;
  try {
    components = await current.installPlugin(input.manifest, input.source);
  } catch (error) {
    recordPluginError(input.manifest.id, "install", error);
    throw error;
  }
  activationFailures.delete(input.manifest.id);
  const running = components.provider;
  const middleware = components.middleware;
  if (!running && !middleware) throw new Error(`Plugin '${input.manifest.id}' did not activate a provider or middleware capability`);
  return {
    id: input.manifest.id,
    name: input.manifest.name,
    version: input.manifest.version,
    active: true,
    permissions: [...input.manifest.permissions],
    kind: [...(input.manifest.kind ?? (input.manifest.permissions.includes("middleware") ? ["middleware"] : ["provider"]))],
    ...(input.manifest.description ? { description: input.manifest.description } : {}),
    ...(input.manifest.author ? { author: input.manifest.author } : {}),
    ...(input.manifest.homepage ? { homepage: input.manifest.homepage } : {}),
    ...(input.manifest.icon ? { icon: input.manifest.icon } : {}),
    ...(input.manifest.trust ? { trust: input.manifest.trust } : {}),
    ...(input.manifest.settingsSchema ? { settingsSchema: input.manifest.settingsSchema } : {}),
    ...(running ? { provider: running.descriptor } : {}),
    ...(middleware ? { middleware: { hooks: [...middleware.hooks], priority: middleware.priority } } : {}),
  };
}

export async function activateProviderPlugin(stateDir: string, id: string): Promise<ProviderPluginSnapshot[]> {
  try {
    await (await getManager(stateDir)).activate(id);
  } catch (error) {
    recordPluginError(id, "activation", error);
    throw error;
  }
  activationFailures.delete(id);
  return listProviderPlugins(stateDir);
}

export async function listProviderPluginMarket(stateDir: string): Promise<PluginMarketEntry[]> {
  const runtime = await loadGatewayPluginRuntime();
  const verifySignature = getPluginSignatureVerifier(runtime.verifyPluginManifestSignature);
  const cached = await new runtime.PluginMarket(runtime.PluginMarket.cachePath(stateDir), verifySignature ? { verifySignature } : {}).list();
  const builtin = await loadBuiltinPluginMarketEntries();
  const byId = new Map(cached.map((entry) => [`${entry.id}@${entry.version}`, entry]));
  for (const entry of builtin) if (!byId.has(`${entry.id}@${entry.version}`)) byId.set(`${entry.id}@${entry.version}`, entry);
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name) || right.version.localeCompare(left.version));
}

export async function refreshProviderPluginMarket(stateDir: string, url: string): Promise<PluginMarketEntry[]> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Provider plugin market URL must use http or https");
  }
  const runtime = await loadGatewayPluginRuntime();
  const verifySignature = getPluginSignatureVerifier(runtime.verifyPluginManifestSignature);
  const market = new runtime.PluginMarket(runtime.PluginMarket.cachePath(stateDir), verifySignature ? { verifySignature } : {});
  try {
    return await market.update(url, {
    fetchIndex: async (indexUrl) => {
      const response = await fetch(indexUrl, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`Provider plugin market returned HTTP ${response.status}`);
      return response.json() as Promise<unknown>;
    },
    });
  } catch (error) {
    recordPluginError(undefined, "market", error);
    throw error;
  }
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
  try {
    await (await getManager(stateDir)).deactivate(id);
  } catch (error) {
    recordPluginError(id, "lifecycle", error);
    throw error;
  }
  return listProviderPlugins(stateDir);
}

export async function rollbackProviderPlugin(stateDir: string, id: string): Promise<ProviderPluginSnapshot[]> {
  try {
    await (await getManager(stateDir)).rollback(id);
  } catch (error) {
    recordPluginError(id, "lifecycle", error);
    throw error;
  }
  activationFailures.delete(id);
  return listProviderPlugins(stateDir);
}

export async function removeProviderPlugin(stateDir: string, id: string): Promise<ProviderPluginSnapshot[]> {
  try {
    await (await getManager(stateDir)).remove(id);
  } catch (error) {
    recordPluginError(id, "lifecycle", error);
    throw error;
  }
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
  diagnosticStateDir = undefined;
  pluginDiagnostics = [];
}

async function loadBuiltinPluginMarketEntries(): Promise<PluginMarketEntry[]> {
  const currentFile = typeof __dirname === "string" ? __dirname : join(process.cwd(), "apps", "desktop", "electron");
  const candidates = [
    join(process.resourcesPath ?? "", "plugins", "csw-our-free-model"),
    join(currentFile, "../../..", "plugins", "csw-our-free-model"),
    join(process.cwd(), "plugins", "csw-our-free-model"),
    join(process.cwd(), "..", "..", "plugins", "csw-our-free-model"),
  ];
  for (const root of candidates) {
    try {
      const manifest = JSON.parse(await readFile(join(root, "plugin.json"), "utf8")) as PluginMarketEntry;
      if (!manifest.id || !manifest.entry) continue;
      await stat(join(root, manifest.entry));
      return [{ ...manifest, updatedAt: 0, source: { kind: "local", path: root } }];
    } catch { /* try the next packaged/source location */ }
  }
  return [];
}
