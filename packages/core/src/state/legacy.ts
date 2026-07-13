import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  DEFAULT_SCHEMA_VERSION,
  type AccountState,
  type AuthDataRecord,
  type AuthMode,
  type OpenAIBaseUrlMode,
  type PreferredAuthMethod,
  type SwitcherState,
} from "./store.js";

const DEFAULT_ENV_NAME = "default";
const DEFAULT_ACCOUNT_NAME = "default";

export interface ReadLegacyStateOptions {
  stateDir: string;
  envsDir: string;
  defaultHome: string;
  now?: string;
}

export interface WriteLegacyPointersOptions {
  stateDir: string;
  target: "cli" | "app";
  env: string;
  account: string;
}

export interface WriteLegacyRuntimeOptions {
  stateDir: string;
  envName: string;
  accountName: string;
  runtime: AccountState["runtime"];
}

export interface CreateLegacyEnvOptions {
  envsDir: string;
  envName: string;
}

export interface UpdateLegacyEnvOptions {
  stateDir: string;
  envsDir: string;
  envName: string;
  nextEnvName: string;
  homePath: string;
}

interface LegacyRuntimeRecord {
  preferred_auth_method?: string;
  openai_base_url_mode?: string;
  openai_base_url?: string;
  independent_model_enabled?: boolean;
  independent_model_provider_id?: string;
  independent_model_api_key?: string;
  independent_model_base_url?: string;
  api_protocol?: string;
  compatibility_route_enabled?: boolean;
  compatibility_route_base_url?: string;
  compatibility_route_token?: string;
  compatibility_route_provider_id?: string;
  compatibility_upstream_model?: string;
  compatibility_reasoning_profile?: string;
  compatibility_long_conversation_strategy?: string;
  compatibility_instruction_role?: string;
  compatibility_request_overrides?: Record<string, unknown>;
}

interface LegacyEnvMetaRecord {
  homePath?: string;
}

export async function readLegacyState(
  options: ReadLegacyStateOptions,
): Promise<SwitcherState> {
  const envNames = await listEnvNames(options.envsDir);
  if (!envNames.includes(DEFAULT_ENV_NAME)) {
    envNames.unshift(DEFAULT_ENV_NAME);
  }

  const envs = Object.fromEntries(
    await Promise.all(
      envNames.map(async (envName) => [
        envName,
        await readLegacyEnvState(envName, options),
      ]),
    ),
  );

  return {
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    generatedAt: options.now ?? new Date().toISOString(),
    targets: {
      cli: {
        env: await readPointer(options.stateDir, "cli", "env", DEFAULT_ENV_NAME),
        account: await readPointer(
          options.stateDir,
          "cli",
          "account",
          DEFAULT_ACCOUNT_NAME,
        ),
      },
      app: {
        env: await readPointer(options.stateDir, "app", "env", DEFAULT_ENV_NAME),
        account: await readPointer(
          options.stateDir,
          "app",
          "account",
          DEFAULT_ACCOUNT_NAME,
        ),
      },
    },
    envs,
    tasks: {
      recent: [],
    },
  };
}

export async function writeLegacyPointers(
  options: WriteLegacyPointersOptions,
): Promise<void> {
  await mkdir(options.stateDir, { recursive: true });
  await writeFile(
    join(options.stateDir, `current_${options.target}_env`),
    `${options.env}\n`,
    "utf8",
  );
  await writeFile(
    join(options.stateDir, `current_${options.target}_account`),
    `${options.account}\n`,
    "utf8",
  );
}

