import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const DEFAULT_SCHEMA_VERSION = 1;
const STATE_FILE_NAME = "core-state.json";

export type TargetName = "cli" | "app";
export type AuthMode = "auth" | "apikey" | "provider-profile";
export type PreferredAuthMethod = "chatgpt" | "apikey";
export type OpenAIBaseUrlMode = "default" | "custom";
export type TaskStatus = "pending" | "running" | "succeeded" | "failed";

export interface TargetPointer {
  env: string;
  account: string;
}

export interface AccountRuntimeSettings {
  preferredAuthMethod: PreferredAuthMethod;
  openaiBaseUrlMode: OpenAIBaseUrlMode;
  openaiBaseUrl?: string;
  providerId?: string;
  model?: string;
}

export interface AccountState {
  name: string;
  authMode: AuthMode;
  runtime: AccountRuntimeSettings;
  authData?: Record<string, string>;
}

export interface EnvState {
  name: string;
  path: string;
  accounts: Record<string, AccountState>;
}

export interface TaskSummary {
  id: string;
  kind: string;
  status: TaskStatus;
  startedAt: string;
  finishedAt?: string;
  summary?: string;
}

export interface SwitcherState {
  schemaVersion: typeof DEFAULT_SCHEMA_VERSION;
  generatedAt: string;
  targets: Record<TargetName, TargetPointer>;
  envs: Record<string, EnvState>;
  tasks: {
    recent: TaskSummary[];
  };
}

export interface SwitcherError extends Error {
  code: "INVALID_STATE" | "STATE_NOT_FOUND" | "STATE_IO_ERROR";
  cause?: unknown;
}

export interface StateStore {
  load(): Promise<SwitcherState>;
  save(state: SwitcherState): Promise<void>;
  writeRaw(content: string): Promise<void>;
  readonly paths: {
    rootDir: string;
    stateFile: string;
  };
}

export interface CreateStateStoreOptions {
  rootDir: string;
}

export function createStateStore(options: CreateStateStoreOptions): StateStore {
  const stateFile = join(options.rootDir, STATE_FILE_NAME);

  return {
    paths: {
      rootDir: options.rootDir,
      stateFile,
    },
    async load() {
      let raw: string;
      try {
        raw = await readFile(stateFile, "utf8");
      } catch (error: unknown) {
        throw createStoreError("STATE_IO_ERROR", "Failed to read state file", error);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error: unknown) {
        throw createStoreError("INVALID_STATE", "State file is not valid JSON", error);
      }

      return validateState(parsed);
    },
    async save(state) {
      const validated = validateState(state);
      await mkdir(dirname(stateFile), { recursive: true });
      const tempFile = `${stateFile}.tmp`;
      await writeFile(
        tempFile,
        `${JSON.stringify(validated, null, 2)}\n`,
        "utf8",
      );
      await rename(tempFile, stateFile);
    },
    async writeRaw(content) {
      await mkdir(dirname(stateFile), { recursive: true });
      await writeFile(stateFile, content, "utf8");
    },
  };
}

function validateState(value: unknown): SwitcherState {
  if (!isRecord(value)) {
    throw createStoreError("INVALID_STATE", "State root must be an object");
  }

  if (value.schemaVersion !== DEFAULT_SCHEMA_VERSION) {
    throw createStoreError("INVALID_STATE", "Unsupported state schema version");
  }

  if (typeof value.generatedAt !== "string") {
    throw createStoreError("INVALID_STATE", "State generatedAt must be a string");
  }

  const targets = validateTargets(value.targets);
  const envs = validateEnvs(value.envs);
  const tasks = validateTasks(value.tasks);

  return {
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    generatedAt: value.generatedAt,
    targets,
    envs,
    tasks,
  };
}

function validateTargets(value: unknown): Record<TargetName, TargetPointer> {
  if (!isRecord(value)) {
    throw createStoreError("INVALID_STATE", "State targets must be an object");
  }

  return {
    cli: validateTargetPointer(value.cli, "cli"),
    app: validateTargetPointer(value.app, "app"),
  };
}

function validateTargetPointer(value: unknown, name: TargetName): TargetPointer {
  if (!isRecord(value) || typeof value.env !== "string" || typeof value.account !== "string") {
    throw createStoreError(
      "INVALID_STATE",
      `State target '${name}' must include env/account strings`,
    );
  }

  return { env: value.env, account: value.account };
}

function validateEnvs(value: unknown): Record<string, EnvState> {
  if (!isRecord(value)) {
    throw createStoreError("INVALID_STATE", "State envs must be an object");
  }

  return Object.fromEntries(
    Object.entries(value).map(([envName, envValue]) => [
      envName,
      validateEnvState(envName, envValue),
    ]),
  );
}

