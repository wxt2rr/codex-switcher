import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  accountModelBindingKey,
  type ModelCatalogEntry,
  type ModelCatalogStore,
} from "./model-catalog-store.js";

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
}): Promise<{ enabled: boolean; catalogPath?: string }> {
  const snapshot = await options.store.load();
  const bindingIds = snapshot.accountBindings[
    accountModelBindingKey(options.envName, options.accountName)
  ] ?? [];
  const configPath = join(options.homePath, "config.toml");
  const catalogPath = join(options.homePath, "model-catalogs", "codex-switcher-models.json");

  if (bindingIds.length === 0) {
    await removeModelCatalogConfig(configPath);
    await rm(catalogPath, { force: true });
    return { enabled: false };
  }

  const byId = new Map(snapshot.models.map((model) => [model.id, model]));
  const customEntries = bindingIds.map((id) => {
    const model = byId.get(id);
    if (!model) throw new Error(`Bound custom model '${id}' no longer exists`);
    return model.entry;
  });
  const bundled = await options.loadBundledCatalog();
  const bundledSlugs = new Set(bundled.models.map((model) => model.slug));
  const collision = customEntries.find((model) => bundledSlugs.has(model.slug));
  if (collision) throw new Error(`Custom model '${collision.slug}' conflicts with a bundled model`);

  await atomicWriteJson(catalogPath, { models: [...bundled.models, ...customEntries] });
  await setModelCatalogConfig(configPath, catalogPath);
  return { enabled: true, catalogPath };
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
