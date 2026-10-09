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

export type AccountModelDiscoveryState = "idle" | "discovering" | "ready" | "stale" | "failed";
export type AccountModelAvailability = "available" | "stale" | "unavailable" | "discovery_failed";

export interface AccountDiscoveredModel {
  providerModelKey: string;
  providerId: string;
  upstreamModelId: string;
  displayName: string;
  iconKey?: string;
  protocols: string[];
  capabilities: {
    reasoning: boolean;
    tools: boolean;
    vision: boolean;
    streaming: boolean;
  };
  contextWindow?: number;
  source: "preset" | "discovery" | "manual" | "cached";
  status: AccountModelAvailability;
  firstSeenAt: string;
  lastSeenAt: string;
  lastError?: string;
}

export interface AccountModelDiscoverySnapshot {
  providerId: string;
  state: AccountModelDiscoveryState;
  models: AccountDiscoveredModel[];
  discoveredAt?: string;
  lastError?: string;
}

export interface SaveAccountModelDiscoveryInput {
  accountKey: string;
  providerId: string;
  state: AccountModelDiscoveryState;
  models?: Array<Omit<AccountDiscoveredModel, "firstSeenAt" | "lastSeenAt" | "status"> & {
    status?: AccountModelAvailability;
  }>;
  discoveredAt?: string;
  lastError?: string;
}

