import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  DEFAULT_SCHEMA_VERSION,
  type AccountState,
  type AuthDataRecord,
  type AuthMode,
  type OpenAIBaseUrlMode,
  type PreferredAuthMethod,
  type SwitcherState,
} from "./store.js";
import {
  isGatewayEnvironmentState,
  type GatewayEnvironmentState,
} from "../gateway/model.js";
import {
  isGatewayEnvironmentStateV2,
  migrateGatewayEnvironmentStateToV2,
  toLegacyGatewayEnvironmentState,
  type GatewayEnvironmentStateV2,
} from "../gateway/v2.js";

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

export interface WriteLegacyAuthDataOptions {
  stateDir: string;
  envName: string;
  accountName: string;
  authData: AuthDataRecord;
}

export interface WriteLegacyGatewayOptions {
  stateDir: string;
  envName: string;
  gateway: GatewayEnvironmentState;
}

export interface ClearLegacyGatewayOptions {
  stateDir: string;
  envName: string;
}

export interface WriteLegacyGatewayV2Options {
  stateDir: string;
  envName: string;
  gateway: GatewayEnvironmentStateV2;
}

export interface ReadLegacyGatewayV2Options {
  stateDir: string;
  envName: string;
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
  provider_id?: string;
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

  const targets = await readAndReconcileLegacyTargets(options.stateDir, envs);

