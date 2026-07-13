import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  writeLegacyPointers,
  writeLegacyRuntime,
} from "./legacy.js";

test("legacy writer persists current target pointers", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-legacy-write-"));
  const stateDir = join(root, ".codex-switcher");

  try {
    await mkdir(stateDir, { recursive: true });

    await writeLegacyPointers({
      stateDir,
      target: "cli",
      env: "project",
      account: "dev",
    });

    assert.equal(
      (await readFile(join(stateDir, "current_cli_env"), "utf8")).trim(),
      "project",
    );
    assert.equal(
      (await readFile(join(stateDir, "current_cli_account"), "utf8")).trim(),
      "dev",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy writer persists runtime settings for account", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-switcher-legacy-runtime-"));
  const stateDir = join(root, ".codex-switcher");

  try {
    await mkdir(stateDir, { recursive: true });

    await writeLegacyRuntime({
      stateDir,
      envName: "default",
      accountName: "personal",
      runtime: {
        preferredAuthMethod: "apikey",
        openaiBaseUrlMode: "custom",
        openaiBaseUrl: "https://runtime.example/v1",
        independentModelEnabled: true,
        independentModelProviderId: "gateway",
        independentModelApiKey: "sk-model",
        independentModelBaseUrl: "https://model.example/v1",
        apiProtocol: "chat_completions",
        compatibilityRouteEnabled: true,
        compatibilityRouteBaseUrl: "http://127.0.0.1:17899/routes/route-a/v1",
        compatibilityRouteToken: "local-token",
        compatibilityRouteProviderId: "codex-switcher-route-a",
        compatibilityUpstreamModel: "deepseek-chat",
        compatibilityReasoningProfile: "reasoning_content",
        compatibilityLongConversationStrategy: "continuity",
        compatibilityInstructionRole: "developer",
        compatibilityRequestOverrides: { temperature: 0.2 },
      },
    });

    const raw = await readFile(
      join(stateDir, "env-accounts", "default", "personal", "runtime.json"),
      "utf8",
    );
    assert.match(raw, /"preferred_auth_method": "apikey"/);
    assert.match(raw, /"openai_base_url_mode": "custom"/);
    assert.match(raw, /"openai_base_url": "https:\/\/runtime\.example\/v1"/);
    assert.match(raw, /"independent_model_enabled": true/);
    assert.match(raw, /"independent_model_provider_id": "gateway"/);
    assert.match(raw, /"independent_model_api_key": "sk-model"/);
    assert.match(raw, /"independent_model_base_url": "https:\/\/model\.example\/v1"/);
    assert.match(raw, /"api_protocol": "chat_completions"/);
    assert.match(raw, /"compatibility_route_enabled": true/);
    assert.match(raw, /"compatibility_route_token": "local-token"/);
    assert.match(raw, /"compatibility_reasoning_profile": "reasoning_content"/);
    assert.match(raw, /"compatibility_long_conversation_strategy": "continuity"/);
    assert.match(raw, /"compatibility_instruction_role": "developer"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
