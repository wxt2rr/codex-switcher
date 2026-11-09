import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type {
  ClaudeCodeAuthorizationConflict,
  ClaudeCodeAuthorizationInspection,
} from "../src/desktop-model.js";

export type ClaudeCodeSourceKind = "environment_gateway" | "account";
export type ClaudeCodeSourceState = "ready" | "needs_gateway" | "needs_local_agent" | "unavailable";

const CLAUDE_CODE_SETTINGS_AUTH_KEYS = [
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
  "CCR_OAUTH_TOKEN_FILE",
  "ANTHROPIC_FEDERATION_RULE_ID",
  "ANTHROPIC_ORGANIZATION_ID",
] as const;

const CLAUDE_CODE_PROCESS_AUTH_KEYS = [
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
  "CCR_OAUTH_TOKEN_FILE",
] as const;

export interface ClaudeCodeModelOption {
  id: string;
  displayName: string;
}

export interface ClaudeCodeSourceSummary {
  id: string;
  kind: ClaudeCodeSourceKind;
  environmentName: string;
  accountName?: string;
  displayName: string;
  providerDisplayName?: string;
  state: ClaudeCodeSourceState;
  reason?: string;
  baseUrl?: string;
  apiKeyPreview?: string;
  models: ClaudeCodeModelOption[];
  gatewayEnabled?: boolean;
  localAgentAccessEnabled?: boolean;
}

export interface ClaudeCodeConnectionRecord {
  version: 1;
  sourceId: string;
  kind: ClaudeCodeSourceKind;
  environmentName: string;
  accountName?: string;
  gatewayId?: string;
  modelId?: string;
  configPath: string;
  snapshotBindingId: string;
  connectedAt: number;
}

export interface ClaudeCodeConnectionState {
  connected: boolean;
  configPath: string;
  /** True when CLAUDE_CONFIG_DIR changed since the saved binding was applied. */
  configPathChanged?: boolean;
  authorization?: ClaudeCodeAuthorizationInspection;
  source?: ClaudeCodeSourceSummary;
  record?: ClaudeCodeConnectionRecord;
  drift?: "clean" | "missing" | "drifted" | "unwired";
  restartRequired?: boolean;
}

export function claudeCodeEnvironmentSourceId(environmentName: string): string {
  return `environment:${encodeURIComponent(environmentName)}`;
}

export function claudeCodeAccountSourceId(environmentName: string, accountName: string): string {
  return `account:${encodeURIComponent(environmentName)}:${encodeURIComponent(accountName)}`;
}

export function maskClaudeCodeSecret(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length <= 8) return `${normalized.slice(0, 2)}••••`;
  return `${normalized.slice(0, 4)}••••${normalized.slice(-4)}`;
}

export function claudeCodeConnectionPath(stateDir: string): string {
  return join(stateDir, "claude-code-connection.json");
}

/**
 * Claude Code uses CLAUDE_CONFIG_DIR as the root for settings.json,
 * credentials and sessions. Keep the desktop integration on the same root
 * instead of assuming ~/.claude, which is especially important for WSL and
 * users who keep multiple Claude profiles.
 */
export function resolveClaudeCodeConfigDir(
  homeDir: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configured = environment.CLAUDE_CONFIG_DIR?.trim();
  if (!configured) return join(homeDir, ".claude");
  const expanded = configured === "~"
    ? homeDir
    : configured.startsWith("~/") || configured.startsWith("~\\")
      ? join(homeDir, configured.slice(2))
      : configured;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(homeDir, expanded);
}

export function resolveClaudeCodeSettingsPath(
  homeDir: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return join(resolveClaudeCodeConfigDir(homeDir, environment), "settings.json");
}

export function resolveClaudeCodeCredentialsPath(
  homeDir: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return join(resolveClaudeCodeConfigDir(homeDir, environment), ".credentials.json");
}

/**
 * Inspect only the credential locations and names Claude Code uses. Content
 * and secret values never leave the main process; the renderer receives paths,
 * endpoint hints and conflict kinds only.
 */
