import test from "node:test";
import assert from "node:assert/strict";

import { createOurFreeModelProvider, normalizeModels } from "./plugin-core.mjs";

function fakeRuntime(overrides = {}) {
  const calls = [];
  return {
    calls,
    ensure: async () => ({ baseUrl: "http://127.0.0.1:18900/v1", key: "ofm-test", managementUrl: "http://127.0.0.1:18900/console", port: 18900 }),
    models: async () => ({ data: [{ id: "free-a", name: "Free A" }, { id: "free-a" }, { id: "free-b", protocols: ["chat_completions"] }] }),
    request: async (input) => { calls.push(input); return { status: 200, body: { id: "managed-response" } }; },
    close: async () => {},
    ...overrides,
  };
}

test("managed provider describes its runtime loopback endpoint", async () => {
  const provider = createOurFreeModelProvider({ runtime: fakeRuntime() });
  const descriptor = await provider.describe();
  assert.equal(descriptor.id, "our-free-model");
  assert.deepEqual(descriptor.endpoints.map((endpoint) => endpoint.baseUrl), [
    "http://127.0.0.1:18900/v1",
    "http://127.0.0.1:18900/v1",
    "http://127.0.0.1:18900/v1",
  ]);
});

test("managed provider discovers, deduplicates, and preserves the last catalogue", async () => {
  let calls = 0;
  const runtime = fakeRuntime({
    models: async () => {
      calls += 1;
      if (calls === 1) return { data: [{ id: "free-a" }, { id: "free-a" }, { id: "free-b", protocols: ["chat_completions"] }] };
      throw new Error("temporary failure");
    },
  });
  const provider = createOurFreeModelProvider({ runtime });
  const first = await provider.models({ account: { accountId: "anonymous" } });
  assert.deepEqual(first.map((model) => model.id), ["free-a", "free-b"]);
  const second = await provider.models({ account: { accountId: "anonymous" } });
  assert.deepEqual(second.map((model) => model.id), ["free-a", "free-b"]);
  assert.equal(calls, 2);
});

test("managed provider forwards requests through the runtime connection", async () => {
  const runtime = fakeRuntime();
  const provider = createOurFreeModelProvider({ runtime });
  const result = await provider.request({ url: "http://127.0.0.1:18900/v1/responses", method: "POST", headers: {}, body: "{}" });
  assert.equal(result.status, 200);
  assert.equal(runtime.calls[0].url, "http://127.0.0.1:18900/v1/responses");
});

test("model normalizer accepts OpenAI and Our Free Model catalogue shapes", () => {
  const models = normalizeModels({ data: ["a", { id: "b" }, { id: "a" }, { id: "vision", supportsImages: true }, { id: "reasoning", reasoning: { efforts: ["low", "high"] } }] });
  assert.deepEqual(models.map((model) => model.id), ["a", "b", "vision", "reasoning"]);
  assert.equal(models[2].capabilities.vision, true);
  assert.equal(models[3].capabilities.reasoning, true);
  assert.deepEqual(models[0].protocols, ["responses", "chat_completions", "anthropic"]);
});
