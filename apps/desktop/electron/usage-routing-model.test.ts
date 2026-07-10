import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLocalRouteBaseUrl,
  createRouteId,
  extractTokenUsage,
  normalizeUpstreamBaseUrl,
} from "./usage-routing-model.js";

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
