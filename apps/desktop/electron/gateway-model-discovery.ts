import type {
  GatewayCredentialDefinition,
  GatewayEnvironmentState,
  GatewayModelDefinition,
} from "../../../packages/core/dist/gateway/model.js";
import type {
  BuiltInProviderId,
  ProviderAccountRef,
  ProviderAdapter,
  ProviderEndpoint,
  ProviderModel,
  ProviderHttpClient,
  ProviderDefinition,
} from "../../../packages/gateway/dist/provider/adapters.js";
import type { GatewayProtocol } from "../../../packages/core/dist/gateway/model.js";
import type { JsonObject } from "../../../packages/gateway/dist/protocol.js";
import { loadGatewayProviderRuntime } from "./core-runtime.js";
import { getProviderPluginAdapter } from "./provider-plugin-runtime.js";
import { fetchWithOptionalProxy } from "./upstream-proxy.js";

export interface GatewayDiscoveryEnvironment {
  accounts: Record<string, {
    name: string;
    authMode: string;
    runtime?: { providerAuthMethod?: string };
    authData?: Record<string, unknown>;
  }>;
}

export interface GatewayProviderDiscoveryResult {
  models: GatewayModelDefinition[];
  credentialsUsed: number;
}

export interface GatewayAccountDiscoveryResult {
  accountName: string;
  providerId: string;
  models: GatewayModelDefinition[];
}

export async function discoverGatewayProviderModels(input: {
  environment: GatewayDiscoveryEnvironment;
  envName: string;
  gateway: GatewayEnvironmentState;
  providerId: string;
  stateDir?: string;
  fetchImpl?: typeof fetch;
}): Promise<GatewayProviderDiscoveryResult> {
  const providerRuntime = await loadGatewayProviderRuntime();
  const providerDefinition = input.gateway.providers[input.providerId];
  const builtinDefinition = providerRuntime.providerDefinitions().find((definition) => definition.id === input.providerId);
  const builtinAdapter = providerRuntime.createBuiltInProviderAdapters().get(input.providerId as BuiltInProviderId);
  const configuredEndpoints = builtinDefinition && providerDefinition
    ? providerEndpointsForGateway(builtinDefinition.endpoints, providerDefinition.endpoints)
    : undefined;
  const adapter: ProviderAdapter | undefined = builtinDefinition && configuredEndpoints?.length
    ? providerRuntime.createConfiguredProviderAdapter?.(builtinDefinition, configuredEndpoints)
      ?? providerRuntime.createProviderAdapter(builtinDefinition, undefined, configuredEndpoints)
    : builtinAdapter
    ?? (input.stateDir ? await getProviderPluginAdapter(input.stateDir, input.providerId) : undefined);
  if (!adapter) throw new Error(`Provider '${input.providerId}' does not expose a discovery adapter`);
  const credentials = Object.values(input.gateway.credentials).filter((credential) => credential.providerId === input.providerId && credential.status !== "disabled");
  if (!credentials.length) throw new Error(`Provider '${input.providerId}' has no enabled credentials`);
  const client: ProviderHttpClient = {
    async request(url, init, context) {
      const response = await fetchWithOptionalProxy(url, { method: init.method, headers: init.headers, body: init.body }, context?.proxyUrl, input.fetchImpl ?? fetch);
      let payload: unknown = {};
      try { payload = await response.json(); } catch { /* provider may return an empty error body */ }
      return { status: response.status, headers: response.headers, json: async () => (isRecord(payload) ? payload : {}) as JsonObject };
    },
  };
  const models = new Map<string, GatewayModelDefinition>();
  let credentialsUsed = 0;
  for (const credential of credentials) {
    const account = resolveGatewayCredentialAccount(input.environment, input.envName, credential);
    if (!account) continue;
    const secret = resolveGatewayCredentialSecret(account);
    if (account.authMethod !== "none" && !secret) continue;
    const providerAccount: ProviderAccountRef = {
      accountId: account.accountId,
      displayName: credential.displayName,
      authMethod: account.authMethod,
      secretRef: credential.secretRef,
      status: credential.status,
      ...(credential.modelIds ? { allowedModelIds: credential.modelIds } : {}),
      ...((providerDefinition?.proxyUrl || credential.proxyUrl) ? {
        proxyUrl: credential.proxyUrl ?? providerDefinition?.proxyUrl,
      } : {}),
      ...((providerDefinition?.requestHeaders || credential.requestHeaders) ? {
        requestHeaders: { ...(providerDefinition?.requestHeaders ?? {}), ...(credential.requestHeaders ?? {}) },
      } : {}),
    };
    const discovered = await discoverModelsWithPresetFallback(adapter, client, providerAccount, secret, builtinDefinition, configuredEndpoints);
    credentialsUsed += 1;
    for (const model of discovered) {
      const id = `${input.providerId}/${model.id}`;
      models.set(id, {
        id,
        providerId: input.providerId,
        upstreamModelId: model.id,
        displayName: model.displayName,
        protocols: model.protocols,
        capabilities: model.capabilities,
        enabled: true,
      });
    }
  }
  if (!credentialsUsed) throw new Error(`Provider '${input.providerId}' has no resolvable credential secret`);
  return { models: [...models.values()].sort((left, right) => left.id.localeCompare(right.id)), credentialsUsed };
}

