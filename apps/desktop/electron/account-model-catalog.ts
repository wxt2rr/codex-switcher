import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  accountModelBindingKey,
  isModelAvailableForAccount,
  normalizeCustomModelInput,
  type ModelCatalogEntry,
  type ModelCatalogStore,
} from "./model-catalog-store.js";
import { resolveProviderModelPreset } from "./provider-model-presets.js";
import { buildGatewayModelCatalog } from "./gateway-model-catalog.js";
import type { GatewayEnvironmentState } from "../../../packages/core/dist/gateway/model.js";

const execFileAsync = promisify(execFile);

export interface BundledModelCatalog {
  models: ModelCatalogEntry[];
}

export function buildBundledCatalogCommand(
  codexBin: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(codexBin)) {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", `"${codexBin.replaceAll('"', '""')}" debug models --bundled`],
    };
  }
  return { command: codexBin, args: ["debug", "models", "--bundled"] };
}

export async function loadBundledModelCatalog(codexBin: string): Promise<BundledModelCatalog> {
  const invocation = buildBundledCatalogCommand(codexBin);
  const { stdout } = await execFileAsync(invocation.command, invocation.args, {
    timeout: 20_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout) as unknown;
  const models = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.models)
      ? parsed.models
      : undefined;
  if (!models) throw new Error("Codex returned an invalid bundled model catalog");
  return { models: models.map(normalizeCodexCatalogEntry) };
}

export async function synchronizeAccountModelCatalog(options: {
  envName: string;
  accountName: string;
  homePath: string;
  store: ModelCatalogStore;
  loadBundledCatalog?: () => Promise<BundledModelCatalog>;
  providerId?: string;
  baseUrl?: string;
  model?: string;
  diagnosticLogPath?: string;
  environmentName?: string;
}): Promise<{ enabled: boolean; catalogPath?: string; preset?: string }> {
  const snapshot = await options.store.load();
  const bindingIds = snapshot.accountBindings[
    accountModelBindingKey(options.envName, options.accountName)
  ] ?? [];
  const configPath = join(options.homePath, "config.toml");
  const catalogPath = join(options.homePath, "model-catalogs", "codex-switcher-models.json");
  const configuredModel = options.model ?? await readConfiguredModel(configPath);
  const accountKey = accountModelBindingKey(options.envName, options.accountName);
  const hasDiscoverySnapshot = Boolean(snapshot.accountModelDiscoveries?.[accountKey]);
  const preset = resolveProviderModelPreset({
    providerId: options.providerId,
    baseUrl: options.baseUrl,
    model: configuredModel,
  });

  // Keep the legacy preset path for accounts created before account-scoped
  // discovery existed. Once a discovery snapshot exists, the explicit
  // exposure selection is authoritative and must never be bypassed by a
  // provider preset.
  if (preset && !hasDiscoverySnapshot) {
    await writePresetModelCatalog(join(options.homePath, preset.catalogPath), preset.entries);
    await setModelCatalogConfig(configPath, join(options.homePath, preset.catalogPath));
    await rm(catalogPath, { force: true });
    const result = { enabled: true, catalogPath: join(options.homePath, preset.catalogPath), preset: preset.providerId };
    await appendCatalogDiagnostic(options.diagnosticLogPath, { environmentName: options.environmentName, mode: "account", status: "synchronized", catalogPath: result.catalogPath, modelCount: preset.entries.length, preset: preset.providerId });
    return result;
  }

  if (bindingIds.length === 0) {
    await removeModelCatalogConfig(configPath);
    await rm(catalogPath, { force: true });
    await appendCatalogDiagnostic(options.diagnosticLogPath, { environmentName: options.environmentName, mode: "account", status: "disabled", reason: "no_model_binding" });
    return { enabled: false };
  }

  const byId = new Map(snapshot.models.map((model) => [model.id, model]));
  const customEntries = bindingIds.filter((id) => {
    const model = byId.get(id);
    return model ? isModelAvailableForAccount(snapshot, model, accountModelBindingKey(options.envName, options.accountName)) : false;
  }).map((id) => {
    const model = byId.get(id);
    if (!model) throw new Error(`Bound custom model '${id}' no longer exists`);
    return model.entry;
  });
  const bundled = options.loadBundledCatalog
    ? await options.loadBundledCatalog()
    : { models: [] };
  const catalogEntries = bundled.models.map(normalizeCodexCatalogEntry);
  if (customEntries.length === 0 && catalogEntries.length === 0) {
    await removeModelCatalogConfig(configPath);
    await rm(catalogPath, { force: true });
    await appendCatalogDiagnostic(options.diagnosticLogPath, { environmentName: options.environmentName, mode: "account", status: "disabled", reason: "no_available_model_binding" });
    return { enabled: false };
  }
  const bundledSlugs = new Set(catalogEntries.map((model) => model.slug));
  const collision = customEntries.find((model) => bundledSlugs.has(model.slug));
  if (collision) throw new Error(`Custom model '${collision.slug}' conflicts with a bundled model`);

  await atomicWriteJson(catalogPath, { models: [...catalogEntries, ...customEntries] });
  await setModelCatalogConfig(configPath, catalogPath);
  await appendCatalogDiagnostic(options.diagnosticLogPath, { environmentName: options.environmentName, mode: "account", status: "synchronized", catalogPath, modelCount: catalogEntries.length + customEntries.length });
  return { enabled: true, catalogPath };
}