function validateEnvState(name: string, value: unknown): EnvState {
  if (!isRecord(value)) {
    throw createStoreError("INVALID_STATE", `Env '${name}' must be an object`);
  }

  if (typeof value.name !== "string" || typeof value.path !== "string") {
    throw createStoreError(
      "INVALID_STATE",
      `Env '${name}' must include string name/path fields`,
    );
  }

  if (!isRecord(value.accounts)) {
    throw createStoreError("INVALID_STATE", `Env '${name}' accounts must be an object`);
  }

  return {
    name: value.name,
    path: value.path,
    accounts: Object.fromEntries(
      Object.entries(value.accounts).map(([accountName, accountValue]) => [
        accountName,
        validateAccountState(accountName, accountValue),
      ]),
    ),
  };
}

function validateAccountState(name: string, value: unknown): AccountState {
  if (!isRecord(value)) {
    throw createStoreError("INVALID_STATE", `Account '${name}' must be an object`);
  }

  if (typeof value.name !== "string") {
    throw createStoreError("INVALID_STATE", `Account '${name}' must include a string name`);
  }

  if (!isAuthMode(value.authMode)) {
    throw createStoreError("INVALID_STATE", `Account '${name}' has invalid authMode`);
  }

  const accountState: AccountState = {
    name: value.name,
    authMode: value.authMode,
    runtime: validateRuntimeSettings(name, value.runtime),
  };

  if (isStringRecord(value.authData)) {
    accountState.authData = value.authData;
  }

  return accountState;
}

function validateRuntimeSettings(
  accountName: string,
  value: unknown,
): AccountRuntimeSettings {
  if (!isRecord(value)) {
    throw createStoreError(
      "INVALID_STATE",
      `Account '${accountName}' runtime must be an object`,
    );
  }

  if (!isPreferredAuthMethod(value.preferredAuthMethod)) {
    throw createStoreError(
      "INVALID_STATE",
      `Account '${accountName}' runtime has invalid preferredAuthMethod`,
    );
  }

  if (!isOpenAIBaseUrlMode(value.openaiBaseUrlMode)) {
    throw createStoreError(
      "INVALID_STATE",
      `Account '${accountName}' runtime has invalid openaiBaseUrlMode`,
    );
  }

  const runtime: AccountRuntimeSettings = {
    preferredAuthMethod: value.preferredAuthMethod,
    openaiBaseUrlMode: value.openaiBaseUrlMode,
  };

  if (typeof value.openaiBaseUrl === "string") {
    runtime.openaiBaseUrl = value.openaiBaseUrl;
  }
  if (typeof value.providerId === "string") {
    runtime.providerId = value.providerId;
  }
  if (typeof value.model === "string") {
    runtime.model = value.model;
  }

  return runtime;
}

function validateTasks(value: unknown): { recent: TaskSummary[] } {
  if (!isRecord(value) || !Array.isArray(value.recent)) {
    throw createStoreError("INVALID_STATE", "State tasks.recent must be an array");
  }

  return {
    recent: value.recent.map(validateTaskSummary),
  };
}

function validateTaskSummary(value: unknown): TaskSummary {
  if (!isRecord(value)) {
    throw createStoreError("INVALID_STATE", "Task summary must be an object");
  }

  if (
    typeof value.id !== "string" ||
    typeof value.kind !== "string" ||
    typeof value.startedAt !== "string" ||
    !isTaskStatus(value.status)
  ) {
    throw createStoreError("INVALID_STATE", "Task summary is missing required fields");
  }

  return {
    id: value.id,
    kind: value.kind,
    status: value.status,
    startedAt: value.startedAt,
    finishedAt: typeof value.finishedAt === "string" ? value.finishedAt : undefined,
    summary: typeof value.summary === "string" ? value.summary : undefined,
  };
}

function createStoreError(
  code: SwitcherError["code"],
  message: string,
  cause?: unknown,
): SwitcherError {
  const error = new Error(message) as SwitcherError;
  error.code = code;
  error.cause = cause;
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAuthMode(value: unknown): value is AuthMode {
  return value === "auth" || value === "apikey" || value === "provider-profile";
}

function isPreferredAuthMethod(value: unknown): value is PreferredAuthMethod {
  return value === "chatgpt" || value === "apikey";
}

function isOpenAIBaseUrlMode(value: unknown): value is OpenAIBaseUrlMode {
  return value === "default" || value === "custom";
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    value === "pending" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed"
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}
