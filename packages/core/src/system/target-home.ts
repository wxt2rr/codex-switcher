import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { SwitcherState, TargetName } from "../state/store.js";

export interface ApplyTargetHomeStateOptions {
  state: SwitcherState;
  target: TargetName;
}

export interface LegacyTargetHomeRepairEntry {
  envName: string;
  homePath: string;
  beforeConfigToml: string;
  afterConfigToml: string;
  providerAuthEnabled: boolean;
}

export interface LegacyTargetHomeRepairResult {
  checked: number;
  repaired: LegacyTargetHomeRepairEntry[];
  unresolved: string[];
  failures: Array<{ envName: string; error: string }>;
}

export async function repairLegacyTargetHomeConfigs(options: {
  state: SwitcherState;
  beforeWrite?: (entry: LegacyTargetHomeRepairEntry) => Promise<void>;
}): Promise<LegacyTargetHomeRepairResult> {
  const result: LegacyTargetHomeRepairResult = {
    checked: 0,
    repaired: [],
    unresolved: [],
    failures: [],
  };
  const seenHomePaths = new Set<string>();

  for (const [envName, env] of Object.entries(options.state.envs)) {
    if (seenHomePaths.has(env.path)) continue;
    seenHomePaths.add(env.path);
    result.checked += 1;

    try {
      const beforeConfigToml = await readText(join(env.path, "config.toml"));
      const targetApiKey = await readTargetHomeApiKey(env.path);
      const repair = repairLegacyTargetHomeConfig(
        beforeConfigToml,
        targetApiKey !== undefined && hasManagedApiKey(env, targetApiKey),
      );
      if (repair.unresolvedProviderId) {
        result.unresolved.push(`${envName}/${repair.unresolvedProviderId}`);
      }
      if (!repair.changed) continue;

      const entry: LegacyTargetHomeRepairEntry = {
        envName,
        homePath: env.path,
        beforeConfigToml,
        afterConfigToml: repair.content,
        providerAuthEnabled: repair.providerAuthEnabled,
      };
      await options.beforeWrite?.(entry);
      await writeFile(join(env.path, "config.toml"), repair.content, "utf8");
      result.repaired.push(entry);
    } catch (error) {
      result.failures.push({
        envName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

export async function applyTargetHomeState(
  options: ApplyTargetHomeStateOptions,
): Promise<void> {
  const pointer = options.state.targets[options.target];
  const env = options.state.envs[pointer.env];
  const account = env?.accounts[pointer.account];

  if (!env) {
    throw new Error(`Cannot apply target home state for ${options.target}`);
  }

  await mkdir(env.path, { recursive: true });

  if (!account) {
    await clearTargetHomeState(env.path);
    return;
  }

  const compatibilityRouteActive =
    account.runtime.apiProtocol === "chat_completions" &&
    account.runtime.compatibilityRouteEnabled === true;
  if (
    compatibilityRouteActive &&
    (!account.runtime.compatibilityRouteBaseUrl ||
      !account.runtime.compatibilityRouteToken)
  ) {
    throw new Error(`Compatibility route for '${account.name}' is incomplete`);
  }
  const targetAuthData = compatibilityRouteActive
    ? { OPENAI_API_KEY: account.runtime.compatibilityRouteToken! }
    : account.authData;

  if (targetAuthData) {
    await writeFile(
      join(env.path, "auth.json"),
      `${JSON.stringify(normalizeAuthDataForTargetHome(targetAuthData), null, 2)}\n`,
      "utf8",
    );
  } else {
    await rm(join(env.path, "auth.json"), { force: true });
  }

  await writeManagedConfig(join(env.path, "config.toml"), account.runtime);
}

export async function clearTargetHomeState(homePath: string): Promise<void> {
  await rm(join(homePath, "auth.json"), { force: true });
  await clearManagedConfig(join(homePath, "config.toml"));
}

async function writeManagedConfig(
  configPath: string,
  runtime: SwitcherState["envs"][string]["accounts"][string]["runtime"],
) {
  const existing = await readText(configPath);
  const managedModelSlug = resolveManagedModelSlug(runtime);
  const managedModelCatalogPath = resolveManagedModelCatalogPath(configPath, runtime);
  const cleaned = removeManagedConfigLines(existing, {
    removeModel: managedModelSlug !== undefined,
    removeModelCatalogJson: managedModelCatalogPath !== undefined,
  });
  const managedLines = [`preferred_auth_method = "${runtime.preferredAuthMethod}"`];
  const compatibilityRouteActive =
    runtime.apiProtocol === "chat_completions" &&
    runtime.compatibilityRouteEnabled &&
    Boolean(runtime.compatibilityRouteBaseUrl);

  if (compatibilityRouteActive) {
    managedLines.push(`openai_base_url = ${quoteTomlString(runtime.compatibilityRouteBaseUrl!)}`);
  }

  if (!compatibilityRouteActive && runtime.apiProtocol !== "chat_completions"
    && runtime.openaiBaseUrlMode === "custom" && runtime.openaiBaseUrl) {
    managedLines.push(`openai_base_url = "${runtime.openaiBaseUrl}"`);
  }
  if (managedModelSlug) {
    managedLines.push(`model = ${quoteTomlString(managedModelSlug)}`);
  }
  if (managedModelCatalogPath) {
    managedLines.push(`model_catalog_json = ${quoteTomlString(managedModelCatalogPath)}`);
  }
  if (runtime.independentModelEnabled && runtime.preferredAuthMethod === "chatgpt") {
    const providerId = normalizeProviderId(runtime.independentModelProviderId);
    const independentModelSlug = resolveIndependentModelSlug(runtime.independentModelBaseUrl) ?? "gpt-5.4";
    managedLines.push("");
    managedLines.push(`model_provider = ${quoteTomlString(providerId)}`);
    managedLines.push("");
    managedLines.push(`[model_providers.${providerId}]`);
    managedLines.push(`name = ${quoteTomlString(providerId)}`);
    managedLines.push(`model = ${quoteTomlString(independentModelSlug)}`);
    managedLines.push(`base_url = ${quoteTomlString(runtime.independentModelBaseUrl ?? "")}`);
    managedLines.push(
      `experimental_bearer_token = ${quoteTomlString(runtime.independentModelApiKey ?? "")}`,
    );
    managedLines.push("requires_openai_auth = false");
    managedLines.push('http_headers = { "x-openai-actor-authorization" = "codex-sw.app" }');
  }

  const content = `${managedLines.join("\n")}${cleaned ? `\n${cleaned}` : ""}\n`;
  await writeFile(configPath, content, "utf8");
}

function repairLegacyTargetHomeConfig(
  content: string,
  hasManagedApiKey: boolean,
): { changed: boolean; content: string; providerAuthEnabled: boolean; unresolvedProviderId?: string } {
  if (!content) {
    return { changed: false, content, providerAuthEnabled: false };
  }

  const lines = content.split(/\r?\n/);
  const rootLinesToRemove = new Set<number>();
  const providers = new Map<string, {
    requiresOpenAiAuth?: boolean;
    requiresLine?: number;
    hasExplicitAuth: boolean;
  }>();
  let section: "root" | "other" | { providerId: string } = "root";
  let modelProviderId: string | undefined;
  let preferredAuthMethod: string | undefined;

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    const providerHeader = trimmed.match(/^\[model_providers\.([A-Za-z0-9_-]+)\]$/);
    if (providerHeader) {
      section = { providerId: providerHeader[1]! };
      providers.set(providerHeader[1]!, {
        ...providers.get(providerHeader[1]!),
        hasExplicitAuth: providers.get(providerHeader[1]!)?.hasExplicitAuth ?? false,
      });
      continue;
    }
    if (trimmed.startsWith("[")) {
      section = "other";
      continue;
    }

    if (section === "root") {
      modelProviderId ??= trimmed.match(/^model_provider\s*=\s*"([^"]+)"$/)?.[1];
      preferredAuthMethod ??= trimmed.match(/^preferred_auth_method\s*=\s*"([^"]+)"$/)?.[1];
      if (
        /^requires_openai_auth\s*=\s*false\s*$/.test(trimmed) ||
        /^http_headers\s*=\s*\{\s*"x-openai-actor-authorization"\s*=\s*"codex-sw\.app"\s*\}\s*$/.test(trimmed)
      ) {
        rootLinesToRemove.add(index);
      }
      continue;
    }

    if (typeof section === "object") {
      const provider = providers.get(section.providerId)!;
      const requiresMatch = trimmed.match(/^requires_openai_auth\s*=\s*(true|false)\s*$/);
      if (requiresMatch) {
        provider.requiresOpenAiAuth = requiresMatch[1] === "true";
        provider.requiresLine = index;
      }
      if (
        /^env_key\s*=\s*"([^"\s][^"]*)"\s*$/.test(trimmed) ||
        /^experimental_bearer_token\s*=\s*"([^"\s][^"]*)"\s*$/.test(trimmed) ||
        /\bauthorization\b\s*=/i.test(trimmed)
      ) {
        provider.hasExplicitAuth = true;
      }
    }
  }

  let providerAuthEnabled = false;
  let unresolvedProviderId: string | undefined;
  if (modelProviderId) {
    const provider = providers.get(modelProviderId);
    if (!provider && modelProviderId !== "openai") {
      unresolvedProviderId = modelProviderId;
    } else if (provider && provider.requiresOpenAiAuth === false && !provider.hasExplicitAuth) {
      if (
        (preferredAuthMethod === "apikey" || rootLinesToRemove.size > 0) &&
        hasManagedApiKey &&
        provider.requiresLine !== undefined
      ) {
        lines[provider.requiresLine] = lines[provider.requiresLine]!.replace(/false\s*$/, "true");
        providerAuthEnabled = true;
      } else {
        unresolvedProviderId = modelProviderId;
      }
    }
  }

  if (rootLinesToRemove.size === 0 && !providerAuthEnabled) {
    return {
      changed: false,
      content,
      providerAuthEnabled: false,
      unresolvedProviderId,
    };
  }

  const repairedLines = lines.filter((_, index) => !rootLinesToRemove.has(index));
  return {
    changed: true,
    content: `${repairedLines.join("\n").replace(/\n+$/, "")}\n`,
    providerAuthEnabled,
    unresolvedProviderId,
  };
}

async function readTargetHomeApiKey(homePath: string): Promise<string | undefined> {
  const raw = await readText(join(homePath, "auth.json"));
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as { OPENAI_API_KEY?: unknown };
    return typeof value.OPENAI_API_KEY === "string" && value.OPENAI_API_KEY.trim()
      ? value.OPENAI_API_KEY.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

function hasManagedApiKey(
  env: SwitcherState["envs"][string],
  targetApiKey: string,
): boolean {
  return Object.values(env.accounts).some((account) => (
    (
      (account.authMode === "apikey" || account.runtime.preferredAuthMethod === "apikey") &&
      readAuthApiKey(account.authData) === targetApiKey
    ) || account.runtime.compatibilityRouteToken?.trim() === targetApiKey
  ));
}

function readAuthApiKey(authData: SwitcherState["envs"][string]["accounts"][string]["authData"]): string | undefined {
  const value = authData?.OPENAI_API_KEY;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function clearManagedConfig(configPath: string) {
  const existing = await readText(configPath);
  if (!existing) {
    return;
  }

  const cleaned = removeManagedConfigLines(existing);
  await writeFile(configPath, cleaned ? `${cleaned}\n` : "", "utf8");
}

function removeManagedConfigLines(content: string, options?: { removeModel?: boolean; removeModelCatalogJson?: boolean }): string {
  const lines = content.split(/\r?\n/);
  const kept: string[] = [];
  const managedProviderIds = new Set(
    lines
      .map((line) => line.trim().match(/^model_provider\s*=\s*"([^"]+)"$/)?.[1] ?? "")
      .filter(Boolean),
  );
  let skipManagedProviderSection = false;
  let insideTomlSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (!skipManagedProviderSection) {
        kept.push(line);
      }
      continue;
    }

    const providerHeaderMatch = trimmed.match(/^\[model_providers\.([A-Za-z0-9_-]+)\]$/);
    if (providerHeaderMatch) {
      insideTomlSection = true;
      if (managedProviderIds.has(providerHeaderMatch[1] ?? "")) {
        skipManagedProviderSection = true;
        continue;
      }
    }

    if (skipManagedProviderSection) {
      if (trimmed.startsWith("[")) {
        skipManagedProviderSection = false;
        insideTomlSection = true;
      } else {
        continue;
      }
    } else if (trimmed.startsWith("[")) {
      insideTomlSection = true;
    }

    if (
      trimmed.startsWith("preferred_auth_method") ||
      trimmed.startsWith("openai_base_url") ||
      (options?.removeModel === true && trimmed.startsWith("model = ")) ||
      (options?.removeModelCatalogJson === true && trimmed.startsWith("model_catalog_json = ")) ||
      trimmed.startsWith("model_provider = ") ||
      (!insideTomlSection &&
        (trimmed.startsWith("requires_openai_auth") || trimmed.startsWith("http_headers")))
    ) {
      continue;
    }

    kept.push(line);
  }

  while (kept.length > 0 && kept[0]?.trim() === "") {
    kept.shift();
  }
  while (kept.length > 0 && kept[kept.length - 1]?.trim() === "") {
    kept.pop();
  }

  return kept.join("\n");
}

function quoteTomlString(value: string): string {
  return JSON.stringify(value);
}

function resolveIndependentModelSlug(baseUrl?: string): string | undefined {
  const normalized = baseUrl?.trim().toLowerCase();
  if (!normalized || normalized === "default") return undefined;
  if (normalized.startsWith("https://api.deepseek.com")) return "deepseek-v4-flash";
  if (normalized.startsWith("https://api.xiaomimimo.com/v1")) return "mimo-v2.5-pro";
  return undefined;
}

function resolveManagedModelSlug(runtime: SwitcherState["envs"][string]["accounts"][string]["runtime"]): string | undefined {
  const providerId = (runtime.providerId ?? "").trim().toLowerCase();
  if (providerId === "deepseek") return "deepseek-v4-flash";
  if (providerId === "mimo") return "mimo-v2.5-pro";
  return undefined;
}

function resolveManagedModelCatalogPath(
  configPath: string,
  runtime: SwitcherState["envs"][string]["accounts"][string]["runtime"],
): string | undefined {
  const providerId = (runtime.providerId ?? "").trim().toLowerCase();
  if (providerId !== "deepseek" && providerId !== "mimo") {
    return undefined;
  }
  return join(dirname(configPath), "models.json");
}

function normalizeProviderId(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed || "custom";
}

function normalizeAuthDataForTargetHome(
  authData: NonNullable<SwitcherState["envs"][string]["accounts"][string]["authData"]>,
): NonNullable<SwitcherState["envs"][string]["accounts"][string]["authData"]> {
  const normalized = { ...authData };
  const tokens = normalized.tokens;
  if (typeof tokens === "string") {
    try {
      const parsed = JSON.parse(tokens) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        normalized.tokens = parsed as Record<string, unknown>;
      }
    } catch {
      // Keep the original string when it is not valid JSON.
    }
  }
  return normalized;
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}