export async function synchronizeEnvironmentGatewayModelCatalog(options: {
  homePath: string;
  gateway: GatewayEnvironmentState;
  loadBundledCatalog?: () => Promise<BundledModelCatalog>;
  diagnosticLogPath?: string;
  environmentName?: string;
}): Promise<{ enabled: boolean; catalogPath?: string }> {
  const configPath = join(options.homePath, "config.toml");
  const catalogPath = join(options.homePath, "model-catalogs", "codex-switcher-gateway-models.json");
  const gatewayEntries = buildGatewayModelCatalog(options.gateway);
  if (gatewayEntries.length === 0) {
    await removeModelCatalogConfig(configPath);
    await rm(catalogPath, { force: true });
    await appendCatalogDiagnostic(options.diagnosticLogPath, { environmentName: options.environmentName, mode: "gateway", status: "disabled", reason: "no_routable_model" });
    return { enabled: false };
  }

  const bundled = options.loadBundledCatalog ? await options.loadBundledCatalog() : { models: [] };
  const bundledModels = bundled.models.map(normalizeCodexCatalogEntry);
  const bundledSlugs = new Set(bundledModels.map((model) => model.slug));
  const collisions = gatewayEntries.filter((entry) => bundledSlugs.has(entry.slug));
  if (collisions.length) {
    throw new Error(`Gateway model catalog conflicts with bundled models: ${collisions.map((entry) => entry.slug).join(", ")}`);
  }
  try {
    await atomicWriteJson(catalogPath, { models: [...bundledModels, ...gatewayEntries] });
    await setModelCatalogConfig(configPath, catalogPath);
  } catch (error) {
    await appendCatalogDiagnostic(options.diagnosticLogPath, {
      environmentName: options.environmentName,
      mode: "gateway",
      status: "failed",
      reason: "write_failed",
      error: error instanceof Error ? error.message : String(error),
      catalogPath,
    });
    throw error;
  }
  await appendCatalogDiagnostic(options.diagnosticLogPath, { environmentName: options.environmentName, mode: "gateway", status: "synchronized", catalogPath, modelCount: bundledModels.length + gatewayEntries.length, gatewayModelCount: gatewayEntries.length });
  return { enabled: true, catalogPath };
}

async function appendCatalogDiagnostic(path: string | undefined, details: Record<string, unknown>): Promise<void> {
  if (!path) return;
  await appendFile(path, `${JSON.stringify({ at: new Date().toISOString(), event: "model_catalog_sync", ...details })}\n`, { encoding: "utf8", mode: 0o600 }).catch(() => undefined);
}

async function mergeModelCatalogFile(path: string, entries: ModelCatalogEntry[]): Promise<void> {
  const existing = await readFile(path, "utf8").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  });
  let models: ModelCatalogEntry[] = [];
  if (existing.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existing);
    } catch (error) {
      throw new Error(`Failed to read model catalog '${path}': ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.models)) {
      throw new Error(`Model catalog '${path}' must contain a models array`);
    }
    models = parsed.models.map(validateCatalogEntry);
  }

  const knownSlugs = new Set(models.map((model) => model.slug));
  const additions = entries.filter((entry) => !knownSlugs.has(entry.slug));
  if (additions.length === 0) return;
  await atomicWriteJson(path, { models: [...models, ...additions] });
}

async function writePresetModelCatalog(path: string, entries: ModelCatalogEntry[]): Promise<void> {
  await atomicWriteJson(path, { models: [...entries] });
}

async function setModelCatalogConfig(configPath: string, catalogPath: string): Promise<void> {
  const existing = await readFile(configPath, "utf8").catch(() => "");
  const cleaned = removeModelCatalogLine(existing);
  const content = `model_catalog_json = ${JSON.stringify(catalogPath)}${cleaned ? `\n${cleaned}` : ""}\n`;
  await atomicWriteText(configPath, content);
}

async function removeModelCatalogConfig(configPath: string): Promise<void> {
  const existing = await readFile(configPath, "utf8").catch(() => "");
  if (!existing) return;
  const cleaned = removeModelCatalogLine(existing);
  await atomicWriteText(configPath, cleaned ? `${cleaned}\n` : "");
}

function removeModelCatalogLine(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => !/^\s*model_catalog_json\s*=/.test(line))
    .join("\n")
    .trim();
}

async function readConfiguredModel(configPath: string): Promise<string | undefined> {
  const content = await readFile(configPath, "utf8").catch(() => "");
  let insideSection = false;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      insideSection = true;
      continue;
    }
    if (insideSection || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^model\s*=\s*"([^"]+)"\s*(?:#.*)?$/);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await atomicWriteText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function atomicWriteText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, value, "utf8");
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function validateCatalogEntry(value: unknown): ModelCatalogEntry {
  if (!isRecord(value) || typeof value.slug !== "string" || typeof value.display_name !== "string") {
    throw new Error("Codex bundled model catalog contains an invalid entry");
  }
  return value as ModelCatalogEntry;
}

/**
 * Codex rejects a catalog as a whole when one entry misses a required field.
 * Normalize every source at the last write boundary so old cached catalogs,
 * provider presets, and newly discovered models share the same complete shape.
 */
function normalizeCodexCatalogEntry(value: unknown): ModelCatalogEntry {
  return normalizeCustomModelInput(validateCatalogEntry(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
