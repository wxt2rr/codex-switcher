import test from "node:test";
import assert from "node:assert/strict";

import { createOurFreeModelProvider, normalizeModels } from "./plugin-core.mjs";

test("official free-model plugin discovers, deduplicates, and preserves the last catalogue", async () => {
  let calls = 0;
  const provider = createOurFreeModelProvider({
    env: { CSW_OUR_FREE_MODEL_BASE_URL: "https://free.example/v1", CSW_OUR_FREE_MODEL_MODELS_URL: "https://free.example/models", CSW_OUR_FREE_MODEL_TIMEOUT_MS: "1000" },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ data: [{ id: "free-a" }, { id: "free-a" }, { id: "free-b", protocols: ["chat_completions"] }] }), { status: 200 });
      throw new Error("temporary failure");
    },
  });
  assert.equal(provider.describe().id, "our-free-model");
  const first = await provider.models({ account: { accountId: "anonymous", secretRef: "none" } });
  assert.deepEqual(first.map((model) => model.id), ["free-a", "free-b"]);
  const second = await provider.models({ account: { accountId: "anonymous", secretRef: "none" } });
  assert.deepEqual(second.map((model) => model.id), ["free-a", "free-b"]);
  assert.equal(calls, 2);
});

test("official free-model plugin uses a configured fallback on first discovery failure", async () => {
  const provider = createOurFreeModelProvider({
    env: { CSW_OUR_FREE_MODEL_FALLBACK_MODELS: "fallback-a,fallback-b" },
    fetchImpl: async () => new Response("unavailable", { status: 503 }),
  });
  const models = await provider.models({ account: { accountId: "anonymous", secretRef: "none" } });
  assert.deepEqual(models.map((model) => model.id), ["fallback-a", "fallback-b"]);
  assert.equal(models[0].source, "preset");
});

test("model normalizer accepts OpenAI and simple catalogue shapes", () => {
  assert.deepEqual(normalizeModels(["a", { id: "b" }, { id: "a" }]).map((model) => model.id), ["a", "b"]);
  assert.deepEqual(normalizeModels({ models: [{ id: "c" }] }).map((model) => model.id), ["c"]);
});

test("official free-model plugin forwards JSON and SSE requests through its provider hook", async () => {
  const requests = [];
  const provider = createOurFreeModelProvider({
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (init.headers["x-test-stream"] === "1") {
        return new Response("data: {\"type\":\"response.output_text.delta\",\"delta\":\"ok\"}\n\ndata: [DONE]\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response(JSON.stringify({ id: "provider-response", model: "free-a" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const json = await provider.request({ url: "https://free.example/v1/responses", method: "POST", headers: { "content-type": "application/json" }, body: "{\"model\":\"free-a\"}" });
  assert.equal(json.status, 201);
  assert.equal(json.body.id, "provider-response");
  assert.equal(requests[0].init.body, "{\"model\":\"free-a\"}");
  const stream = await provider.request({ url: "https://free.example/v1/responses", method: "POST", headers: { "x-test-stream": "1" } });
  assert.equal(stream.events[0].delta, "ok");
});
