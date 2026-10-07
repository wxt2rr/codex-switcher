import type {
  GatewayCredentialDefinition,
  GatewayEnvironmentState,
  GatewayModelDefinition,
} from "../../../packages/core/dist/gateway/model.js";
import type {
  BuiltInProviderId,
  ProviderAccountRef,
  ProviderAdapter,
  ProviderHttpClient,
} from "../../../packages/gateway/dist/provider/adapters.js";
import type { JsonObject } from "../../../packages/gateway/dist/protocol.js";
import { loadGatewayProviderRuntime } from "./core-runtime.js";
import { getProviderPluginAdapter } from "./provider-plugin-runtime.js";
import { fetchWithOptionalProxy } from "./upstream-proxy.js";

export interface GatewayDiscoveryEnvironment {
  accounts: Record<string, {
    name: string;
    authMode: string;
    authData?: Record<string, unknown>;
  }>;
}

export interface GatewayProviderDiscoveryResult {
  models: GatewayModelDefinition[];
  credentialsUsed: number;
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
  const adapter: ProviderAdapter | undefined = providerRuntime.createBuiltInProviderAdapters().get(input.providerId as BuiltInProviderId)
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
  const providerDefinition = input.gateway.providers[input.providerId];
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
    const discovered = await adapter.discoverModels(client, providerAccount, secret);
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
  return {
    accountName,
    accountId: readAuthString(account.authData, "account_id") ?? accountName,
    authMethod: account.authMode === "auth" ? "subscription" : account.authMode === "apikey" ? "api_key" : "none",
    authData: account.authData,
  };
}

function resolveGatewayCredentialSecret(account: { authMethod: "api_key" | "oauth" | "subscription" | "none"; authData?: Record<string, unknown> }): string {
  if (account.authMethod === "none") return "";
  if (account.authMethod === "api_key") return readAuthString(account.authData, "OPENAI_API_KEY") ?? "";
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