  return {
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    generatedAt: options.now ?? new Date().toISOString(),
    targets,
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
  await writePointer(options.stateDir, options.target, "env", options.env);
  await writePointer(options.stateDir, options.target, "account", options.account);

  const otherTarget = options.target === "cli" ? "app" : "cli";
  const otherEnv = await readPointer(options.stateDir, otherTarget, "env", DEFAULT_ENV_NAME);
  if (otherEnv === options.env) {
    await writePointer(options.stateDir, otherTarget, "account", options.account);
  }
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
  await atomicWrite(
    join(runtimeDir, "runtime.json"),
    `${JSON.stringify(
      {
        preferred_auth_method: options.runtime.preferredAuthMethod,
        openai_base_url_mode: options.runtime.openaiBaseUrlMode,
        openai_base_url: options.runtime.openaiBaseUrl ?? "",
        provider_id: options.runtime.providerId ?? "",
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
  );
}

/** Persist credential material only in the account auth store, never in Gateway metadata. */
export async function writeLegacyAuthData(
  options: WriteLegacyAuthDataOptions,
): Promise<void> {
  const accountDir = join(
    options.stateDir,
    "env-accounts",
    options.envName,
    options.accountName,
  );
  await atomicWrite(join(accountDir, "auth.json"), `${JSON.stringify(options.authData, null, 2)}\n`);
}

export async function writeLegacyGateway(
  options: WriteLegacyGatewayOptions,
): Promise<void> {
  if (!isGatewayEnvironmentState(options.gateway)) {
    throw new Error(`Invalid gateway configuration for environment '${options.envName}'`);
  }
  const path = getGatewayPath(options.stateDir, options.envName);
  const v2Path = getGatewayV2Path(options.stateDir, options.envName);
  const previousLegacy = await readOptionalText(path);
  const previousV2 = await readOptionalText(v2Path);

  // Keep the historical schema as the compatibility source of truth while
  // also materializing the v2 gateway document for the new runtime.
  let nextV2 = migrateGatewayEnvironmentStateToV2(options.gateway, options.envName);
  let previousV2State: GatewayEnvironmentStateV2 | undefined;
  if (previousV2 !== undefined) {
    try {
      const parsed = JSON.parse(previousV2) as unknown;
      if (isGatewayEnvironmentStateV2(parsed)) previousV2State = parsed;
    } catch {
      // An invalid old v2 file is preserved byte-for-byte if the transaction
      // needs to roll back; it must not make a valid v1 write impossible.
    }
  }
  if (previousV2State && previousV2State.gatewayId === nextV2.gatewayId) {
    nextV2 = {
      ...nextV2,
      environmentId: previousV2State.environmentId,
      revision: previousV2State.revision + 1,
      sourceSchemaVersion: 2,
      listener: previousV2State.listener,
      agentBindings: previousV2State.agentBindings,
    };
  }

  try {
    await atomicWrite(path, `${JSON.stringify(options.gateway, null, 2)}\n`);
    await writeLegacyGatewayV2({ stateDir: options.stateDir, envName: options.envName, gateway: nextV2 });
  } catch (error) {
    await restoreOptionalText(path, previousLegacy).catch(() => undefined);
    await restoreOptionalText(v2Path, previousV2).catch(() => undefined);
    throw error;
  }
}

export async function clearLegacyGateway(
  options: ClearLegacyGatewayOptions,
): Promise<void> {
  const path = getGatewayPath(options.stateDir, options.envName);
  const v2Path = getGatewayV2Path(options.stateDir, options.envName);
  const previousLegacy = await readOptionalText(path);
  const previousV2 = await readOptionalText(v2Path);
  try {
    await rm(path, { force: true });
    await rm(v2Path, { force: true });
  } catch (error) {
    await restoreOptionalText(path, previousLegacy).catch(() => undefined);
    await restoreOptionalText(v2Path, previousV2).catch(() => undefined);
    throw error;
  }
}

export async function writeLegacyGatewayV2(
  options: WriteLegacyGatewayV2Options,
): Promise<void> {
  if (!isGatewayEnvironmentStateV2(options.gateway)) {
    throw new Error(`Invalid v2 gateway configuration for environment '${options.envName}'`);
  }
  const path = getGatewayV2Path(options.stateDir, options.envName);
  await atomicWrite(path, `${JSON.stringify(options.gateway, null, 2)}\n`);
}

export async function readLegacyGatewayV2(
  options: ReadLegacyGatewayV2Options,
): Promise<GatewayEnvironmentStateV2 | undefined> {
  try {
    const parsed = JSON.parse(await readFile(getGatewayV2Path(options.stateDir, options.envName), "utf8")) as unknown;
    if (!isGatewayEnvironmentStateV2(parsed)) {
      throw new Error(`Gateway v2 configuration for environment '${options.envName}' is invalid`);
    }
    return parsed;
  } catch (error: unknown) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}

export async function clearLegacyGatewayV2(options: ClearLegacyGatewayOptions): Promise<void> {
  await rm(getGatewayV2Path(options.stateDir, options.envName), { force: true });
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
    await renameIfExists(
      getGatewayPath(options.stateDir, options.envName),
      getGatewayPath(options.stateDir, options.nextEnvName),
    );
    await renameIfExists(
      getGatewayV2Path(options.stateDir, options.envName),
      getGatewayV2Path(options.stateDir, options.nextEnvName),
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

  const gateway = await readLegacyGateway(options.stateDir, envName);
  return {
    name: envName,
    path:
      (await readLegacyEnvMeta(options.stateDir, envName)).homePath ||
      (envName === DEFAULT_ENV_NAME
        ? options.defaultHome
        : join(options.envsDir, envName, "home")),
    accounts,
    ...(gateway ? { gateway } : {}),
  };
}

async function readLegacyGateway(
  stateDir: string,
  envName: string,
): Promise<GatewayEnvironmentState | undefined> {
  try {
    const parsed = JSON.parse(await readFile(getGatewayPath(stateDir, envName), "utf8")) as unknown;
    if (!isGatewayEnvironmentState(parsed)) {
      throw new Error(`Gateway configuration for environment '${envName}' is invalid`);
    }
    return parsed;
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    const v2 = await readLegacyGatewayV2({ stateDir, envName });
    return v2 ? toLegacyGatewayEnvironmentState(v2) : undefined;
  }
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
        providerId: runtimeRecord.provider_id || undefined,
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

async function readAndReconcileLegacyTargets(
  stateDir: string,
  envs: SwitcherState["envs"],
): Promise<SwitcherState["targets"]> {
  const [cliEnv, cliAccount, appEnv, appAccount] = await Promise.all([
    readPointerSnapshot(stateDir, "cli", "env", DEFAULT_ENV_NAME),
    readPointerSnapshot(stateDir, "cli", "account", DEFAULT_ACCOUNT_NAME),
    readPointerSnapshot(stateDir, "app", "env", DEFAULT_ENV_NAME),
    readPointerSnapshot(stateDir, "app", "account", DEFAULT_ACCOUNT_NAME),
  ]);
  const targets: SwitcherState["targets"] = {
    cli: { env: cliEnv.value, account: cliAccount.value },
    app: { env: appEnv.value, account: appAccount.value },
  };
  if (targets.cli.env !== targets.app.env || targets.cli.account === targets.app.account) {
    return targets;
  }

  const accounts = envs[targets.cli.env]?.accounts ?? {};
  const cliAccountExists = Boolean(accounts[targets.cli.account]);
  const appAccountExists = Boolean(accounts[targets.app.account]);
  const account = cliAccountExists && !appAccountExists
    ? targets.cli.account
    : appAccountExists && !cliAccountExists
      ? targets.app.account
      : cliAccount.modifiedAt > appAccount.modifiedAt
        ? targets.cli.account
        : targets.app.account;

  targets.cli = { ...targets.cli, account };
  targets.app = { ...targets.app, account };
  await mkdir(stateDir, { recursive: true });
  await Promise.all([
    writePointer(stateDir, "cli", "account", account),
    writePointer(stateDir, "app", "account", account),
  ]);
  return targets;
}

async function readPointerSnapshot(
  stateDir: string,
  target: "cli" | "app",
  kind: "env" | "account",
  fallback: string,
): Promise<{ value: string; modifiedAt: number }> {
  const path = join(stateDir, `current_${target}_${kind}`);
  try {
    const [raw, metadata] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    return { value: raw.trim() || fallback, modifiedAt: metadata.mtimeMs };
  } catch {
    return { value: fallback, modifiedAt: 0 };
  }
}

async function writePointer(
  stateDir: string,
  target: "cli" | "app",
  kind: "env" | "account",
  value: string,
): Promise<void> {
  await atomicWrite(join(stateDir, `current_${target}_${kind}`), `${value}\n`);
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
  await atomicWrite(metaPath, `${JSON.stringify(value, null, 2)}\n`);
}

/** Write state through the same-directory rename boundary used by the core store. */
async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}

async function restoreOptionalText(path: string, content: string | undefined): Promise<void> {
  if (content === undefined) {
    await rm(path, { force: true });
    return;
  }
  await atomicWrite(path, content);
}

function getEnvMetaPath(stateDir: string, envName: string): string {
  return join(stateDir, "env-meta", `${envName}.json`);
}

function getGatewayPath(stateDir: string, envName: string): string {
  return join(stateDir, "env-gateways", `${envName}.json`);
}

function getGatewayV2Path(stateDir: string, envName: string): string {
  return join(stateDir, "env-gateways-v2", `${envName}.json`);
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

function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function normalizePreferredAuthMethod(value: unknown): PreferredAuthMethod {
  return value === "apikey" ? "apikey" : "chatgpt";
}

function normalizeOpenAIBaseUrlMode(value: unknown): OpenAIBaseUrlMode {
  return value === "custom" ? "custom" : "default";
}
