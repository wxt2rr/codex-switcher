import type { RouteProtocol } from "./usage-routing-model.js";

export interface CredentialAccountInput {
  envName: string;
  accountName: string;
  authMode: string;
  protocol?: RouteProtocol;
  providerId?: string;
  apiKey?: string;
  authAccountId?: string;
  baseUrl: string;
  upstreamModel?: string;
  reasoningProfile?: "auto" | "standard" | "reasoning_content" | "think_tags";
  longConversationStrategy?: "safe" | "continuity";
  instructionRole?: "auto" | "system" | "developer";
  requestOverrides?: Record<string, unknown>;
  requestHeaders?: Record<string, string>;
  proxyUrl?: string;
}

export interface ResolvedCredentialCandidate extends CredentialAccountInput {
  providerId: string;
  credentialKind: "auth" | "api_key" | "plugin";
  hasBearerCredential: boolean;
}

export interface ExcludedCredentialCandidate {
  accountName: string;
  reason: "environment_mismatch" | "protocol_incompatible" | "unsupported_auth_mode";
}

export interface CredentialResolution {
  candidates: ResolvedCredentialCandidate[];
  excluded: ExcludedCredentialCandidate[];
}

/**
 * Resolves legacy account records into gateway credentials without reading or
 * transforming the secret itself. The caller remains responsible for loading
 * the bearer token from the existing auth store.
 */
export function resolveCredentialCandidates(
  accounts: CredentialAccountInput[],
  options: { envName: string; protocol: RouteProtocol },
): CredentialResolution {
  const candidates: ResolvedCredentialCandidate[] = [];
  const excluded: ExcludedCredentialCandidate[] = [];

  for (const account of accounts) {
    if (account.envName !== options.envName) {
      excluded.push({ accountName: account.accountName, reason: "environment_mismatch" });
      continue;
    }
    if (options.protocol === "chat_completions" && account.authMode === "auth") {
      excluded.push({ accountName: account.accountName, reason: "protocol_incompatible" });
      continue;
    }
    if (!isSupportedAuthMode(account.authMode)) {
      excluded.push({ accountName: account.accountName, reason: "unsupported_auth_mode" });
      continue;
    }

    candidates.push({
      ...account,
      providerId: account.providerId?.trim() || (account.authMode === "auth" ? "chatgpt" : "openai"),
      credentialKind:
        account.authMode === "auth"
          ? "auth"
          : account.authMode === "apikey"
            ? "api_key"
            : "plugin",
      hasBearerCredential: Boolean(account.apiKey?.trim()),
    });
  }

  return { candidates, excluded };
}

function isSupportedAuthMode(value: string): boolean {
  return value === "auth" || value === "apikey" || value === "provider-profile";
}
