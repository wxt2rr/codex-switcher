import type {
  AccountState,
  EnvState,
} from "../../../packages/core/dist/state/store.js";
import type {
  GatewayCredentialDefinition,
  GatewayCredentialKind,
  GatewayEnvironmentState,
  GatewayProviderDefinition,
  GatewayProviderKind,
  GatewayProtocol,
} from "../../../packages/core/dist/gateway/model.js";

export interface GatewayAccountSyncOptions {
  /** Limit reconciliation to the account being discovered. */
  accountNames?: readonly string[];
  /** Rebind existing route members after a provider id change. */
  rebindRoutes?: boolean;
}

/**
 * Returns the provider selected by the account runtime. The gateway must use
 * this same id; otherwise discovery can fail before an upstream request is
 * even attempted because the credential lookup is provider-scoped.
 */
export function resolveRuntimeProviderId(account: Pick<AccountState, "authMode" | "runtime">): string {
  return account.runtime.providerId?.trim()
    || (account.authMode === "auth" ? "chatgpt" : "openai");
}

export function createAccountSecretRef(envName: string, accountName: string): string {
  return `account:${encodeURIComponent(envName)}:${encodeURIComponent(accountName)}`;
}

/**
 * Builds a discovery-safe gateway view. It is a clone and never mutates the
 * persisted gateway, so a failed discovery cannot publish a half-synchronized
 * provider/credential document.
 */
export function createGatewayAccountDiscoveryView(
  environment: EnvState,
  gateway: GatewayEnvironmentState,
  accountName: string,
): GatewayEnvironmentState {
  return synchronizeGatewayAccountMetadata(environment, gateway, {
    accountNames: [accountName],
    rebindRoutes: false,
  });
}

/**
 * Reconciles persisted gateway metadata with account runtime metadata.
 *
 * Secrets remain in the account store. This function only fixes references
 * and protocol metadata, and preserves provider-specific endpoint/header/
 * proxy settings whenever a provider id is renamed or newly introduced.
 */
export function synchronizeGatewayAccountMetadata(
  environment: EnvState,
  gateway: GatewayEnvironmentState,
  options: GatewayAccountSyncOptions = {},
): GatewayEnvironmentState {
  const next = structuredClone(gateway);
  const selected = options.accountNames ? new Set(options.accountNames) : undefined;
  const changedCredentials = new Map<string, { oldProviderId: string; newProviderId: string }>();

  for (const [accountName, account] of Object.entries(environment.accounts)) {
    if (selected && !selected.has(accountName)) continue;
    const secretRef = createAccountSecretRef(environment.name, accountName);
    const credentialEntry = Object.entries(next.credentials).find(([, credential]) => credential.secretRef === secretRef);
    if (!credentialEntry) continue;

    const [credentialId, credential] = credentialEntry;
    const providerId = resolveRuntimeProviderId(account);
    const oldProviderId = credential.providerId;
    next.credentials[credentialId] = synchronizeCredential(
      credential,
      account,
      providerId,
      secretRef,
    );
    ensureProviderForAccount(next, environment, accountName, account, providerId, oldProviderId);
    if (oldProviderId !== providerId) {
      changedCredentials.set(credentialId, { oldProviderId, newProviderId: providerId });
    }
  }

  if (options.rebindRoutes !== false && changedCredentials.size) {
    rebindAccountRoutes(next, changedCredentials);
  }

  return next;
}

function synchronizeCredential(
  credential: GatewayCredentialDefinition,
  account: AccountState,
  providerId: string,
  secretRef: string,
): GatewayCredentialDefinition {
  const protocol = account.authMode === "auth"
    ? "responses" as const
    : account.runtime.apiProtocol ?? "responses";
  return {
    ...credential,
    providerId,
    displayName: account.name.trim() || credential.displayName,
    kind: resolveCredentialKind(account),
    secretRef,
    supportedProtocols: uniqueProtocols([protocol, ...credential.supportedProtocols]),
  };
}

function resolveCredentialKind(account: AccountState): GatewayCredentialKind {
  if (account.authMode === "auth") return "auth";
  switch (account.runtime.providerAuthMethod) {
    case "oauth": return "oauth";
    case "subscription": return "oauth";
    case "plugin": return "plugin";
    case "none": return "local";
    case "api_key": return "api_key";
    default: return account.authMode === "apikey" ? "api_key" : "plugin";
  }
}