export function inspectClaudeCodeAuthorizationContent(options: {
  homeDir: string;
  environment?: Readonly<Record<string, string | undefined>>;
  processEnvironment?: Readonly<Record<string, string | undefined>>;
  settingsContent?: string;
  credentialsContent?: string;
}): ClaudeCodeAuthorizationInspection {
  const environment = options.environment ?? process.env;
  const processEnvironment = options.processEnvironment ?? environment;
  const configDir = resolveClaudeCodeConfigDir(options.homeDir, environment);
  const settingsPath = resolveClaudeCodeSettingsPath(options.homeDir, environment);
  const credentialsPath = resolveClaudeCodeCredentialsPath(options.homeDir, environment);
  const settings = parseJsonRecord(options.settingsContent);
  const credentials = parseJsonRecord(options.credentialsContent);
  const settingsEnv = isRecord(settings?.env) ? settings.env : {};
  const hasClaudeAiOauth = isRecord(credentials?.claudeAiOauth)
    && (hasString(credentials.claudeAiOauth.accessToken) || hasString(credentials.claudeAiOauth.refreshToken) || typeof credentials.claudeAiOauth.expiresAt === "number");
  const detectedEndpoints = uniqueStrings([
    hasString(settingsEnv.ANTHROPIC_BASE_URL) ? settingsEnv.ANTHROPIC_BASE_URL : undefined,
    hasString(processEnvironment.ANTHROPIC_BASE_URL) ? processEnvironment.ANTHROPIC_BASE_URL : undefined,
    hasClaudeAiOauth ? "https://claude.ai" : undefined,
  ]);
  const conflicts: ClaudeCodeAuthorizationConflict[] = [];
  const detectedAuthSources: string[] = [];
  const pushConflict = (conflict: ClaudeCodeAuthorizationConflict, label: string): void => {
    conflicts.push(conflict);
    detectedAuthSources.push(label);
  };
  if (hasClaudeAiOauth) pushConflict({
    kind: "claude_ai_oauth",
    path: credentialsPath,
    source: "credentials",
    removable: true,
    description: "Claude.ai OAuth credentials are stored in the Claude Code credentials file.",
  }, "Claude.ai OAuth");

  const settingsAuthKinds: Readonly<Record<string, ClaudeCodeAuthorizationConflict["kind"]>> = {
    ANTHROPIC_AUTH_TOKEN: "anthropic_auth_token",
    CLAUDE_CODE_OAUTH_TOKEN: "claude_code_oauth_token",
    CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "claude_code_oauth_token_file",
    CCR_OAUTH_TOKEN_FILE: "ccr_oauth_token_file",
  };
  const processAuthLabels: Readonly<Record<string, string>> = {
    ANTHROPIC_AUTH_TOKEN: "ANTHROPIC_AUTH_TOKEN",
    CLAUDE_CODE_OAUTH_TOKEN: "CLAUDE_CODE_OAUTH_TOKEN",
    CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
    CCR_OAUTH_TOKEN_FILE: "CCR_OAUTH_TOKEN_FILE",
  };
  for (const key of CLAUDE_CODE_SETTINGS_AUTH_KEYS) {
    if (!hasString(settingsEnv[key])) continue;
    const kind = settingsAuthKinds[key];
    if (kind) pushConflict({
      kind,
      path: settingsPath,
      source: "settings",
      removable: true,
      description: `${key} is configured in Claude Code settings and conflicts with API-key mode.`,
    }, key);
  }
  for (const key of CLAUDE_CODE_PROCESS_AUTH_KEYS) {
    if (!hasString(processEnvironment[key])) continue;
    pushConflict({
      kind: key === "ANTHROPIC_AUTH_TOKEN" ? "external_auth_token" : key === "CLAUDE_CODE_OAUTH_TOKEN" ? "claude_code_oauth_token" : key === "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR" ? "claude_code_oauth_token_file" : "ccr_oauth_token_file",
      path: "process environment",
      source: "process",
      removable: false,
      description: `${key} is inherited from the shell and must be unset outside Switcher.`,
    }, processAuthLabels[key]);
  }

  if (hasString(settings?.apiKeyHelper)) pushConflict({
    kind: "api_key_helper",
    path: settingsPath,
    source: "settings",
    removable: true,
    description: "apiKeyHelper is configured in Claude Code settings and can override the selected API key.",
  }, "apiKeyHelper");
  if (hasString(processEnvironment.ANTHROPIC_API_KEY)) pushConflict({
    kind: "external_api_key",
    path: "process environment",
    source: "process",
    removable: false,
    description: "ANTHROPIC_API_KEY is inherited from the shell and can override the selected API key.",
  }, "ANTHROPIC_API_KEY");

  const settingsWif = hasString(settingsEnv.ANTHROPIC_FEDERATION_RULE_ID) && hasString(settingsEnv.ANTHROPIC_ORGANIZATION_ID);
  const processWif = hasString(processEnvironment.ANTHROPIC_FEDERATION_RULE_ID) && hasString(processEnvironment.ANTHROPIC_ORGANIZATION_ID);
  const mixedWif = !settingsWif && !processWif
    && (hasString(settingsEnv.ANTHROPIC_FEDERATION_RULE_ID) || hasString(settingsEnv.ANTHROPIC_ORGANIZATION_ID))
    && (hasString(processEnvironment.ANTHROPIC_FEDERATION_RULE_ID) || hasString(processEnvironment.ANTHROPIC_ORGANIZATION_ID));
  if (settingsWif) pushConflict({
    kind: "wif_auth",
    path: settingsPath,
    source: "settings",
    removable: true,
    description: "WIF federation credentials are configured in Claude Code settings and conflict with API-key mode.",
  }, "WIF federation credentials");
  if (processWif || mixedWif) pushConflict({
    kind: "wif_auth",
    path: "process environment",
    source: "process",
    removable: false,
    description: "WIF federation credentials are inherited from the shell and must be unset outside Switcher.",
  }, "WIF federation credentials");
  return {
    configDir,
    settingsPath,
    credentialsPath,
    detectedEndpoints,
    detectedAuthSources: uniqueStrings(detectedAuthSources),
    conflicts,
    hasConflict: conflicts.length > 0,
    canCleanup: conflicts.every((conflict) => conflict.removable),
  };
}