export interface ModelCatalogSnapshot {
  version: 1;
  models: CustomModelRecord[];
  accountBindings: Record<string, string[]>;
  accountBindingOptions?: Record<string, Record<string, ModelBindingOptions>>;
  accountModelDiscoveries?: Record<string, AccountModelDiscoverySnapshot>;
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
  saveAccountModelDiscovery(input: SaveAccountModelDiscoveryInput): Promise<ModelCatalogSnapshot>;
  removeAccountModelDiscovery(accountKey: string): Promise<ModelCatalogSnapshot>;
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
    async saveAccountModelDiscovery(input) {
      const snapshot = await readSnapshot(path);
      const now = new Date().toISOString();
      const previous = snapshot.accountModelDiscoveries?.[input.accountKey];
      const previousByKey = new Map((previous?.models ?? []).map((model) => [model.providerModelKey, model]));
      const incoming = new Map<string, AccountDiscoveredModel>();

      for (const rawModel of input.models ?? []) {
        const providerModelKey = rawModel.providerModelKey.trim();
        const providerId = rawModel.providerId.trim();
        const upstreamModelId = rawModel.upstreamModelId.trim();
        const displayName = rawModel.displayName.trim() || upstreamModelId;
        if (!providerModelKey || !providerId || !upstreamModelId) continue;
        const previousModel = previousByKey.get(providerModelKey);
        const model: AccountDiscoveredModel = {
          providerModelKey,
          providerId,
          upstreamModelId,
          displayName,
          ...(rawModel.iconKey?.trim() ? { iconKey: rawModel.iconKey.trim() } : {}),
          protocols: [...new Set(rawModel.protocols.map((protocol) => protocol.trim()).filter(Boolean))],
          capabilities: normalizeModelCapabilities(rawModel.capabilities),
          ...(Number.isFinite(rawModel.contextWindow) && rawModel.contextWindow && rawModel.contextWindow > 0
            ? { contextWindow: Math.floor(rawModel.contextWindow) }
            : {}),
          source: rawModel.source,
          status: rawModel.status ?? "available",
          firstSeenAt: previousModel?.firstSeenAt ?? now,
          lastSeenAt: input.discoveredAt ?? now,
          ...(rawModel.lastError?.trim() ? { lastError: rawModel.lastError.trim() } : {}),
        };
        incoming.set(providerModelKey, model);
        upsertDiscoveredCatalogModel(snapshot, model, now);
      }

      const models = incoming.size === 0
        ? (previous?.models ?? []).map((model) => ({
            ...model,
            status: input.state === "discovering"
              ? model.status
              : input.state === "failed"
              ? model.status === "available" ? "stale" as const : model.status
              : model.status === "available" ? "unavailable" as const : model.status,
            ...(input.lastError?.trim() ? { lastError: input.lastError.trim() } : {}),
          }))
        : [...incoming.values()];

      if (previous && incoming.size > 0) {
        for (const oldModel of previous.models) {
          if (incoming.has(oldModel.providerModelKey)) continue;
          models.push({
            ...oldModel,
            status: oldModel.status === "available" ? "unavailable" : oldModel.status,
          });
        }
      }

      snapshot.accountModelDiscoveries ??= {};
      snapshot.accountModelDiscoveries[input.accountKey] = {
        providerId: input.providerId.trim(),
        state: input.state,
        models: dedupeDiscoveredModels(models),
        ...(input.discoveredAt || incoming.size ? { discoveredAt: input.discoveredAt ?? now } : previous?.discoveredAt ? { discoveredAt: previous.discoveredAt } : {}),
        ...(input.lastError?.trim() ? { lastError: input.lastError.trim() } : {}),
      };
      await writeSnapshot(path, snapshot);
      return snapshot;
    },
    async removeAccountModelDiscovery(accountKey) {
      const snapshot = await readSnapshot(path);
      delete snapshot.accountBindings[accountKey];
      if (snapshot.accountBindingOptions) {
        delete snapshot.accountBindingOptions[accountKey];
        if (Object.keys(snapshot.accountBindingOptions).length === 0) {
          delete snapshot.accountBindingOptions;
        }
      }
      if (snapshot.accountModelDiscoveries) {
        delete snapshot.accountModelDiscoveries[accountKey];
        if (Object.keys(snapshot.accountModelDiscoveries).length === 0) {
          delete snapshot.accountModelDiscoveries;
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
  for (const field of ["protocol", "wire_api", "api_protocol"]) {
    const protocol = value[field];
    if (protocol !== undefined && (typeof protocol !== "string" || !isSupportedModelProtocol(protocol))) {
      throw new Error(`Model ${field} must be one of responses, chat_completions, anthropic, or gemini`);
    }
  }
  if (value.supported_protocols !== undefined && (
    !Array.isArray(value.supported_protocols)
      || value.supported_protocols.some((protocol) => typeof protocol !== "string" || !isSupportedModelProtocol(protocol))
  )) {
    throw new Error("Model supported_protocols must contain supported gateway protocols");
  }
  for (const field of ["context_window", "max_context_window"]) {
    const contextWindow = value[field];
    if (contextWindow !== undefined && (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0)) {
      throw new Error(`Model ${field} must be a positive number`);
    }
  }
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
    // The local route service exposes HTTP Responses endpoints.  Always
    // disable the App's WebSocket transport for models managed by this
    // catalog; otherwise a missing or user-provided value can make the App
    // send a websocket handshake to the HTTP gateway.
    prefer_websockets: false,
    slug,
    display_name: displayName,
  };
}

function isSupportedModelProtocol(value: string): boolean {
  const normalized = value.trim().toLowerCase().replaceAll("-", "_");
  return normalized === "responses"
    || normalized === "chat_completions"
    || normalized === "anthropic"
    || normalized === "anthropic_messages"
    || normalized === "gemini";
}

function upsertDiscoveredCatalogModel(
  snapshot: ModelCatalogSnapshot,
  model: AccountDiscoveredModel,
  now: string,
): void {
  const existing = snapshot.models.find((candidate) => (
    candidate.entry.provider_model_key === model.providerModelKey
      // Provider preset records created before discovery did not carry a
      // provider key. Reuse the exact upstream slug so onboarding does not
      // create a second visually identical model entry.
      || (!candidate.entry.provider_model_key && candidate.entry.slug === model.upstreamModelId)
  ));
  const slug = existing?.entry.slug ?? createDiscoveredModelSlug(model.providerId, model.upstreamModelId);
  const entry = normalizeCustomModelInput({
    ...(existing?.entry ?? {}),
    slug,
    display_name: model.displayName,
    description: existing?.entry.description ?? `Discovered from ${model.providerId}`,
    provider_id: model.providerId,
    provider_model_key: model.providerModelKey,
    upstream_model_id: model.upstreamModelId,
    model_source: "discovered",
    protocol: model.protocols.length === 1 ? model.protocols[0] : undefined,
    supported_protocols: model.protocols,
    supports_reasoning_summaries: model.capabilities.reasoning,
    supports_parallel_tool_calls: model.capabilities.tools,
    input_modalities: model.capabilities.vision ? ["text", "image"] : ["text"],
    ...(model.contextWindow ? { context_window: model.contextWindow, max_context_window: model.contextWindow } : {}),
  });
  if (existing) {
    existing.entry = entry;
    existing.updatedAt = now;
    return;
  }
  snapshot.models.push({ id: randomUUID(), entry, createdAt: now, updatedAt: now });
}

function createDiscoveredModelSlug(providerId: string, upstreamModelId: string): string {
  const provider = providerId.trim().replace(/[^A-Za-z0-9._:-]+/g, "-");
  const model = upstreamModelId.trim().replace(/[^A-Za-z0-9._:-]+/g, "-");
  return `${provider}:${model}`;
}

function normalizeModelCapabilities(value: AccountDiscoveredModel["capabilities"]): AccountDiscoveredModel["capabilities"] {
  return {
    reasoning: value?.reasoning === true,
    tools: value?.tools === true,
    vision: value?.vision === true,
    streaming: value?.streaming !== false,
  };
}

function dedupeDiscoveredModels(models: AccountDiscoveredModel[]): AccountDiscoveredModel[] {
  return [...new Map(models.map((model) => [model.providerModelKey, model])).values()]
    .sort((left, right) => left.providerModelKey.localeCompare(right.providerModelKey));
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

/**
 * A successful refresh with an empty or changed provider list marks removed
 * entries unavailable. Keep stale entries routeable for recovery, but never
 * publish an explicitly unavailable model to Codex or the gateway.
 */
export function isModelAvailableForAccount(
  snapshot: ModelCatalogSnapshot,
  model: CustomModelRecord,
  accountKey: string,
): boolean {
  const providerModelKey = typeof model.entry.provider_model_key === "string"
    ? model.entry.provider_model_key.trim()
    : "";
  if (!providerModelKey) return true;
  const discovery = snapshot.accountModelDiscoveries?.[accountKey];
  if (!discovery) return true;
  const discovered = discovery.models.find((candidate) => candidate.providerModelKey === providerModelKey);
  return discovered?.status !== "unavailable";
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
    ...(snapshot.accountModelDiscoveries
      ? {
          accountModelDiscoveries: Object.fromEntries(
            Object.entries(snapshot.accountModelDiscoveries).filter(([accountKey]) => accountKeys.has(accountKey)),
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
  if (!isRecord(parsed) || (parsed.version !== undefined && parsed.version !== 1) || !Array.isArray(parsed.models) || !isRecord(parsed.accountBindings)) {
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
  const accountModelDiscoveries = parsed.accountModelDiscoveries === undefined
    ? undefined
    : normalizeAccountModelDiscoveries(parsed.accountModelDiscoveries);
  return {
    version: 1,
    models,
    accountBindings,
    ...(accountBindingOptions ? { accountBindingOptions } : {}),
    ...(accountModelDiscoveries ? { accountModelDiscoveries } : {}),
  };
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

function normalizeAccountModelDiscoveries(value: unknown): Record<string, AccountModelDiscoverySnapshot> {
  if (!isRecord(value)) throw new Error("Account model discoveries are invalid");
  const result: Record<string, AccountModelDiscoverySnapshot> = {};
  for (const [accountKey, rawSnapshot] of Object.entries(value)) {
    if (!isRecord(rawSnapshot) || typeof rawSnapshot.providerId !== "string" || !Array.isArray(rawSnapshot.models)) {
      continue;
    }
    const models: AccountDiscoveredModel[] = [];
    for (const rawModel of rawSnapshot.models) {
      if (!isRecord(rawModel)) continue;
      const providerModelKey = typeof rawModel.providerModelKey === "string" ? rawModel.providerModelKey.trim() : "";
      const providerId = typeof rawModel.providerId === "string" ? rawModel.providerId.trim() : "";
      const upstreamModelId = typeof rawModel.upstreamModelId === "string" ? rawModel.upstreamModelId.trim() : "";
      const displayName = typeof rawModel.displayName === "string" ? rawModel.displayName.trim() : upstreamModelId;
      if (!providerModelKey || !providerId || !upstreamModelId || !displayName) continue;
      models.push({
        providerModelKey,
        providerId,
        upstreamModelId,
        displayName,
        ...(typeof rawModel.iconKey === "string" && rawModel.iconKey.trim() ? { iconKey: rawModel.iconKey.trim() } : {}),
        protocols: Array.isArray(rawModel.protocols)
          ? rawModel.protocols.filter((protocol): protocol is string => typeof protocol === "string").map((protocol) => protocol.trim()).filter(Boolean)
          : [],
        capabilities: normalizeModelCapabilities(isRecord(rawModel.capabilities)
          ? {
              reasoning: rawModel.capabilities.reasoning === true,
              tools: rawModel.capabilities.tools === true,
              vision: rawModel.capabilities.vision === true,
              streaming: rawModel.capabilities.streaming !== false,
            }
          : { reasoning: false, tools: false, vision: false, streaming: true }),
        ...(typeof rawModel.contextWindow === "number" && Number.isFinite(rawModel.contextWindow) && rawModel.contextWindow > 0
          ? { contextWindow: Math.floor(rawModel.contextWindow) }
          : {}),
        source: rawModel.source === "preset" || rawModel.source === "manual" || rawModel.source === "cached"
          ? rawModel.source
          : "discovery",
        status: rawModel.status === "stale" || rawModel.status === "unavailable" || rawModel.status === "discovery_failed"
          ? rawModel.status
          : "available",
        firstSeenAt: typeof rawModel.firstSeenAt === "string" ? rawModel.firstSeenAt : new Date(0).toISOString(),
        lastSeenAt: typeof rawModel.lastSeenAt === "string" ? rawModel.lastSeenAt : new Date(0).toISOString(),
        ...(typeof rawModel.lastError === "string" && rawModel.lastError.trim() ? { lastError: rawModel.lastError.trim() } : {}),
      });
    }
    result[accountKey] = {
      providerId: rawSnapshot.providerId.trim(),
      state: rawSnapshot.state === "discovering" || rawSnapshot.state === "ready" || rawSnapshot.state === "stale" || rawSnapshot.state === "failed"
        ? rawSnapshot.state
        : "idle",
      models: dedupeDiscoveredModels(models),
      ...(typeof rawSnapshot.discoveredAt === "string" ? { discoveredAt: rawSnapshot.discoveredAt } : {}),
      ...(typeof rawSnapshot.lastError === "string" && rawSnapshot.lastError.trim() ? { lastError: rawSnapshot.lastError.trim() } : {}),
    };
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