/**
 * Discovers models for exactly one environment account.  The provider-level
 * discovery function is kept for gateway administration, while account
 * onboarding needs this narrower contract so one credential never leaks into
 * another account's model selection list.
 */
export async function discoverGatewayAccountModels(input: {
  environment: GatewayDiscoveryEnvironment;
  envName: string;
  accountName: string;
  gateway: GatewayEnvironmentState;
  providerId: string;
  stateDir?: string;
  fetchImpl?: typeof fetch;
}): Promise<GatewayAccountDiscoveryResult> {
  const providerRuntime = await loadGatewayProviderRuntime();
  const providerDefinition = input.gateway.providers[input.providerId];
  const builtinDefinition = providerRuntime.providerDefinitions().find((definition) => definition.id === input.providerId);
  const builtinAdapter = providerRuntime.createBuiltInProviderAdapters().get(input.providerId as BuiltInProviderId);
  const configuredEndpoints = builtinDefinition && providerDefinition
    ? providerEndpointsForGateway(builtinDefinition.endpoints, providerDefinition.endpoints)
    : undefined;
  const adapter: ProviderAdapter | undefined = builtinDefinition && configuredEndpoints?.length
    ? providerRuntime.createConfiguredProviderAdapter?.(builtinDefinition, configuredEndpoints)
      ?? providerRuntime.createProviderAdapter(builtinDefinition, undefined, configuredEndpoints)
    : builtinAdapter
    ?? (input.stateDir ? await getProviderPluginAdapter(input.stateDir, input.providerId) : undefined);
  if (!adapter) throw new Error(`Provider '${input.providerId}' does not expose a discovery adapter`);

  const credential = Object.values(input.gateway.credentials).find((candidate) => {
    if (candidate.providerId !== input.providerId || candidate.status === "disabled") return false;
    const account = resolveGatewayCredentialAccount(input.environment, input.envName, candidate);
    return account?.accountName === input.accountName;
  });
  if (!credential) {
    throw new Error(`Provider '${input.providerId}' has no enabled credential for account '${input.accountName}'`);
  }
  const account = resolveGatewayCredentialAccount(input.environment, input.envName, credential);
  if (!account) throw new Error(`Account '${input.envName}/${input.accountName}' could not be resolved for discovery`);
  const secret = resolveGatewayCredentialSecret(account);
  if (account.authMethod !== "none" && !secret) {
    throw new Error(`Account '${input.envName}/${input.accountName}' has no resolvable credential secret`);
  }
  const client: ProviderHttpClient = {
    async request(url, init, context) {
      const response = await fetchWithOptionalProxy(url, { method: init.method, headers: init.headers, body: init.body }, context?.proxyUrl, input.fetchImpl ?? fetch);
      let payload: unknown = {};
      try { payload = await response.json(); } catch { /* provider may return an empty error body */ }
      return { status: response.status, headers: response.headers, json: async () => (isRecord(payload) ? payload : {}) as JsonObject };
    },
  };
  const providerAccount: ProviderAccountRef = {
    accountId: account.accountId,
    displayName: credential.displayName,
    authMethod: account.authMethod,
    secretRef: credential.secretRef,
    status: credential.status,
    ...(credential.modelIds ? { allowedModelIds: credential.modelIds } : {}),
    ...((providerDefinition?.proxyUrl || credential.proxyUrl) ? {
      proxyUrl: credential.proxyUrl ?? providerDefinition?.proxyUrl,
    } : {}),
    ...((providerDefinition?.requestHeaders || credential.requestHeaders) ? {
      requestHeaders: { ...(providerDefinition?.requestHeaders ?? {}), ...(credential.requestHeaders ?? {}) },
    } : {}),
  };
  const discovered = await discoverModelsWithPresetFallback(adapter, client, providerAccount, secret, builtinDefinition, configuredEndpoints);
  const models = discovered.map((model) => ({
    id: `${input.providerId}/${model.id}`,
    providerId: input.providerId,
    upstreamModelId: model.id,
    displayName: model.displayName,
    protocols: model.protocols,
    capabilities: model.capabilities,
    enabled: true,
  })).sort((left, right) => left.id.localeCompare(right.id));
  return { accountName: input.accountName, providerId: input.providerId, models };
}