export function stripClaudeCodeAuthToken(content: string): string {
  return stripClaudeCodeAuthorizationSettings(content);
}

export function stripClaudeCodeAuthorizationSettings(content: string): string {
  const parsed = parseJsonRecord(content);
  if (!parsed) throw new Error("Claude Code settings.json is not valid JSON");
  const env = isRecord(parsed.env) ? { ...parsed.env } : {};
  for (const key of CLAUDE_CODE_SETTINGS_AUTH_KEYS) delete env[key];
  delete parsed.apiKeyHelper;
  parsed.env = env;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function stripClaudeAiOauthCredentials(content: string): string | null {
  const parsed = parseJsonRecord(content);
  if (!parsed) throw new Error("Claude Code credentials file is not valid JSON");
  delete parsed.claudeAiOauth;
  return Object.keys(parsed).length ? `${JSON.stringify(parsed, null, 2)}\n` : null;
}

export function claudeCodeConfigPathChanged(savedPath: string, activePath: string): boolean {
  return resolve(savedPath.trim()) !== resolve(activePath.trim());
}

export async function readClaudeCodeConnection(stateDir: string): Promise<ClaudeCodeConnectionRecord | undefined> {
  try {
    const parsed = JSON.parse(await readFile(claudeCodeConnectionPath(stateDir), "utf8")) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || typeof parsed.sourceId !== "string" || typeof parsed.kind !== "string"
      || (parsed.kind !== "environment_gateway" && parsed.kind !== "account")
      || typeof parsed.environmentName !== "string" || typeof parsed.configPath !== "string"
      || typeof parsed.snapshotBindingId !== "string" || typeof parsed.connectedAt !== "number") return undefined;
    return {
      version: 1,
      sourceId: parsed.sourceId,
      kind: parsed.kind,
      environmentName: parsed.environmentName,
      ...(typeof parsed.accountName === "string" ? { accountName: parsed.accountName } : {}),
      ...(typeof parsed.gatewayId === "string" ? { gatewayId: parsed.gatewayId } : {}),
      ...(typeof parsed.modelId === "string" ? { modelId: parsed.modelId } : {}),
      configPath: parsed.configPath,
      snapshotBindingId: parsed.snapshotBindingId,
      connectedAt: parsed.connectedAt,
    };
  } catch {
    return undefined;
  }
}

export async function writeClaudeCodeConnection(stateDir: string, record: ClaudeCodeConnectionRecord): Promise<void> {
  const target = claudeCodeConnectionPath(stateDir);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
  if (process.platform !== "win32") await chmod(target, 0o600);
}

export async function clearClaudeCodeConnection(stateDir: string): Promise<void> {
  await rm(claudeCodeConnectionPath(stateDir), { force: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonRecord(value: string | undefined): Record<string, any> | undefined {
  if (!value?.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function hasString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))));
}
