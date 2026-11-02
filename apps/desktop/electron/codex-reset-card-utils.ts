import { createHash, randomUUID } from "node:crypto";

import type {
  AccountState,
  AuthDataRecord,
  SwitcherState,
} from "../../../packages/core/dist/state/store.js";
import type {
  ResetCardAccountReference,
  ResetCardDetail,
  ResetCardSettings,
  ResetCardType,
  SubscriptionUsageWindow,
} from "../src/reset-card-model.js";

export interface CodexSubscriptionAccount extends ResetCardAccountReference {
  authFile: string;
  homePath: string;
  accountId?: string;
  workspaceId?: string;
  accessToken: string;
  proxyUrl?: string;
  references?: ResetCardAccountReference[];
}

export interface StoredResetCard extends ResetCardDetail {
  creditId: string;
}

export interface StoredUsageWindow extends SubscriptionUsageWindow {}

export function normalizeTokenValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

export function parseAuthDataTokens(authData: AuthDataRecord | Record<string, unknown> | undefined): Record<string, unknown> {
  const raw = authData?.tokens;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function decodeJwtPayload(token: string | undefined): Record<string, unknown> {
  if (!token) return {};
  const payload = token.split(".")[1];
  if (!payload) return {};
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function nestedAuthClaims(claims: Record<string, unknown>): Record<string, unknown> {
  const nested = claims["https://api.openai.com/auth"];
  return nested && typeof nested === "object" && !Array.isArray(nested) ? nested as Record<string, unknown> : {};
}

export function extractSubscriptionCredentials(authData: AuthDataRecord | Record<string, unknown> | undefined): {
  accessToken?: string;
  accountId?: string;
  workspaceId?: string;
  email?: string;
  plan?: string;
} {
  const tokens = parseAuthDataTokens(authData);
  const accessToken = normalizeTokenValue(tokens.access_token) ?? normalizeTokenValue(authData?.access_token);
  const idToken = normalizeTokenValue(tokens.id_token) ?? normalizeTokenValue(authData?.id_token);
  const claims = decodeJwtPayload(idToken ?? accessToken);
  const authClaims = nestedAuthClaims(claims);
  const value = (...values: unknown[]) => values.find((item): item is string => typeof item === "string" && Boolean(item.trim()))?.trim();
  return {
    accessToken,
    accountId: value(
      tokens.account_id,
      authData?.account_id,
      authClaims.chatgpt_account_id,
      claims.chatgpt_account_id,
      claims.account_id,
    ),
    workspaceId: value(
      tokens.workspace_id,
      authData?.workspace_id,
      authClaims.chatgpt_workspace_id,
      claims.chatgpt_workspace_id,
      claims.workspace_id,
    ),
    email: value(authData?.email, claims.email),
    plan: value(authData?.plan_type, authData?.chatgpt_plan_type, authClaims.chatgpt_plan_type, claims.chatgpt_plan_type),
  };
}

export function canonicalAccountKey(input: {
  providerId?: string;
  accountId?: string;
  workspaceId?: string;
  email?: string;
  accessToken?: string;
}): string {
  const provider = input.providerId?.trim().toLowerCase() || "codex-subscription";
  const account = input.accountId?.trim().toLowerCase()
    || input.email?.trim().toLowerCase()
    || (input.accessToken ? `token-${createHash("sha256").update(input.accessToken).digest("hex").slice(0, 24)}` : "unknown");
  const workspace = input.workspaceId?.trim().toLowerCase();
  return `${provider}:${account}${workspace ? `:${workspace}` : ""}`;
}

export function safeCardId(creditId: string): string {
  return `card-${createHash("sha256").update(creditId).digest("hex").slice(0, 12)}`;
}

export function newRedeemRequestId(): string {
  return randomUUID();
}

export function resetCardType(value: unknown): ResetCardType {
  const normalized = String(value ?? "").toLowerCase().replace(/[_\s]+/g, "-");
  if (normalized.includes("five") || normalized.includes("5h") || normalized.includes("hour")) return "five-hour";
  if (normalized.includes("week") || normalized.includes("7d")) return "weekly";
  return "unknown";
}

export function buildAccountReferences(state: SwitcherState): Map<string, ResetCardAccountReference[]> {
  const references = new Map<string, ResetCardAccountReference[]>();
  for (const [envName, env] of Object.entries(state.envs)) {
    for (const [accountName, account] of Object.entries(env.accounts)) {
      if (!isEligibleSubscriptionAccount(account)) continue;
      const credentials = extractSubscriptionCredentials(account.authData);
      if (!credentials.accessToken) continue;
      const accountKey = canonicalAccountKey({
        providerId: account.runtime.providerId,
        accountId: credentials.accountId,
        workspaceId: credentials.workspaceId,
        email: credentials.email,
        accessToken: credentials.accessToken,
      });
      const next: ResetCardAccountReference = {
        accountKey,
        envName,
        accountName,
        authMode: account.authMode,
        ...(account.runtime.providerId ? { providerId: account.runtime.providerId } : {}),
        ...(account.runtime.preferredAuthMethod ? { preferredAuthMethod: account.runtime.preferredAuthMethod } : {}),
      };
      references.set(accountKey, [...(references.get(accountKey) ?? []), next]);
    }
  }
  return references;
}

export function isEligibleSubscriptionAccount(account: AccountState): boolean {
  const providerId = account.runtime.providerId?.trim().toLowerCase();
  return account.authMode === "auth"
    && account.runtime.preferredAuthMethod === "chatgpt"
    && (!providerId || ["openai", "chatgpt", "chatgpt-subscription", "codex-subscription"].includes(providerId));
}

export function effectiveResetSettings(settings: ResetCardSettings, accountKey: string): {
  enabled: boolean;
  mode: ResetCardSettings["autoUseMode"];
  preConsumeMode: ResetCardSettings["preConsumeMode"];
  graceSeconds: number;
} {
  const override = settings.perAccount[accountKey];
  const mode = override?.autoUseMode ?? settings.autoUseMode;
  return {
    enabled: override?.enabled ?? mode !== "off",
    mode: override?.enabled === false ? "off" : mode,
    preConsumeMode: override?.preConsumeMode ?? settings.preConsumeMode,
    graceSeconds: settings.preConsumeGraceSeconds,
  };
}