function ensureProviderForAccount(
  gateway: GatewayEnvironmentState,
  environment: EnvState,
  accountName: string,
  account: AccountState,
  providerId: string,
  oldProviderId: string,
): void {
  const existing = gateway.providers[providerId];
  if (existing) {
    ensureAccountProtocolEndpoint(existing, account);
    gateway.providers[providerId] = existing;
    return;
  }

  // A provider id can be changed in runtime before the gateway document is
  // rebuilt. Preserve the old provider's custom endpoint and headers so an
  // active environment keeps using the configured upstream rather than
  // silently falling back to a vendor default.
  const oldProvider = gateway.providers[oldProviderId];
  const provider = oldProvider
    ? {
        ...oldProvider,
        id: providerId,
        displayName: providerId,
      }
    : buildProviderFromAccount(environment, accountName, account, providerId);
  ensureAccountProtocolEndpoint(provider, account);
  gateway.providers[providerId] = provider;
}

function buildProviderFromAccount(
  _environment: EnvState,
  _accountName: string,
  account: AccountState,
  providerId: string,
): GatewayProviderDefinition {
  const protocol = account.authMode === "auth"
    ? "responses" as const
    : account.runtime.apiProtocol ?? "responses";
  const endpoint = resolveAccountBaseUrl(account);
  return {
    id: providerId,
    displayName: providerId,
    kind: resolveProviderKind(account, providerId),
    endpoints: endpointForProtocol(protocol, endpoint),
    modelDiscovery: "manual",
    enabled: true,
  };
}

function resolveProviderKind(account: AccountState, providerId: string): GatewayProviderKind {
  if (account.authMode === "auth") return "chatgpt";
  if (providerId === "anthropic" || providerId === "gemini") return providerId;
  return providerId === "openai" ? "openai" : "custom";
}

function ensureAccountProtocolEndpoint(
  provider: GatewayProviderDefinition,
  account: AccountState,
): void {
  const protocol = account.authMode === "auth"
    ? "responses" as const
    : account.runtime.apiProtocol ?? "responses";
  const endpoint = resolveAccountBaseUrl(account);
  if (!endpoint) return;
  const endpoints = { ...provider.endpoints };
  const key = protocolEndpointKey(protocol);
  if (!endpoints[key]) endpoints[key] = endpoint;
  provider.endpoints = endpoints;
}

function resolveAccountBaseUrl(account: AccountState): string | undefined {
  const custom = account.runtime.openaiBaseUrlMode === "custom"
    ? account.runtime.openaiBaseUrl?.trim()
    : undefined;
  if (custom) return custom;
  return account.authMode === "auth"
    ? "https://chatgpt.com/backend-api/codex"
    : "https://api.openai.com/v1";
}

function endpointForProtocol(
  protocol: GatewayProtocol,
  endpoint: string | undefined,
): GatewayProviderDefinition["endpoints"] {
  if (!endpoint) return {};
  return { [protocolEndpointKey(protocol)]: endpoint };
}

function protocolEndpointKey(protocol: GatewayProtocol): keyof GatewayProviderDefinition["endpoints"] {
  switch (protocol) {
    case "chat_completions": return "chatCompletions";
    case "anthropic": return "anthropicMessages";
    case "gemini": return "gemini";
    default: return "responses";
  }
}

function uniqueProtocols(protocols: readonly GatewayProtocol[]): GatewayProtocol[] {
  return [...new Set(protocols)];
}

function rebindAccountRoutes(
  gateway: GatewayEnvironmentState,
  changedCredentials: ReadonlyMap<string, { oldProviderId: string; newProviderId: string }>,
): void {
  const changedModels = new Map<string, string>();
  for (const group of Object.values(gateway.routeGroups)) {
    for (const member of group.members) {
      const credentialIds = member.credentialSelector.credentialIds ?? [];
      const change = credentialIds
        .map((credentialId) => changedCredentials.get(credentialId))
        .find((candidate): candidate is { oldProviderId: string; newProviderId: string } => Boolean(candidate));
      if (!change || member.providerId !== change.oldProviderId) continue;
      member.providerId = change.newProviderId;
      if (member.credentialSelector.providerId === change.oldProviderId) {
        member.credentialSelector.providerId = change.newProviderId;
      }
      changedModels.set(member.modelId, change.newProviderId);
    }
  }
  for (const [modelId, providerId] of changedModels) {
    const model = gateway.models[modelId];
    if (model?.providerId) model.providerId = providerId;
  }
}
