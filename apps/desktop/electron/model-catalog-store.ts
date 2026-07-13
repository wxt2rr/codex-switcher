import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export type ModelCatalogEntry = Record<string, unknown> & {
  slug: string;
  display_name: string;
  description?: string;
};

export interface CustomModelRecord {
  id: string;
  entry: ModelCatalogEntry;
  createdAt: string;
  updatedAt: string;
}

export interface ModelCatalogSnapshot {
  version: 1;
  models: CustomModelRecord[];
  accountBindings: Record<string, string[]>;
}

export interface SaveCustomModelInput {
  id?: string;
  entry: Record<string, unknown>;
}

export interface ModelCatalogStore {
  load(): Promise<ModelCatalogSnapshot>;
  saveModel(input: SaveCustomModelInput): Promise<CustomModelRecord>;
  deleteModel(id: string): Promise<void>;
  setAccountBindings(accountKey: string, modelIds: string[]): Promise<ModelCatalogSnapshot>;
  setModelBindings(modelId: string, accountKeys: string[]): Promise<ModelCatalogSnapshot>;
}

const EMPTY_SNAPSHOT: ModelCatalogSnapshot = { version: 1, models: [], accountBindings: {} };

export function createModelCatalogStore(path: string): ModelCatalogStore {
  return {
    async load() {
      return readSnapshot(path);
    },
    async saveModel(input) {
      const snapshot = await readSnapshot(path);
      const entry = normalizeCustomModelInput(input.entry);
      const duplicate = snapshot.models.find(
        (model) => model.entry.slug === entry.slug && model.id !== input.id,
      );
      if (duplicate) throw new Error(`Model slug '${entry.slug}' already exists`);
      const now = new Date().toISOString();
      const existing = input.id ? snapshot.models.find((model) => model.id === input.id) : undefined;
      if (input.id && !existing) throw new Error(`Model '${input.id}' not found`);
      const record: CustomModelRecord = {
        id: existing?.id ?? randomUUID(),
        entry,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      snapshot.models = existing
        ? snapshot.models.map((model) => (model.id === record.id ? record : model))
        : [...snapshot.models, record];
      await writeSnapshot(path, snapshot);
      return record;
    },
    async deleteModel(id) {
      const snapshot = await readSnapshot(path);
      if (!snapshot.models.some((model) => model.id === id)) throw new Error(`Model '${id}' not found`);
      snapshot.models = snapshot.models.filter((model) => model.id !== id);
      snapshot.accountBindings = Object.fromEntries(
        Object.entries(snapshot.accountBindings).map(([key, ids]) => [
          key,
          ids.filter((modelId) => modelId !== id),
        ]),
      );
      await writeSnapshot(path, snapshot);
    },
    async setAccountBindings(accountKey, modelIds) {
      const snapshot = await readSnapshot(path);
      const knownIds = new Set(snapshot.models.map((model) => model.id));
      const uniqueIds = [...new Set(modelIds)];
      const missing = uniqueIds.find((id) => !knownIds.has(id));
      if (missing) throw new Error(`Model '${missing}' not found`);
      if (uniqueIds.length === 0) delete snapshot.accountBindings[accountKey];
      else snapshot.accountBindings[accountKey] = uniqueIds;
      await writeSnapshot(path, snapshot);
      return snapshot;
    },
    async setModelBindings(modelId, accountKeys) {
      const snapshot = await readSnapshot(path);
      if (!snapshot.models.some((model) => model.id === modelId)) {
        throw new Error(`Model '${modelId}' not found`);
      }
      const selectedKeys = new Set(accountKeys);
      const allKeys = new Set([...Object.keys(snapshot.accountBindings), ...selectedKeys]);
      for (const accountKey of allKeys) {
        const withoutModel = (snapshot.accountBindings[accountKey] ?? []).filter((id) => id !== modelId);
        const nextIds = selectedKeys.has(accountKey) ? [...withoutModel, modelId] : withoutModel;
        if (nextIds.length === 0) delete snapshot.accountBindings[accountKey];
        else snapshot.accountBindings[accountKey] = nextIds;
      }
      await writeSnapshot(path, snapshot);
      return snapshot;
    },
  };
}

export function normalizeCustomModelInput(value: Record<string, unknown>): ModelCatalogEntry {
  const slug = typeof value.slug === "string" ? value.slug.trim() : "";
  const displayName = typeof value.display_name === "string" ? value.display_name.trim() : "";
  if (!slug || !/^[A-Za-z0-9._:-]+$/.test(slug)) {
    throw new Error("Model slug is required and may only contain letters, numbers, '.', '_', ':' or '-'");
  }
  if (!displayName) throw new Error("Model display_name is required");
  return {
    default_reasoning_level: "medium",
    supported_reasoning_levels: [
      { effort: "low", description: "Fast responses" },
      { effort: "medium", description: "Balanced reasoning" },
      { effort: "high", description: "Deeper reasoning" },
    ],
    shell_type: "shell_command",
    visibility: "list",
    supported_in_api: true,
    priority: 100,
    base_instructions: "You are a helpful coding assistant.",
    supports_reasoning_summaries: false,
    default_reasoning_summary: "none",
    support_verbosity: false,
    truncation_policy: { mode: "bytes", limit: 10000 },
    supports_parallel_tool_calls: true,
    supports_image_detail_original: false,
    context_window: 128000,
    max_context_window: 128000,
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    input_modalities: ["text", "image"],
    supports_search_tool: false,
    ...value,
    slug,
    display_name: displayName,
  };
}

export function accountModelBindingKey(envName: string, accountName: string): string {
  return `${envName}/${accountName}`;
}

async function readSnapshot(path: string): Promise<ModelCatalogSnapshot> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY_SNAPSHOT);
    throw new Error(`Failed to read custom model catalog: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.models) || !isRecord(parsed.accountBindings)) {
    throw new Error("Custom model catalog file is invalid");
  }
  const models = parsed.models.map(validateModelRecord);
  const ids = new Set(models.map((model) => model.id));
  const accountBindings = Object.fromEntries(
    Object.entries(parsed.accountBindings).map(([key, value]) => {
      if (!Array.isArray(value) || !value.every((id) => typeof id === "string" && ids.has(id))) {
        throw new Error(`Custom model bindings for '${key}' are invalid`);
      }
      return [key, [...new Set(value)]];
    }),
  );
  return { version: 1, models, accountBindings };
}

function validateModelRecord(value: unknown): CustomModelRecord {
  if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.entry)) {
    throw new Error("Custom model record is invalid");
  }
  return {
    id: value.id,
    entry: normalizeCustomModelInput(value.entry),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date(0).toISOString(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
  };
}

async function writeSnapshot(path: string, snapshot: ModelCatalogSnapshot): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
