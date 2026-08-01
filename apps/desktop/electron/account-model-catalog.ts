import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  accountModelBindingKey,
  type ModelCatalogEntry,
  type ModelCatalogStore,
} from "./model-catalog-store.js";
import { resolveProviderModelPreset } from "./provider-model-presets.js";

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
  return { models: models.map(validateCatalogEntry) };
}

export async function synchronizeAccountModelCatalog(options: {
  envName: string;
  accountName: string;
  homePath: string;
  store: ModelCatalogStore;
  loadBundledCatalog: () => Promise<BundledModelCatalog>;
  baseUrl?: string;
  model?: string;
}): Promise<{ enabled: boolean; catalogPath?: string; preset?: string }> {
  const snapshot = await options.store.load();
  const bindingIds = snapshot.accountBindings[
    accountModelBindingKey(options.envName, options.accountName)
  ] ?? [];
  const configPath = join(options.homePath, "config.toml");
  const catalogPath = join(options.homePath, "model-catalogs", "codex-switcher-models.json");
  const configuredModel = options.model ?? await readConfiguredModel(configPath);
  const preset = resolveProviderModelPreset({ baseUrl: options.baseUrl, model: configuredModel });

  if (preset) {
    await mergeModelCatalogFile(join(options.homePath, preset.catalogPath), preset.entries);
  }

  if (bindingIds.length === 0) {
    if (preset) await setModelCatalogConfig(configPath, join(options.homePath, preset.catalogPath));
    else await removeModelCatalogConfig(configPath);
    await rm(catalogPath, { force: true });
    return { enabled: false, preset: preset?.providerId };
  }

  const byId = new Map(snapshot.models.map((model) => [model.id, model]));
  const customEntries = bindingIds.map((id) => {
    const model = byId.get(id);
    if (!model) throw new Error(`Bound custom model '${id}' no longer exists`);
    return model.entry;
  });
  const bundled = await options.loadBundledCatalog();
  const catalogEntries = preset ? [...bundled.models, ...preset.entries] : bundled.models;
  const bundledSlugs = new Set(catalogEntries.map((model) => model.slug));
  const collision = customEntries.find((model) => bundledSlugs.has(model.slug));
  if (collision) throw new Error(`Custom model '${collision.slug}' conflicts with a bundled model`);

  await atomicWriteJson(catalogPath, { models: [...catalogEntries, ...customEntries] });
  await setModelCatalogConfig(configPath, catalogPath);
  return { enabled: true, catalogPath, preset: preset?.providerId };
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
  const temporary = `${path}.tmp`;
  await writeFile(temporary, value, "utf8");
  await rename(temporary, path);
}

function validateCatalogEntry(value: unknown): ModelCatalogEntry {
  if (!isRecord(value) || typeof value.slug !== "string" || typeof value.display_name !== "string") {
    throw new Error("Codex bundled model catalog contains an invalid entry");
  }
  return value as ModelCatalogEntry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
