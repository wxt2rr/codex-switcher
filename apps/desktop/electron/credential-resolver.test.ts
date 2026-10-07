import test from "node:test";
import assert from "node:assert/strict";

import { resolveCredentialCandidates } from "./credential-resolver.js";

test("credential resolver includes AUTH for Responses and normalizes provider identity", () => {
  const result = resolveCredentialCandidates([
    { envName: "work", accountName: "login", authMode: "auth", baseUrl: "default", apiKey: "token" },
    { envName: "work", accountName: "key", authMode: "apikey", baseUrl: "default", providerId: "deepseek", apiKey: "sk-key" },
    { envName: "other", accountName: "ignored", authMode: "apikey", baseUrl: "default", apiKey: "sk-other" },
  ], { envName: "work", protocol: "responses" });

  assert.deepEqual(result.candidates.map((candidate) => [candidate.accountName, candidate.providerId, candidate.credentialKind]), [
    ["login", "chatgpt", "auth"],
    ["key", "deepseek", "api_key"],
  ]);
  assert.deepEqual(result.excluded, [
    { accountName: "ignored", reason: "environment_mismatch" },
  ]);
});

test("credential resolver excludes AUTH from Chat Completions without excluding API keys", () => {
  const result = resolveCredentialCandidates([
    { envName: "work", accountName: "login", authMode: "auth", baseUrl: "default", apiKey: "token" },
    { envName: "work", accountName: "key", authMode: "apikey", baseUrl: "default", apiKey: "sk-key" },
  ], { envName: "work", protocol: "chat_completions" });

  assert.deepEqual(result.candidates.map((candidate) => candidate.accountName), ["key"]);
  assert.deepEqual(result.excluded, [
    { accountName: "login", reason: "protocol_incompatible" },
  ]);
});
