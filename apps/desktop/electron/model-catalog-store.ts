import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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

export interface ModelBindingOptions {
  upstreamModelId?: string;
  enabled?: boolean;
  priority?: number;
  weight?: number;
}

export interface ModelCatalogSnapshot {
  version: 1;
  models: CustomModelRecord[];
  accountBindings: Record<string, string[]>;
  accountBindingOptions?: Record<string, Record<string, ModelBindingOptions>>;
}

export interface SaveCustomModelInput {
  id?: string;
  entry: Record<string, unknown>;
}

export interface ModelCatalogStore {
  load(): Promise<ModelCatalogSnapshot>;
  saveModel(input: SaveCustomModelInput): Promise<CustomModelRecord>;
  deleteModel(id: string): Promise<void>;
  setAccountBindings(
    accountKey: string,
    modelIds: string[],
    optionsByModel?: Record<string, ModelBindingOptions>,
  ): Promise<ModelCatalogSnapshot>;
  setModelBindings(
    modelId: string,
    accountKeys: string[],
    optionsByAccount?: Record<string, ModelBindingOptions>,
  ): Promise<ModelCatalogSnapshot>;
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
      snapshot.accountBindingOptions = removeModelBindingOptions(snapshot.accountBindingOptions, id);
      await writeSnapshot(path, snapshot);
    },
    async setAccountBindings(accountKey, modelIds, optionsByModel) {
      const snapshot = await readSnapshot(path);
      const knownIds = new Set(snapshot.models.map((model) => model.id));
      const uniqueIds = [...new Set(modelIds)];
      const missing = uniqueIds.find((id) => !knownIds.has(id));
      if (missing) throw new Error(`Model '${missing}' not found`);
      if (uniqueIds.length === 0) delete snapshot.accountBindings[accountKey];
      else snapshot.accountBindings[accountKey] = uniqueIds;
      if (optionsByModel !== undefined) {
        const nextOptions = Object.fromEntries(
          uniqueIds
            .map((modelId) => [modelId, normalizeModelBindingOptions(optionsByModel[modelId])] as const)
            .filter(([, options]) => Object.keys(options).length),
        );
        if (Object.keys(nextOptions).length) {
          snapshot.accountBindingOptions ??= {};
          snapshot.accountBindingOptions[accountKey] = nextOptions;
        } else if (snapshot.accountBindingOptions) {
          delete snapshot.accountBindingOptions[accountKey];
        }
      } else {
        snapshot.accountBindingOptions = retainModelBindingOptions(
          snapshot.accountBindingOptions,
          accountKey,
          new Set(uniqueIds),
        );
      }
      await writeSnapshot(path, snapshot);
      return snapshot;
    },
    async setModelBindings(modelId, accountKeys, optionsByAccount = {}) {
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

        const existingOptions = snapshot.accountBindingOptions?.[accountKey] ?? {};
        const nextOptions = Object.fromEntries(
          Object.entries(existingOptions).filter(([id]) => id !== modelId),
        );
        if (selectedKeys.has(accountKey)) {
          const options = normalizeModelBindingOptions(optionsByAccount[accountKey]);
          if (Object.keys(options).length) nextOptions[modelId] = options;
        }
        if (Object.keys(nextOptions).length) {
          snapshot.accountBindingOptions ??= {};
          snapshot.accountBindingOptions[accountKey] = nextOptions;
        } else if (snapshot.accountBindingOptions) {
          delete snapshot.accountBindingOptions[accountKey];
        }
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

export function resolveModelBinding(
  snapshot: ModelCatalogSnapshot,
  model: CustomModelRecord,
  accountKey: string,
): Required<Pick<ModelBindingOptions, "enabled" | "priority" | "weight">> & {
  modelId: string;
  upstreamModelId: string;
} {
  const options = snapshot.accountBindingOptions?.[accountKey]?.[model.id] ?? {};
  return {
    modelId: model.id,
    upstreamModelId: options.upstreamModelId?.trim() || model.entry.slug,
    enabled: options.enabled !== false,
    priority: Number.isFinite(options.priority) ? Math.max(0, options.priority ?? 0) : 0,
    weight: Number.isFinite(options.weight) ? Math.max(1, options.weight ?? 1) : 1,
  };
}

export function filterModelCatalogBindings(
  snapshot: ModelCatalogSnapshot,
  accountKeys: ReadonlySet<string>,
): ModelCatalogSnapshot {
  return {
    ...snapshot,
    accountBindings: Object.fromEntries(
      Object.entries(snapshot.accountBindings).filter(([accountKey]) => accountKeys.has(accountKey)),
    ),
    ...(snapshot.accountBindingOptions
      ? {
          accountBindingOptions: Object.fromEntries(
            Object.entries(snapshot.accountBindingOptions).filter(([accountKey]) => accountKeys.has(accountKey)),
          ),
        }
      : {}),
  };
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
  const accountBindingOptions = parsed.accountBindingOptions === undefined
    ? undefined
    : normalizeAccountBindingOptions(parsed.accountBindingOptions, ids);
  return { version: 1, models, accountBindings, ...(accountBindingOptions ? { accountBindingOptions } : {}) };
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
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeModelBindingOptions(value: ModelBindingOptions | undefined): ModelBindingOptions {
  if (!value || typeof value !== "object") return {};
  const result: ModelBindingOptions = {};
  const upstreamModelId = typeof value.upstreamModelId === "string" ? value.upstreamModelId.trim() : "";
  if (upstreamModelId) result.upstreamModelId = upstreamModelId;
  if (value.enabled !== undefined) result.enabled = value.enabled === true;
  if (typeof value.priority === "number" && Number.isFinite(value.priority)) result.priority = Math.max(0, value.priority);
  if (typeof value.weight === "number" && Number.isFinite(value.weight)) result.weight = Math.max(1, value.weight);
  return result;
}

function normalizeAccountBindingOptions(
  value: unknown,
  modelIds: ReadonlySet<string>,
): Record<string, Record<string, ModelBindingOptions>> {
  if (!isRecord(value)) throw new Error("Custom model binding options are invalid");
  const result: Record<string, Record<string, ModelBindingOptions>> = {};
  for (const [accountKey, rawOptions] of Object.entries(value)) {
    if (!isRecord(rawOptions)) throw new Error(`Custom model binding options for '${accountKey}' are invalid`);
    const options: Record<string, ModelBindingOptions> = {};
    for (const [modelId, rawOption] of Object.entries(rawOptions)) {
      if (!modelIds.has(modelId) || !isRecord(rawOption)) continue;
      const normalized = normalizeModelBindingOptions(rawOption);
      if (Object.keys(normalized).length) options[modelId] = normalized;
    }
    if (Object.keys(options).length) result[accountKey] = options;
  }
  return result;
}

function retainModelBindingOptions(
  options: Record<string, Record<string, ModelBindingOptions>> | undefined,
  accountKey: string,
  modelIds: ReadonlySet<string>,
): Record<string, Record<string, ModelBindingOptions>> | undefined {
  if (!options) return undefined;
  const current = options[accountKey];
  if (!current) return options;
  const next = Object.fromEntries(Object.entries(current).filter(([modelId]) => modelIds.has(modelId)));
  if (Object.keys(next).length) options[accountKey] = next;
  else delete options[accountKey];
  return Object.keys(options).length ? options : undefined;
}

function removeModelBindingOptions(
  options: Record<string, Record<string, ModelBindingOptions>> | undefined,
  modelId: string,
): Record<string, Record<string, ModelBindingOptions>> | undefined {
  if (!options) return undefined;
  for (const [accountKey, accountOptions] of Object.entries(options)) {
    const next = Object.fromEntries(Object.entries(accountOptions).filter(([id]) => id !== modelId));
    if (Object.keys(next).length) options[accountKey] = next;
    else delete options[accountKey];
  }
  return Object.keys(options).length ? options : undefined;
}
