import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildClaudeCodeProxyConfig,
  CLAUDE_CODE_PROXY_CONFIG_PATHS,
  claudeCodeAccountSourceId,
  claudeCodeConfigPathChanged,
  claudeCodeEnvironmentSourceId,
  inspectClaudeCodeAuthorizationContent,
  listClaudeCodeModelAliases,
  maskClaudeCodeSecret,
  readClaudeCodeConnection,
  resolveClaudeCodeCredentialsPath,
  resolveClaudeCodeConfigDir,
  resolveClaudeCodeSettingsPath,
  resolveClaudeCodeModelOverride,
  stripClaudeAiOauthCredentials,
  stripClaudeCodeAuthorizationSettings,
  stripClaudeCodeAuthToken,
  writeClaudeCodeConnection,
} from "./claude-code-connection.js";

test("Claude Code proxy settings mirror supported Switcher HTTP proxies", () => {
  const config = buildClaudeCodeProxyConfig(" http://127.0.0.1:7899 ");
  assert.deepEqual(config.managedClearPaths, CLAUDE_CODE_PROXY_CONFIG_PATHS);
  assert.deepEqual(config.managedValues, {
    "env.HTTP_PROXY": "http://127.0.0.1:7899",
    "env.HTTPS_PROXY": "http://127.0.0.1:7899",
    "env.NO_PROXY": "localhost,127.0.0.1,::1",
  });
});

test("Claude Code does not write unsupported SOCKS proxy settings", () => {
  const config = buildClaudeCodeProxyConfig("socks5://127.0.0.1:7891");
  assert.deepEqual(config, { managedClearPaths: [] });
  assert.deepEqual(buildClaudeCodeProxyConfig(undefined, { clearExisting: true }), { managedClearPaths: CLAUDE_CODE_PROXY_CONFIG_PATHS });
});

test("Claude Code source IDs are stable and secret previews are masked", () => {
  assert.equal(claudeCodeEnvironmentSourceId("team/prod"), "environment:team%2Fprod");
  assert.equal(claudeCodeAccountSourceId("team/prod", "primary key"), "account:team%2Fprod:primary%20key");
  assert.equal(maskClaudeCodeSecret("sk-ant-api-1234567890"), "sk-a••••7890");
  assert.equal(maskClaudeCodeSecret("short"), "sh••••");
  assert.equal(maskClaudeCodeSecret("  "), undefined);
});

test("Claude Code config paths honor CLAUDE_CONFIG_DIR and default to ~/.claude", () => {
  const homeDir = process.platform === "win32" ? "C:\\Users\\demo" : "/Users/demo";
  const absoluteConfigDir = process.platform === "win32" ? "D:\\Volumes\\work\\claude" : "/Volumes/work/claude";
  const defaultConfigDir = join(homeDir, ".claude");
  const profileConfigDir = join(homeDir, "profiles", "claude");
  assert.equal(resolveClaudeCodeConfigDir(homeDir, {}), defaultConfigDir);
  assert.equal(resolveClaudeCodeSettingsPath(homeDir, {}), join(defaultConfigDir, "settings.json"));
  assert.equal(resolveClaudeCodeCredentialsPath(homeDir, {}), join(defaultConfigDir, ".credentials.json"));
  assert.equal(resolveClaudeCodeConfigDir(homeDir, { CLAUDE_CONFIG_DIR: absoluteConfigDir }), absoluteConfigDir);
  assert.equal(resolveClaudeCodeSettingsPath(homeDir, { CLAUDE_CONFIG_DIR: "~/profiles/claude" }), join(profileConfigDir, "settings.json"));
  assert.equal(resolveClaudeCodeConfigDir(homeDir, { CLAUDE_CONFIG_DIR: "profiles/claude" }), profileConfigDir);
});

test("Claude Code detects OAuth and auth-token conflicts without exposing secrets", () => {
  const inspection = inspectClaudeCodeAuthorizationContent({
    homeDir: "/Users/demo",
    settingsContent: JSON.stringify({ env: { ANTHROPIC_API_KEY: "api-secret", ANTHROPIC_AUTH_TOKEN: "legacy-secret", ANTHROPIC_BASE_URL: "http://127.0.0.1:17832/gateways/demo/v1" } }),
    credentialsContent: JSON.stringify({ claudeAiOauth: { accessToken: "oauth-secret", refreshToken: "refresh-secret", expiresAt: 1 } }),
    processEnvironment: { ANTHROPIC_BASE_URL: "https://example.test/v1" },
  });
  assert.equal(inspection.hasConflict, true);
  assert.equal(inspection.canCleanup, true);
  assert.deepEqual(inspection.detectedEndpoints, ["http://127.0.0.1:17832/gateways/demo/v1", "https://example.test/v1", "https://claude.ai"]);
  assert.deepEqual(inspection.conflicts.map((item) => item.kind), ["claude_ai_oauth", "anthropic_auth_token"]);
  assert.doesNotMatch(JSON.stringify(inspection), /oauth-secret|legacy-secret|api-secret/);
});

test("Claude Code marks inherited auth tokens as non-removable", () => {
  const inspection = inspectClaudeCodeAuthorizationContent({
    homeDir: "/Users/demo",
    settingsContent: JSON.stringify({ env: {} }),
    processEnvironment: { ANTHROPIC_AUTH_TOKEN: "shell-secret" },
  });
  assert.equal(inspection.canCleanup, false);
  assert.equal(inspection.conflicts[0]?.removable, false);
  assert.equal(inspection.conflicts[0]?.source, "process");
});

