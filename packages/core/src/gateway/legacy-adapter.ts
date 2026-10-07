import type { AccountState, EnvState } from "../state/store.js";
import {
  GATEWAY_SCHEMA_VERSION,
  type GatewayCredentialDefinition,
  type GatewayEnvironmentState,
  type GatewayModelDefinition,
  type GatewayProviderDefinition,
} from "./model.js";

/**
 * Projects the legacy environment/account shape into the gateway domain.
 *
 * This is intentionally metadata-only: secretRef points back to the existing
 * account credential storage and no access token/API key is copied into the
 * gateway state. The generated state stays in direct mode until the user
 * explicitly enables the gateway.
 */
export function buildLegacyGatewayEnvironmentState(
  environment: EnvState,
): GatewayEnvironmentState {
  const providers: Record<string, GatewayProviderDefinition> = {};
  const credentials: Record<string, GatewayCredentialDefinition> = {};
  const models: Record<string, GatewayModelDefinition> = {};
  const routeGroups: GatewayEnvironmentState["routeGroups"] = {};

  for (const [accountName, account] of Object.entries(environment.accounts)) {
    const providerId = resolveLegacyProviderId(account);
    const credentialId = createLegacyId("credential", environment.name, accountName);
    const modelId = resolveLegacyModelId(account, providerId);

    providers[providerId] ??= buildLegacyProvider(providerId, account);
    credentials[credentialId] = buildLegacyCredential(
      credentialId,
      environment.name,
      accountName,
      account,
    );

    if (modelId) {
      models[modelId] ??= buildLegacyModel(modelId, providerId, account);
      const upstreamModelId = models[modelId].upstreamModelId;
      const routeGroupId = createLegacyRouteGroupId(environment.name, upstreamModelId);
      const group = routeGroups[routeGroupId] ?? {
        id: routeGroupId,
        displayName: upstreamModelId,
        exposedModelId: upstreamModelId,
        members: [],
        strategy: "smart" as const,
        sessionPolicy: "auto" as const,
        fallbackEnabled: true,
      };
      group.members.push({
        providerId,
        modelId,
        credentialSelector: { credentialIds: [credentialId] },
        priority: group.members.length,
        weight: 1,
      });
      routeGroups[routeGroupId] = group;
    }
  }

  return {
    schemaVersion: GATEWAY_SCHEMA_VERSION,
    mode: "direct",
    gatewayId: createLegacyId("gateway", environment.name),
    providers,
    credentials,
    models,
    routeGroups,
    catalogVersion: 0,
  };
}

function resolveLegacyProviderId(account: AccountState): string {
  if (account.runtime.providerId?.trim()) {
    return account.runtime.providerId.trim();
  }

  return account.authMode === "auth" ? "chatgpt" : "openai";
}

function resolveLegacyModelId(
  account: AccountState,
  providerId: string,
): string | undefined {
  const model = account.runtime.model?.trim();
  if (!model) return undefined;
  return `${providerId}/${model}`;
}

function buildLegacyProvider(
  providerId: string,
  account: AccountState,
): GatewayProviderDefinition {
  const baseUrl = resolveLegacyBaseUrl(account);
  const protocol = account.runtime.apiProtocol ?? "responses";

  return {
    id: providerId,
    displayName: providerId,
    kind: account.authMode === "auth" ? "chatgpt" : "openai",
    endpoints:
      protocol === "chat_completions"
        ? { chatCompletions: baseUrl }
        : { responses: baseUrl },
    modelDiscovery: "manual",
    enabled: true,
  };
}

function buildLegacyCredential(
  credentialId: string,
  environmentName: string,
  accountName: string,
  account: AccountState,
): GatewayCredentialDefinition {
  return {
    id: credentialId,
    providerId: resolveLegacyProviderId(account),
    displayName: account.name || accountName,
    kind:
      account.authMode === "auth"
        ? "auth"
        : account.authMode === "apikey"
          ? "api_key"
          : "plugin",
    secretRef: createLegacyId("account", environmentName, accountName),
    supportedProtocols: [account.runtime.apiProtocol ?? "responses"],
    status: "active",
    weight: 1,
    priority: 0,
  };
}

function buildLegacyModel(
  modelId: string,
  providerId: string,
  account: AccountState,
): GatewayModelDefinition {
  const upstreamModelId = modelId.slice(providerId.length + 1);
  return {
    id: modelId,
    providerId,
    upstreamModelId,
    displayName: upstreamModelId,
    protocols: [account.runtime.apiProtocol ?? "responses"],
    capabilities: {},
    enabled: true,
  };
}

function resolveLegacyBaseUrl(account: AccountState): string {
  if (
    account.runtime.openaiBaseUrlMode === "custom" &&
    account.runtime.openaiBaseUrl?.trim()
  ) {
    return account.runtime.openaiBaseUrl.trim();
  }

  return account.authMode === "auth"
    ? "https://chatgpt.com/backend-api/codex"
    : "https://api.openai.com/v1";
}

function createLegacyId(prefix: string, ...parts: string[]): string {
  return [prefix, ...parts].map((part) => encodeURIComponent(part)).join(":");
}

export function createLegacyRouteGroupId(environmentName: string, upstreamModelId: string): string {
  return createLegacyId("route-group", environmentName, upstreamModelId);
}
