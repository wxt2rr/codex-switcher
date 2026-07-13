import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { SwitcherState, TargetName } from "../state/store.js";

export interface ApplyTargetHomeStateOptions {
  state: SwitcherState;
  target: TargetName;
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
      !account.runtime.compatibilityRouteToken ||
      !account.runtime.compatibilityRouteProviderId)
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
  const cleaned = removeManagedConfigLines(existing);
  const managedLines = [`preferred_auth_method = "${runtime.preferredAuthMethod}"`];

  if (
    runtime.apiProtocol === "chat_completions" &&
    runtime.compatibilityRouteEnabled &&
    runtime.compatibilityRouteBaseUrl &&
    runtime.compatibilityRouteProviderId
  ) {
    managedLines.push("");
    managedLines.push(`model_provider = ${quoteTomlString(runtime.compatibilityRouteProviderId)}`);
    managedLines.push("");
    managedLines.push(`[model_providers.${runtime.compatibilityRouteProviderId}]`);
    managedLines.push(`name = ${quoteTomlString(runtime.compatibilityRouteProviderId)}`);
    managedLines.push(`base_url = ${quoteTomlString(runtime.compatibilityRouteBaseUrl)}`);
    managedLines.push('wire_api = "responses"');
    managedLines.push('env_key = "OPENAI_API_KEY"');
  }

  if (
    runtime.apiProtocol !== "chat_completions" &&
    runtime.preferredAuthMethod === "apikey" &&
    runtime.openaiBaseUrlMode === "custom" &&
    runtime.openaiBaseUrl
  ) {
    managedLines.push(`openai_base_url = "${runtime.openaiBaseUrl}"`);
  }
  if (runtime.independentModelEnabled && runtime.preferredAuthMethod === "chatgpt") {
    const providerId = normalizeProviderId(runtime.independentModelProviderId);
    managedLines.push("");
    managedLines.push(`model_provider = ${quoteTomlString(providerId)}`);
    managedLines.push("");
    managedLines.push(`[model_providers.${providerId}]`);
    managedLines.push(`name = ${quoteTomlString(providerId)}`);
    managedLines.push('model = "gpt-5.4"');
    managedLines.push(`base_url = ${quoteTomlString(runtime.independentModelBaseUrl ?? "")}`);
    managedLines.push(
      `experimental_bearer_token = ${quoteTomlString(runtime.independentModelApiKey ?? "")}`,
    );
    managedLines.push("requires_openai_auth = true");
  }

  const content = `${managedLines.join("\n")}${cleaned ? `\n${cleaned}` : ""}\n`;
  await writeFile(configPath, content, "utf8");
}

async function clearManagedConfig(configPath: string) {
  const existing = await readText(configPath);
  if (!existing) {
    return;
  }

  const cleaned = removeManagedConfigLines(existing);
  await writeFile(configPath, cleaned ? `${cleaned}\n` : "", "utf8");
}

function removeManagedConfigLines(content: string): string {
  const lines = content.split(/\r?\n/);
  const kept: string[] = [];
  const managedProviderIds = new Set(
    lines
      .map((line) => line.trim().match(/^model_provider\s*=\s*"([^"]+)"$/)?.[1] ?? "")
      .filter(Boolean),
  );
  let skipManagedProviderSection = false;

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
      if (managedProviderIds.has(providerHeaderMatch[1] ?? "")) {
        skipManagedProviderSection = true;
        continue;
      }
    }

    if (skipManagedProviderSection) {
      if (trimmed.startsWith("[")) {
        skipManagedProviderSection = false;
      } else {
        continue;
      }
    }

    if (
      trimmed.startsWith("preferred_auth_method") ||
      trimmed.startsWith("openai_base_url") ||
      trimmed.startsWith("model_provider = ")
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
