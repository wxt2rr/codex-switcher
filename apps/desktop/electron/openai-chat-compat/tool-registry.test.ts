import test from "node:test";
import assert from "node:assert/strict";

import { buildToolRegistry, toChatToolName } from "./tool-registry.js";

test("tool registry converts function, custom, namespace and search tools with reverse lookup", () => {
  const registry = buildToolRegistry({ tools: [
    { type: "function", name: "read_file", parameters: { type: "object" } },
    { type: "custom", name: "shell", description: "run shell" },
    { type: "namespace", name: "github", tools: [{ type: "function", name: "issue" }] },
    { type: "tool_search", name: "search_tools" },
  ] });
  assert.deepEqual(registry.entries.map((entry) => entry.originalName), ["read_file", "shell", "github.issue", "search_tools"]);
  assert.equal(registry.byChatName.get("github__issue")?.originalName, "github.issue");
  assert.equal(registry.byOriginalName.get("shell")?.chatName, "shell");
  const custom = registry.byOriginalName.get("shell")?.definition.function as Record<string, unknown>;
  assert.deepEqual(custom.parameters, {
    type: "object", properties: { input: { type: "string" } }, required: ["input"], additionalProperties: false,
  });
});

test("long tool names are deterministic and collision-safe", () => {
  const long = "tool-".repeat(20);
  assert.equal(toChatToolName(long), toChatToolName(long));
  assert.equal(toChatToolName(long).length, 64);
  assert.notEqual(toChatToolName(`${long}a`), toChatToolName(`${long}b`));
  assert.throws(() => buildToolRegistry({ tools: [
    { type: "function", name: "same name" }, { type: "function", name: "same_name" },
  ] }), /map to/);
});
