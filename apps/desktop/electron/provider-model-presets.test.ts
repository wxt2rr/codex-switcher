import assert from "node:assert/strict";
import test from "node:test";

import {
  getProviderDefaultApiProtocol,
  getProviderDefaultBaseUrl,
  getProviderDefaultModelEntries,
  resolveProviderModelPreset,
} from "./provider-model-presets.js";

test("Kimi K3 preset exposes its official model capabilities", () => {
  const entries = getProviderDefaultModelEntries("kimi");
  assert.deepEqual(entries?.map((entry) => entry.slug), ["kimi-k3"]);
  assert.equal(entries?.[0]?.context_window, 1048576);
  assert.deepEqual(entries?.[0]?.input_modalities, ["text", "image"]);
  assert.deepEqual(
    (entries?.[0]?.supported_reasoning_levels as Array<{ effort: string }>).map((level) => level.effort),
    ["low", "high", "max"],
  );
  assert.equal(entries?.[0]?.default_reasoning_level, "max");
  assert.equal(getProviderDefaultApiProtocol("kimi"), "chat_completions");
  assert.equal(getProviderDefaultBaseUrl("kimi"), "https://api.moonshot.ai/v1");
});

test("GLM presets expose text-only 1M context and supported reasoning levels", () => {
  const entries = getProviderDefaultModelEntries("zai");
  assert.deepEqual(entries?.map((entry) => entry.slug), ["glm-5.3", "glm-5.2"]);
  for (const entry of entries ?? []) {
    assert.equal(entry.context_window, 1048576);
    assert.deepEqual(entry.input_modalities, ["text"]);
    assert.deepEqual(
      (entry.supported_reasoning_levels as Array<{ effort: string }>).map((level) => level.effort),
      entry.slug === "glm-5.2" ? ["none", "low", "high", "max"] : ["low", "high", "max"],
    );
    assert.equal(entry.default_reasoning_level, "max");
  }
  assert.equal(getProviderDefaultApiProtocol("zai"), "chat_completions");
  assert.equal(getProviderDefaultBaseUrl("zai"), "https://open.bigmodel.cn/api/paas/v4");
});

test("official Kimi and Z.AI endpoints resolve to the matching catalog preset", () => {
  assert.equal(resolveProviderModelPreset({ baseUrl: "https://api.moonshot.ai/v1" })?.providerId, "kimi");
  assert.equal(resolveProviderModelPreset({ baseUrl: "https://open.bigmodel.cn/api/paas/v4" })?.providerId, "zai");
});
