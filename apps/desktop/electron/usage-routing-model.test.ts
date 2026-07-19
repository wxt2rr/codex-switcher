import test from "node:test";
import assert from "node:assert/strict";

import {
  authorizeRouteToken,
  buildLocalRouteBaseUrl,
  createRouteId,
  extractTokenUsage,
  isLocalRouterBaseUrl,
  normalizeUpstreamBaseUrl,
  selectCompatibilityUpstreamBaseUrl,
} from "./usage-routing-model.js";

test("route bearer tokens require an exact Bearer match", () => {
  assert.equal(authorizeRouteToken("Bearer local-secret", "local-secret"), true);
  assert.equal(authorizeRouteToken("bearer local-secret", "local-secret"), true);
  assert.equal(authorizeRouteToken("Bearer wrong", "local-secret"), false);
  assert.equal(authorizeRouteToken(undefined, "local-secret"), false);
});

test("compatibility routing unwraps an existing local usage route to its real upstream", () => {
  const route = { routeId: "route", envName: "work", accountName: "deepseek",
    upstreamBaseUrl: "https://api.deepseek.com", originalBaseUrl: "https://api.deepseek.com",
    protocol: "responses" as const, reasoningProfile: "auto" as const,
    enabled: true, createdAt: 1, updatedAt: 1 };
  assert.equal(selectCompatibilityUpstreamBaseUrl([route], "work", "deepseek",
    "http://127.0.0.1:61923/routes/route"), "https://api.deepseek.com");
});

test("compatibility routing repairs a legacy local original URL from the upstream target", () => {
  const route = { routeId: "route-chat", envName: "work", accountName: "deepseek",
    upstreamBaseUrl: "https://api.deepseek.com", originalBaseUrl: "http://127.0.0.1:17832/routes/legacy",
    protocol: "chat_completions" as const, reasoningProfile: "auto" as const,
    enabled: true, createdAt: 1, updatedAt: 1 };
  assert.equal(selectCompatibilityUpstreamBaseUrl([route], "work", "deepseek",
    "http://127.0.0.1:17832/routes/legacy"), "https://api.deepseek.com");
});

test("local router URLs are never treated as provider Base URLs", () => {
  assert.equal(isLocalRouterBaseUrl("http://127.0.0.1:17832/routes/route-a"), true);
  assert.equal(isLocalRouterBaseUrl("http://localhost:17832/pools/pool-a"), true);
  assert.equal(isLocalRouterBaseUrl("https://api.deepseek.com"), false);
});

test("route identity is stable and preserves the upstream Base URL dimension", () => {
  assert.equal(normalizeUpstreamBaseUrl("https://api.example.com/v1/"), "https://api.example.com/v1");
  assert.equal(
    createRouteId("work", "key-a", "https://api.example.com/v1/"),
    createRouteId("work", "key-a", "https://api.example.com/v1"),
  );
  assert.notEqual(
    createRouteId("work", "key-a", "https://api.example.com/v1"),
    createRouteId("work", "key-a", "https://other.example.com/v1"),
  );
  assert.match(buildLocalRouteBaseUrl(17832, "route-id"), /^http:\/\/127\.0\.0\.1:17832\/routes\/route-id$/);
});
test("extractTokenUsage supports Responses API and chat completion usage", () => {
  assert.deepEqual(
    extractTokenUsage({
      response: {
        model: "gpt-5.4",
        usage: {
          input_tokens: 100,
          output_tokens: 25,
          input_tokens_details: { cached_tokens: 60, cache_creation_tokens: 10 },
        },
      },
    }),
    {
      model: "gpt-5.4",
      inputTokens: 100,
      outputTokens: 25,
      cacheCreationTokens: 10,
      cacheReadTokens: 60,
      totalTokens: 125,
    },
  );

  assert.deepEqual(
    extractTokenUsage({
      model: "gpt-4.1-mini",
      usage: {
        prompt_tokens: 40,
        completion_tokens: 5,
        total_tokens: 45,
        prompt_tokens_details: { cached_tokens: 12 },
      },
    }),
    {
      model: "gpt-4.1-mini",
      inputTokens: 40,
      outputTokens: 5,
      cacheCreationTokens: 0,
      cacheReadTokens: 12,
      totalTokens: 45,
    },
  );
});
