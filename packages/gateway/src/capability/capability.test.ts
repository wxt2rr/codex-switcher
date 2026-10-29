import assert from "node:assert/strict";
import test from "node:test";
import {
  CapabilityRegistry,
  classifyCapabilityMismatch,
  capabilityKey,
  capabilityProfileFromModel,
  knownCapabilityProfile,
  filterUnsupportedHostedTools,
  planCapability,
} from "../index.js";

test("capability profiles preserve legacy tools while distinguishing hosted tools", () => {
  const profile = capabilityProfileFromModel({ tools: true, supports_search_tool: false }, "preset");
  assert.equal(profile["tools.function"]?.status, "supported");
  assert.equal(profile["tools.hosted.web_search"]?.status, "unsupported");
});

test("capability registry prefers credential observations and can be snapshotted", () => {
  const context = { providerId: "aliyun", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1", protocol: "chat_completions", modelId: "kimi-k3", credentialId: "account" } as const;
  const registry = new CapabilityRegistry();
  registry.observe(context, "tools.hosted.web_search", "unsupported", "observed", "expected function", 60_000);
  assert.equal(registry.get(context, "tools.hosted.web_search").status, "unsupported");
  assert.ok(capabilityKey(context, "tools.hosted.web_search").includes("kimi-k3"));
  const restored = new CapabilityRegistry(registry.snapshot());
  assert.equal(restored.get(context, "tools.hosted.web_search").status, "unsupported");
});

test("capability mismatch classifier identifies hosted search shape failures", () => {
  const result = classifyCapabilityMismatch({ status: 400, message: "'function' is a required property, expected an object - tools.0", requestedCapabilities: ["tools.hosted.web_search"] });
  assert.equal(result?.capability, "tools.hosted.web_search");
});

test("Kimi profiles advertise strict tool pairing and schema normalization", () => {
  const profile = knownCapabilityProfile({ providerId: "moonshot", endpoint: "https://api.kimi.com/coding", protocol: "chat_completions", modelId: "k3" });
  assert.equal(profile["tools.strict_pairing"]?.status, "supported");
  assert.equal(profile["tools.requires_name"]?.status, "supported");
  assert.equal(profile["schema.ref_siblings"]?.status, "supported");
  const mismatch = classifyCapabilityMismatch({ status: 400, message: "tool message tool_call_id is not found", requestedCapabilities: ["tools.strict_pairing"] });
  assert.equal(mismatch?.capability, "tools.strict_pairing");
});

test("generic capability errors do not poison a multi-tool observation", () => {
  const ambiguous = classifyCapabilityMismatch({
    status: 400,
    message: "invalid tool schema: expected an object",
    requestedCapabilities: ["tools.hosted.web_search", "tools.hosted.code_interpreter"],
  });
  assert.equal(ambiguous, undefined);
  const codeInterpreter = classifyCapabilityMismatch({
    status: 400,
    message: "invalid tool schema: code_interpreter is not supported",
    requestedCapabilities: ["tools.hosted.code_interpreter"],
  });
  assert.equal(codeInterpreter?.capability, "tools.hosted.code_interpreter");
});

test("unknown capabilities fail safe while configured fallback remains available", () => {
  assert.equal(planCapability({ capability: "tools.hosted.web_search" }).action, "omit");
  assert.equal(planCapability({ capability: "tools.hosted.web_search", fallback: "fallback", fallbackAvailable: true }).action, "fallback");
});

test("safe filtering handles every hosted tool and removes an unsatisfiable choice", () => {
  const result = filterUnsupportedHostedTools({
    model: "model",
    tools: [
      { type: "code_interpreter" },
      { type: "computer_use_preview" },
      { type: "function", function: { name: "echo" } },
    ],
    tool_choice: "required",
  }, {
    "tools.hosted.code_interpreter": { status: "unsupported", source: "observed" },
    "tools.hosted.computer_use": { status: "unknown", source: "discovery" },
    "tools.function": { status: "supported", source: "provider" },
  }, "safe");
  assert.deepEqual(result.body.tools, [{ type: "function", function: { name: "echo" } }]);
  assert.equal(result.body.tool_choice, "required");

  const allHosted = filterUnsupportedHostedTools({
    model: "model", tools: [{ type: "code_interpreter" }], tool_choice: "required",
  }, { "tools.hosted.code_interpreter": { status: "unsupported", source: "observed" } }, "safe");
  assert.equal(allHosted.body.tools, undefined);
  assert.equal(allHosted.body.tool_choice, undefined);
  assert.equal(allHosted.omitted.length, 1);
});