function providerEndpointsForGateway(
  defaults: readonly ProviderEndpoint[],
  configured: { responses?: string; chatCompletions?: string; anthropicMessages?: string; gemini?: string },
): ProviderEndpoint[] {
  return defaults.flatMap((endpoint) => {
    const baseUrl = configuredBaseUrl(configured, endpoint.protocol);
    return baseUrl ? [{ ...endpoint, baseUrl }] : [];
  });
}

async function discoverModelsWithPresetFallback(
  adapter: ProviderAdapter,
  client: ProviderHttpClient,
  account: ProviderAccountRef,
  secret: string,
  definition: ProviderDefinition | undefined,
  configuredEndpoints: readonly ProviderEndpoint[] | undefined,
): Promise<ProviderModel[]> {
  try {
    return await adapter.discoverModels(client, account, secret);
  } catch (error) {
    // Subscription/OAuth services frequently do not expose a public model
    // listing endpoint. Their adapter presets are still a valid selectable
    // catalog, while API-key failures must remain visible to the user.
    if (!definition?.presets.length || (account.authMethod !== "subscription" && account.authMethod !== "oauth")) {
      throw error;
    }
    const endpoints = configuredEndpoints?.length ? configuredEndpoints : definition.endpoints;
    const protocols = [...new Set(endpoints.map((endpoint) => endpoint.protocol))];
    return definition.presets.map((id) => ({
      id,
      displayName: id,
      providerId: definition.id,
      iconKey: definition.iconKey,
      protocols,
      capabilities: {
        reasoning: /reason|o[1-9]|opus|sonnet|think/i.test(id),
        tools: true,
        vision: /vision|gemini|claude|gpt-4/i.test(id),
        streaming: true,
      },
      source: "preset" as const,
    }));
  }
}

function configuredBaseUrl(
  configured: { responses?: string; chatCompletions?: string; anthropicMessages?: string; gemini?: string },
  protocol: GatewayProtocol,
): string | undefined {
  const value = protocol === "responses"
    ? configured.responses
    : protocol === "chat_completions"
      ? configured.chatCompletions
      : protocol === "anthropic"
        ? configured.anthropicMessages
        : configured.gemini;
  return value?.trim() || undefined;
}

function resolveGatewayCredentialAccount(
  environment: GatewayDiscoveryEnvironment,
  envName: string,
  credential: GatewayCredentialDefinition,
): { accountName: string; accountId: string; authMethod: "api_key" | "oauth" | "subscription" | "none"; authData?: Record<string, unknown> } | undefined {
  const parts = credential.secretRef.split(":");
  const referencedAccount = parts.length >= 3 && parts[0] === "account" && decodeURIComponent(parts[1] ?? "") === envName
    ? decodeURIComponent(parts.slice(2).join(":"))
    : undefined;
  const entry = referencedAccount && environment.accounts[referencedAccount]
    ? [referencedAccount, environment.accounts[referencedAccount]] as const
    : Object.entries(environment.accounts).find(([name, account]) => name === credential.displayName || account.name === credential.displayName);
  if (!entry) return undefined;
  const [accountName, account] = entry;
  const configuredAuthMethod = account.runtime?.providerAuthMethod;
  const authMethod = configuredAuthMethod === "subscription"
    ? "subscription"
    : configuredAuthMethod === "oauth"
      ? "oauth"
      : configuredAuthMethod === "none"
        ? "none"
        : account.authMode === "auth" ? "subscription" : account.authMode === "apikey" ? "api_key" : "none";
  return {
    accountName,
    accountId: readAuthString(account.authData, "account_id") ?? accountName,
    authMethod,
    authData: account.authData,
  };
}

function resolveGatewayCredentialSecret(account: { authMethod: "api_key" | "oauth" | "subscription" | "none"; authData?: Record<string, unknown> }): string {
  if (account.authMethod === "none") return "";
  if (account.authMethod === "api_key") return readAuthString(account.authData, "OPENAI_API_KEY") ?? readAuthString(account.authData, "access_token") ?? "";
  const rawTokens = account.authData?.tokens;
  if (!rawTokens) return "";
  try {
    const parsed = typeof rawTokens === "string" ? JSON.parse(rawTokens) as Record<string, unknown> : rawTokens as Record<string, unknown>;
    return typeof parsed.access_token === "string" ? parsed.access_token.trim() : "";
  } catch {
    return "";
  }
}

function readAuthString(authData: Record<string, unknown> | undefined, field: string): string | undefined {
  const value = authData?.[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
