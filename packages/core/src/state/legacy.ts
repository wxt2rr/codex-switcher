import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  DEFAULT_SCHEMA_VERSION,
  type AccountState,
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

interface LegacyRuntimeRecord {
  preferred_auth_method?: string;
  openai_base_url_mode?: string;
  openai_base_url?: string;
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
      envName === DEFAULT_ENV_NAME
        ? options.defaultHome
        : join(options.envsDir, envName, "home"),
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

async function readAuthRecord(path: string): Promise<Record<string, string> | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const stringEntries = Object.entries(parsed).flatMap(([key, value]) => {
      if (typeof value === "string") {
        return [[key, value] as const];
      }
      if (value && typeof value === "object") {
        return [[key, JSON.stringify(value)] as const];
      }
      return [];
    });

    return stringEntries.length > 0 ? Object.fromEntries(stringEntries) : undefined;
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

function normalizePreferredAuthMethod(value: unknown): PreferredAuthMethod {
  return value === "apikey" ? "apikey" : "chatgpt";
}

function normalizeOpenAIBaseUrlMode(value: unknown): OpenAIBaseUrlMode {
  return value === "custom" ? "custom" : "default";
}
