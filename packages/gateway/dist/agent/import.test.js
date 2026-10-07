import assert from "node:assert/strict";
import test from "node:test";
import { importAgentConfiguration, resolveAgentProfile } from "./import.js";
test("imports Codex TOML metadata without copying the API key", () => {
    const result = importAgentConfiguration(resolveAgentProfile("codex"), [
        'model = "gpt-5"',
        'model_reasoning_effort = "high"',
        'openai_base_url = "https://relay.example/v1/"',
        'OPENAI_API_KEY = "sk-never-export"',
    ].join("\n"));
    assert.equal(result.model, "gpt-5");
    assert.equal(result.baseUrl, "https://relay.example/v1");
    assert.equal(result.reasoningProfile, "high");
    assert.equal(result.credentialPresent, true);
    assert.doesNotMatch(JSON.stringify(result), /sk-never-export/);
});
test("imports Claude JSONC nested environment metadata", () => {
    const result = importAgentConfiguration(resolveAgentProfile("claude-code"), `{
    // Keep user fields intact during the later apply/restore step.
    "model": "claude-sonnet",
    "env": {
      "ANTHROPIC_BASE_URL": "https://anthropic.example/",
      "ANTHROPIC_API_KEY": "secret-not-returned"
    }
  }`);
    assert.equal(result.agentId, "claude");
    assert.equal(result.protocol, "anthropic");
    assert.equal(result.model, "claude-sonnet");
    assert.equal(result.baseUrl, "https://anthropic.example");
    assert.equal(result.credentialPresent, true);
    assert.doesNotMatch(JSON.stringify(result), /secret-not-returned/);
});
test("imports OpenCode JSON metadata and reports missing credentials explicitly", () => {
    const result = importAgentConfiguration(resolveAgentProfile("opencode"), JSON.stringify({
        model: "openai/gpt-5",
        provider: { "codex-switcher": { options: { baseURL: "https://gateway.example/v1" } } },
    }));
    assert.equal(result.agentId, "opencode");
    assert.equal(result.model, "openai/gpt-5");
    assert.equal(result.baseUrl, "https://gateway.example/v1");
    assert.equal(result.credentialPresent, false);
    assert.ok(result.warnings.some((warning) => warning.includes("No credential material was imported")));
});
//# sourceMappingURL=import.test.js.map