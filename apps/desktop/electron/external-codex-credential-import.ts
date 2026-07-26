export type ExternalCodexCredentialSource = "sub2api" | "cpa";

export interface NormalizedCodexCredential {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  accountId?: string;
  lastRefresh?: string;
  email?: string;
  name?: string;
}

export interface CodexChatGptAuthJson {
  auth_mode: "chatgpt";
  OPENAI_API_KEY: null;
  tokens: {
    access_token: string;
    id_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
  last_refresh: string;
}

type JsonObject = Record<string, unknown>;

export function parseExternalCodexCredentials(
  raw: string | undefined,
  source: ExternalCodexCredentialSource,
): NormalizedCodexCredential[] {
  if (!raw?.trim()) {
    throw formatError(source, "credential JSON is required");
  }

  return source === "sub2api"
    ? parseSub2ApiInput(raw.trim())
    : parseCpaInput(raw.trim());
}

export function buildCodexChatGptAuthJson(
  credential: NormalizedCodexCredential,
  now: Date = new Date(),
): CodexChatGptAuthJson {
  const accessToken = credential.accessToken.trim();
  if (!accessToken) {
    throw new Error("credential is missing an access token");
  }

  const tokens: CodexChatGptAuthJson["tokens"] = {
    access_token: accessToken,
  };
  if (credential.idToken?.trim()) {
    tokens.id_token = credential.idToken.trim();
  }
  if (credential.refreshToken?.trim()) {
    tokens.refresh_token = credential.refreshToken.trim();
  }
  if (credential.accountId?.trim()) {
    tokens.account_id = credential.accountId.trim();
  }

  const suppliedLastRefresh = credential.lastRefresh?.trim();
  const lastRefresh = suppliedLastRefresh && !Number.isNaN(Date.parse(suppliedLastRefresh))
    ? suppliedLastRefresh
    : now.toISOString();

  return {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens,
    last_refresh: lastRefresh,
  };
}

export function buildImportedAccountNames(baseName: string, count: number): string[] {
  const normalizedBaseName = baseName.trim();
  if (!normalizedBaseName) {
    throw new Error("account name is required");
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("credential batch must contain at least one account");
  }

  return Array.from({ length: count }, (_, index) =>
    index === 0 ? normalizedBaseName : `${normalizedBaseName}-${index + 1}`,
  );
}

function parseSub2ApiInput(raw: string): NormalizedCodexCredential[] {
  const parsed = tryParseJson(raw);
  if (parsed.ok) {
    return parseSub2ApiValue(parsed.value);
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    throw formatError("sub2api", "credential content is empty");
  }

  return lines.flatMap((line, index) => {
    const lineValue = tryParseJson(line);
    if (lineValue.ok) {
      return parseSub2ApiValue(lineValue.value, index + 1);
    }
    if (looksLikeJson(line)) {
      throw formatError("sub2api", `item ${index + 1} contains invalid JSON`);
    }
    return [normalizeSub2ApiValue(line, index + 1)];
  });
}

function parseSub2ApiValue(value: unknown, position?: number): NormalizedCodexCredential[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw formatError("sub2api", "credential batch is empty");
    }
    return value.flatMap((item, index) => parseSub2ApiValue(item, index + 1));
  }

  if (isObject(value) && ("content" in value || "contents" in value)) {
    const wrapped: unknown[] = [];
    if ("content" in value) {
      wrapped.push(value.content);
    }
    if ("contents" in value) {
      if (!Array.isArray(value.contents)) {
        throw formatError("sub2api", "contents must be an array");
      }
      wrapped.push(...value.contents);
    }
    if (wrapped.length === 0) {
      throw formatError("sub2api", "credential wrapper is empty");
    }
    return wrapped.flatMap((item, index) => {
      if (typeof item === "string") {
        return parseSub2ApiInput(item);
      }
      return parseSub2ApiValue(item, index + 1);
    });
  }

  return [normalizeSub2ApiValue(value, position)];
}

function normalizeSub2ApiValue(value: unknown, position?: number): NormalizedCodexCredential {
  if (typeof value === "string") {
    const accessToken = value.trim();
    if (!accessToken) {
      throw formatError("sub2api", itemMessage(position, "is empty"));
    }
    return { accessToken };
  }
  if (!isObject(value)) {
    throw formatError("sub2api", itemMessage(position, "must be a credential object or access token"));
  }

  const tokens = isObject(value.tokens) ? value.tokens : {};
  const user = isObject(value.user) ? value.user : {};
  const accessToken = firstString(
    tokens.access_token,
    tokens.accessToken,
    value.access_token,
    value.accessToken,
    value.token,
  );
  if (!accessToken) {
    throw formatError("sub2api", itemMessage(position, "is missing access_token"));
  }

  return {
    accessToken,
    idToken: firstString(tokens.id_token, tokens.idToken, value.id_token, value.idToken),
    refreshToken: firstString(tokens.refresh_token, tokens.refreshToken, value.refresh_token, value.refreshToken),
    accountId: firstString(
      tokens.account_id,
      tokens.accountId,
      value.account_id,
      value.accountId,
      value.chatgpt_account_id,
      value.chatgptAccountId,
      user.account_id,
      user.accountId,
    ),
    lastRefresh: firstString(value.last_refresh, value.lastRefresh),
    email: firstString(value.email, user.email),
    name: firstString(value.name),
  };
}

function parseCpaInput(raw: string): NormalizedCodexCredential[] {
  const parsed = tryParseJson(raw);
  if (!parsed.ok) {
    throw formatError("cpa", "credential JSON is invalid");
  }

  const values = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
  if (values.length === 0) {
    throw formatError("cpa", "credential batch is empty");
  }
  return values.map((value, index) => normalizeCpaValue(value, index + 1));
}

function normalizeCpaValue(value: unknown, position: number): NormalizedCodexCredential {
  if (!isObject(value)) {
    throw formatError("cpa", itemMessage(position, "must be a credential object"));
  }
  const credentialType = firstString(value.type);
  if (credentialType && credentialType.toLowerCase() !== "codex") {
    throw formatError("cpa", itemMessage(position, "is not a Codex credential"));
  }

  const accessToken = firstString(value.access_token);
  if (!accessToken) {
    throw formatError("cpa", itemMessage(position, "is missing access_token"));
  }

  return {
    accessToken,
    idToken: firstString(value.id_token),
    refreshToken: firstString(value.refresh_token),
    accountId: firstString(value.account_id),
    lastRefresh: firstString(value.last_refresh),
    email: firstString(value.email),
    name: firstString(value.name),
  };
}

function tryParseJson(value: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch {
    return { ok: false };
  }
}

function looksLikeJson(value: string): boolean {
  return /^[{["]/.test(value.trim());
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function itemMessage(position: number | undefined, message: string): string {
  return position ? `item ${position} ${message}` : `credential ${message}`;
}

function formatError(source: ExternalCodexCredentialSource, message: string): Error {
  return new Error(`${source === "cpa" ? "CPA" : "Sub2API"} import: ${message}`);
}