export async function writeLegacyRuntime(
  options: WriteLegacyRuntimeOptions,
): Promise<void> {
  const runtimeDir = join(
    options.stateDir,
    "env-accounts",
    options.envName,
    options.accountName,
  );
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(
    join(runtimeDir, "runtime.json"),
    `${JSON.stringify(
      {
        preferred_auth_method: options.runtime.preferredAuthMethod,
        openai_base_url_mode: options.runtime.openaiBaseUrlMode,
        openai_base_url: options.runtime.openaiBaseUrl ?? "",
        independent_model_enabled: options.runtime.independentModelEnabled ?? false,
        independent_model_provider_id: options.runtime.independentModelProviderId ?? "custom",
        independent_model_api_key: options.runtime.independentModelApiKey ?? "",
        independent_model_base_url: options.runtime.independentModelBaseUrl ?? "",
        api_protocol: options.runtime.apiProtocol ?? "responses",
        compatibility_route_enabled: options.runtime.compatibilityRouteEnabled ?? false,
        compatibility_route_base_url: options.runtime.compatibilityRouteBaseUrl ?? "",
        compatibility_route_token: options.runtime.compatibilityRouteToken ?? "",
        compatibility_route_provider_id: options.runtime.compatibilityRouteProviderId ?? "",
        compatibility_upstream_model: options.runtime.compatibilityUpstreamModel ?? "",
        compatibility_reasoning_profile: options.runtime.compatibilityReasoningProfile ?? "auto",
        compatibility_long_conversation_strategy:
          options.runtime.compatibilityLongConversationStrategy ?? "safe",
        compatibility_instruction_role: options.runtime.compatibilityInstructionRole ?? "auto",
        compatibility_request_overrides: options.runtime.compatibilityRequestOverrides ?? {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export async function createLegacyEnv(options: CreateLegacyEnvOptions): Promise<void> {
  if (options.envName === DEFAULT_ENV_NAME) {
    return;
  }

  await mkdir(join(options.envsDir, options.envName, "home"), { recursive: true });
}

export async function updateLegacyEnv(options: UpdateLegacyEnvOptions): Promise<void> {
  if (options.envName !== options.nextEnvName && options.envName === DEFAULT_ENV_NAME) {
    throw new Error("Cannot rename reserved default env");
  }

  if (options.envName !== options.nextEnvName && options.nextEnvName !== DEFAULT_ENV_NAME) {
    await renameIfExists(
      join(options.envsDir, options.envName),
      join(options.envsDir, options.nextEnvName),
    );
    await renameIfExists(
      join(options.stateDir, "env-accounts", options.envName),
      join(options.stateDir, "env-accounts", options.nextEnvName),
    );
    await renameIfExists(
      getEnvMetaPath(options.stateDir, options.envName),
      getEnvMetaPath(options.stateDir, options.nextEnvName),
    );
  }

  await writeLegacyEnvMeta(options.stateDir, options.nextEnvName, {
    homePath: options.homePath,
  });
}

async function readLegacyEnvState(
  envName: string,
  options: ReadLegacyStateOptions,
): Promise<SwitcherState["envs"][string]> {
  const accountRoot = join(options.stateDir, "env-accounts", envName);
  const accountNames = await listDirectoryNames(accountRoot);
  const names =
    envName === DEFAULT_ENV_NAME && !accountNames.includes(DEFAULT_ACCOUNT_NAME)
      ? [DEFAULT_ACCOUNT_NAME, ...accountNames]
      : accountNames;

  const accounts = Object.fromEntries(
    await Promise.all(
      names.map(async (accountName) => [
        accountName,
        await readLegacyAccountState(accountRoot, accountName),
      ]),
    ),
  );

  return {
    name: envName,
    path:
      (await readLegacyEnvMeta(options.stateDir, envName)).homePath ||
      (envName === DEFAULT_ENV_NAME
        ? options.defaultHome
        : join(options.envsDir, envName, "home")),
    accounts,
  };
}

async function readLegacyAccountState(
  accountRoot: string,
  accountName: string,
): Promise<AccountState> {
  const runtimePath = join(accountRoot, accountName, "runtime.json");
  const runtimeRecord = await readRuntimeRecord(runtimePath);
  const authData = await readAuthRecord(join(accountRoot, accountName, "auth.json"));

  const accountState: AccountState = {
    name: accountName,
    authMode:
      runtimeRecord.preferred_auth_method === "apikey" ? "apikey" : "auth",
      runtime: {
        preferredAuthMethod: normalizePreferredAuthMethod(
          runtimeRecord.preferred_auth_method,
        ),
        openaiBaseUrlMode: normalizeOpenAIBaseUrlMode(
          runtimeRecord.openai_base_url_mode,
        ),
        openaiBaseUrl: runtimeRecord.openai_base_url || undefined,
        independentModelEnabled: runtimeRecord.independent_model_enabled === true,
        independentModelProviderId: runtimeRecord.independent_model_provider_id || "custom",
        independentModelApiKey: runtimeRecord.independent_model_api_key || undefined,
        independentModelBaseUrl: runtimeRecord.independent_model_base_url || undefined,
        apiProtocol: runtimeRecord.api_protocol === "chat_completions" ? "chat_completions" : "responses",
        compatibilityRouteEnabled: runtimeRecord.compatibility_route_enabled === true,
        compatibilityRouteBaseUrl: runtimeRecord.compatibility_route_base_url || undefined,
        compatibilityRouteToken: runtimeRecord.compatibility_route_token || undefined,
        compatibilityRouteProviderId: runtimeRecord.compatibility_route_provider_id || undefined,
        compatibilityUpstreamModel: runtimeRecord.compatibility_upstream_model || undefined,
        compatibilityReasoningProfile:
          runtimeRecord.compatibility_reasoning_profile === "standard" ||
          runtimeRecord.compatibility_reasoning_profile === "reasoning_content" ||
          runtimeRecord.compatibility_reasoning_profile === "think_tags"
            ? runtimeRecord.compatibility_reasoning_profile
            : "auto",
        compatibilityLongConversationStrategy:
          runtimeRecord.compatibility_long_conversation_strategy === "continuity"
            ? "continuity"
            : "safe",
        compatibilityInstructionRole:
          runtimeRecord.compatibility_instruction_role === "system" ||
          runtimeRecord.compatibility_instruction_role === "developer"
            ? runtimeRecord.compatibility_instruction_role
            : "auto",
        compatibilityRequestOverrides: runtimeRecord.compatibility_request_overrides,
      },
    };

  if (authData) {
    accountState.authData = authData;
  }

  return accountState;
}

async function readRuntimeRecord(path: string): Promise<LegacyRuntimeRecord> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as LegacyRuntimeRecord;
  } catch {
    return {};
  }
}

async function readAuthRecord(path: string): Promise<AuthDataRecord | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as AuthDataRecord;
  } catch {
    return undefined;
  }
}

async function readPointer(
  stateDir: string,
  target: "cli" | "app",
  kind: "env" | "account",
  fallback: string,
): Promise<string> {
  const path = join(stateDir, `current_${target}_${kind}`);
  try {
    return (await readFile(path, "utf8")).trim() || fallback;
  } catch {
    return fallback;
  }
}

async function listEnvNames(envsDir: string): Promise<string[]> {
  return listDirectoryNames(envsDir);
}

async function listDirectoryNames(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

async function readLegacyEnvMeta(
  stateDir: string,
  envName: string,
): Promise<LegacyEnvMetaRecord> {
  try {
    const raw = await readFile(getEnvMetaPath(stateDir, envName), "utf8");
    const parsed = JSON.parse(raw) as LegacyEnvMetaRecord;
    return typeof parsed.homePath === "string" && parsed.homePath
      ? { homePath: parsed.homePath }
      : {};
  } catch {
    return {};
  }
}

async function writeLegacyEnvMeta(
  stateDir: string,
  envName: string,
  value: LegacyEnvMetaRecord,
): Promise<void> {
  const metaPath = getEnvMetaPath(stateDir, envName);
  await mkdir(join(stateDir, "env-meta"), { recursive: true });
  await writeFile(`${metaPath}`, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function getEnvMetaPath(stateDir: string, envName: string): string {
  return join(stateDir, "env-meta", `${envName}.json`);
}

async function renameIfExists(source: string, target: string): Promise<void> {
  try {
    await stat(source);
  } catch {
    return;
  }

  await mkdir(dirname(target), { recursive: true });
  await rename(source, target);
}

function normalizePreferredAuthMethod(value: unknown): PreferredAuthMethod {
  return value === "apikey" ? "apikey" : "chatgpt";
}

function normalizeOpenAIBaseUrlMode(value: unknown): OpenAIBaseUrlMode {
  return value === "custom" ? "custom" : "default";
}