test("Claude Code detects every supported OAuth and helper source without exposing secrets", () => {
  const inspection = inspectClaudeCodeAuthorizationContent({
    homeDir: "/Users/demo",
    settingsContent: JSON.stringify({
      apiKeyHelper: "./read-key.sh",
      env: {
        CLAUDE_CODE_OAUTH_TOKEN: "oauth-settings-secret",
        CCR_OAUTH_TOKEN_FILE: "/tmp/ccr-token",
        ANTHROPIC_FEDERATION_RULE_ID: "rule-secret",
        ANTHROPIC_ORGANIZATION_ID: "org-secret",
      },
    }),
    processEnvironment: {
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-shell-secret",
      CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "9",
      ANTHROPIC_API_KEY: "shell-api-secret",
    },
  });
  assert.equal(inspection.hasConflict, true);
  assert.equal(inspection.canCleanup, false);
  assert.deepEqual(inspection.detectedAuthSources, [
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CCR_OAUTH_TOKEN_FILE",
    "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
    "apiKeyHelper",
    "ANTHROPIC_API_KEY",
    "WIF federation credentials",
  ]);
  assert.deepEqual(inspection.conflicts.map((item) => item.kind), [
    "claude_code_oauth_token",
    "ccr_oauth_token_file",
    "claude_code_oauth_token",
    "claude_code_oauth_token_file",
    "api_key_helper",
    "external_api_key",
    "wif_auth",
  ]);
  assert.doesNotMatch(JSON.stringify(inspection), /oauth-settings-secret|oauth-shell-secret|shell-api-secret|rule-secret|org-secret/);
});

test("Claude Code conflict cleanup removes only managed auth fields", () => {
  const settings = stripClaudeCodeAuthToken(JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "legacy", KEEP_ME: "yes" }, permissions: { allow: [] } }));
  assert.doesNotMatch(settings, /ANTHROPIC_AUTH_TOKEN/);
  assert.match(settings, /KEEP_ME/);
  const credentials = stripClaudeAiOauthCredentials(JSON.stringify({ claudeAiOauth: { accessToken: "secret" }, other: true }));
  assert.equal(credentials?.includes("claudeAiOauth"), false);
  assert.match(credentials ?? "", /other/);
  assert.equal(stripClaudeAiOauthCredentials(JSON.stringify({ claudeAiOauth: { accessToken: "secret" } })), null);
  const settingsWithConflicts = stripClaudeCodeAuthorizationSettings(JSON.stringify({
    apiKeyHelper: "./read-key.sh",
    env: {
      ANTHROPIC_AUTH_TOKEN: "auth",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth",
      CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "9",
      CCR_OAUTH_TOKEN_FILE: "/tmp/token",
      ANTHROPIC_FEDERATION_RULE_ID: "rule",
      ANTHROPIC_ORGANIZATION_ID: "org",
      ANTHROPIC_API_KEY: "keep-api-key",
      KEEP_ME: "yes",
    },
  }));
  assert.doesNotMatch(settingsWithConflicts, /apiKeyHelper|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|CCR_OAUTH_TOKEN_FILE|ANTHROPIC_FEDERATION_RULE_ID|ANTHROPIC_ORGANIZATION_ID/);
  assert.match(settingsWithConflicts, /keep-api-key|KEEP_ME/);
});

test("Claude Code detects a saved binding that belongs to another config directory", () => {
  assert.equal(claudeCodeConfigPathChanged("/Users/demo/.claude/settings.json", "/Users/demo/.claude/settings.json"), false);
  assert.equal(claudeCodeConfigPathChanged("/Users/demo/.claude/settings.json", "/Users/demo/.claude-work/settings.json"), true);
});

test("Claude Code model aliases include dated Haiku IDs and resolve to the configured provider model", () => {
  const overrides = {
    "claude-sonnet-4-6": "gpt-6.1-sol",
    "claude-haiku-4-5": "gpt-6-luna",
  };
  assert.deepEqual(listClaudeCodeModelAliases(overrides), [
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
    "claude-haiku-4-5-20251001",
  ]);
  assert.equal(resolveClaudeCodeModelOverride("claude-sonnet-4-6", overrides), "gpt-6.1-sol");
  assert.equal(resolveClaudeCodeModelOverride("claude-haiku-4-5-20251001", overrides), "gpt-6-luna");
  assert.equal(resolveClaudeCodeModelOverride("gpt-6-luna", overrides), undefined);
});

test("Claude Code connection records are persisted with restrictive permissions", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "codex-switcher-claude-connection-"));
  try {
    await writeClaudeCodeConnection(stateDir, {
      version: 1,
      sourceId: "account:prod:primary",
      kind: "account",
      environmentName: "prod",
      accountName: "primary",
      configPath: "/tmp/.claude/settings.json",
      snapshotBindingId: "global",
      connectedAt: 123,
      modelId: "claude-sonnet-4-6",
      modelIds: ["claude-opus-4-8", "claude-sonnet-4-6"],
      modelOverrides: { "claude-opus-4-8": "gpt-6.1-sol", "claude-sonnet-4-6": "deepseek-v4-pro" },
      proxyManaged: true,
    });
    const restored = await readClaudeCodeConnection(stateDir);
    assert.equal(restored?.sourceId, "account:prod:primary");
    assert.equal(restored?.snapshotBindingId, "global");
    assert.equal(restored?.proxyManaged, true);
    assert.deepEqual(restored?.modelOverrides, { "claude-opus-4-8": "gpt-6.1-sol", "claude-sonnet-4-6": "deepseek-v4-pro" });
    const connectionPath = join(stateDir, "claude-code-connection.json");
    const mode = (await stat(connectionPath)).mode & 0o777;
    if (process.platform !== "win32") assert.equal(mode, 0o600);
    assert.match(await readFile(connectionPath, "utf8"), /"sourceId": "account:prod:primary"/);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
